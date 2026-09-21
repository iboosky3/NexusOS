"""Uniform proposal-only Agent invocation boundary for workspace plugins."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from nexusos.prd.store import ConflictError, now
from nexusos.studio.execution import PluginExecution
from nexusos.studio.plugins import plugin_for
from nexusos.studio.store import StudioStore, canonical, digest

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}


class InvocationService:
    def __init__(
        self, store: StudioStore, gateway: Any, model: str, root: str | Path | None = None
    ):
        self.store, self.gateway, self.model = store, gateway, model
        self.tasks: dict[str, asyncio.Task] = {}
        self.execution = PluginExecution(
            Path(root) if root is not None else Path.cwd(), gateway, model
        )

    def event_in(self, db, item: dict, event: str, payload: dict):
        row = db.execute(
            "SELECT COALESCE(MAX(sequence),0)+1 FROM studio_events WHERE invocation_id=?",
            (item["id"],),
        ).fetchone()
        body = {
            "invocationId": item["id"],
            "sequence": row[0],
            "type": event,
            "timestamp": now(),
            "payload": payload,
        }
        db.execute("INSERT INTO studio_events VALUES(?,?,?)", (item["id"], row[0], canonical(body)))

    def stage_event(self, workspace: str, identifier: str, event: str, payload: dict):
        with self.store.documents.connection() as db:
            item = self.store.get_in(db, workspace, identifier, "invocation")
            if item["status"] != "running":
                raise asyncio.CancelledError()
            self.store.require_plugin(db, workspace, item["pluginId"])
            progress = item.setdefault("progress", {})
            stage = payload["stageId"]
            progress[stage] = {
                **progress.get(stage, {}),
                **payload,
                "status": "running" if event == "stage.started" else "succeeded",
            }
            self.store.put_in(db, item, "invocation")
            self.event_in(db, item, event, payload)

    @staticmethod
    def settle_progress(item: dict, status: str):
        for progress in item.get("progress", {}).values():
            if progress["status"] == "running":
                progress["status"] = status

    def create(self, workspace: str, request: dict):
        with self.store.documents.connection() as db:
            resource = self.store.get_in(db, workspace, request["resourceId"], "resource")
            plugin = plugin_for(resource["resourceType"])
            self.store.require_plugin(db, workspace, plugin.id)
            if request["capabilityId"] not in plugin.capabilities:
                raise PermissionError("CAPABILITY_DENIED")
            previous = self.store.request_in(
                db, workspace, "invocation.create", request["clientRequestId"], request
            )
            if previous:
                return self.store.get_in(db, workspace, previous["id"], "invocation")
            if request.get("retryOf"):
                parent = self.store.get_in(db, workspace, request["retryOf"], "invocation")
                if (
                    parent["status"] not in {"failed", "cancelled", "interrupted"}
                    or parent["request"]["resourceId"] != resource["id"]
                    or parent["request"]["capabilityId"] != request["capabilityId"]
                    or parent["request"].get("input", {}) != request.get("input", {})
                    or parent["request"]["instruction"] != request["instruction"]
                ):
                    raise ConflictError("INVALID_RETRY")
            self.store.check_revision(resource, request["revision"])
            if resource["deleted"]:
                raise ConflictError("RESOURCE_DELETED")
            if not self.gateway or not self.model:
                raise ValueError("尚未配置模型")
            item: dict[str, Any] = {
                "id": uuid4().hex,
                "workspaceId": workspace,
                "pluginId": plugin.id,
                "status": "queued",
                "request": request,
                "snapshot": resource,
                "execution": self.execution.prepare(plugin, request, resource),
                "createdAt": now(),
                "result": None,
                "error": None,
                "appliedRevision": None,
            }
            self.store.put_in(db, item, "invocation")
            self.event_in(
                db, item, "queued", {"resourceId": resource["id"], "revision": resource["revision"]}
            )
            self.store.receipt_in(
                db, workspace, "invocation.create", request["clientRequestId"], request, item
            )
        task = asyncio.create_task(self.run(workspace, item["id"]))
        self.tasks[item["id"]] = task
        task.add_done_callback(lambda _: self.tasks.pop(item["id"], None))
        return item

    async def run(self, workspace: str, identifier: str):
        try:
            with self.store.documents.connection() as db:
                item = self.store.get_in(db, workspace, identifier, "invocation")
                if item["status"] != "queued":
                    return
                self.store.require_plugin(db, workspace, item["pluginId"])
                item["status"] = "running"
                self.store.put_in(db, item, "invocation")
                self.event_in(db, item, "running", {})
            resource = item["snapshot"]
            plugin = plugin_for(resource["resourceType"])
            action = plugin.action(item["request"]["capabilityId"])
            if action.version != item["execution"]["capabilityVersion"]:
                raise ValueError("CAPABILITY_VERSION_UNAVAILABLE")
            read_only = action.read_only
            response = await asyncio.wait_for(
                self.execution.execute(
                    item,
                    action,
                    lambda event, payload: self.stage_event(workspace, identifier, event, payload),
                ),
                timeout=180 * max(1, len(item["execution"].get("stages", []))),
            )
            raw = response.content.strip()
            if raw.startswith("```") and raw.endswith("```"):
                raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
            value = json.loads(raw)
            if action.output_model:
                value = action.output_model.model_validate(value).model_dump()
            if read_only:
                result = value
            else:
                inputs = action.validate_input(item["request"].get("input", {}))
                payload = (
                    plugin.validate(action.propose(value, resource["payload"], inputs))
                    if action.propose
                    else plugin.proposal(value, resource["payload"])
                )
                result = {"payload": payload, "digest": digest(payload)}
                if action.output_model and "answer" in value:
                    result["answer"] = value["answer"]
            with self.store.documents.connection() as db:
                current = self.store.get_in(db, workspace, identifier, "invocation")
                if current["status"] != "running":
                    return
                current.update(
                    status="succeeded" if read_only else "waiting_confirmation", result=result
                )
                current["tokenUsage"] = {
                    "input": response.token_usage.input_tokens,
                    "output": response.token_usage.output_tokens,
                }
                self.store.put_in(db, current, "invocation")
                self.event_in(db, current, current["status"], {"digest": result.get("digest")})
        except asyncio.CancelledError:
            state = self.store.get(workspace, identifier, "invocation")["status"]
            self.finish(
                workspace, identifier, "cancelled" if state == "cancel_requested" else "interrupted"
            )
        except Exception:
            self.finish(
                workspace,
                identifier,
                "failed",
                "模型调用失败或输出未通过校验；当前资源未修改，请重试。",
            )

        finally:
            current = self.store.get(workspace, identifier, "invocation")
            if current["status"] == "cancel_requested":
                self.finish(workspace, identifier, "cancelled")

    def finish(self, workspace: str, identifier: str, status: str, error: str | None = None):
        with self.store.documents.connection() as db:
            item = self.store.get_in(db, workspace, identifier, "invocation")
            if item["status"] in TERMINAL:
                return item
            item.update(status=status, error=error)
            if status in TERMINAL:
                self.settle_progress(item, status)
            self.store.put_in(db, item, "invocation")
            self.event_in(db, item, status, {"error": error})
            return item

    async def cancel(self, workspace: str, identifier: str):
        item = self.store.get(workspace, identifier, "invocation")
        if item["status"] in TERMINAL:
            return item
        self.finish(workspace, identifier, "cancel_requested")
        task = self.tasks.get(identifier)
        if task:
            task.cancel()
            done, _ = await asyncio.wait({task}, timeout=0.1)
            if not done:
                return self.store.get(workspace, identifier, "invocation")
        return self.finish(workspace, identifier, "cancelled")

    def apply(self, workspace: str, identifier: str, approval_digest: str):
        with self.store.documents.connection() as db:
            item = self.store.get_in(db, workspace, identifier, "invocation")
            self.store.require_plugin(db, workspace, item["pluginId"])
            if not item["result"] or item["result"].get("digest") != approval_digest:
                raise ConflictError("APPROVAL_STALE")
            if digest(item["result"].get("payload")) != approval_digest:
                raise ConflictError("APPROVAL_STALE")
            if item["appliedRevision"]:
                return item
            if item["status"] != "waiting_confirmation":
                raise ConflictError("INVOCATION_NOT_APPLICABLE")
            source = item["snapshot"]
            saved = self.store.save_in(
                db, workspace, source["id"], source["revision"], item["result"]["payload"]
            )
            item.update(status="succeeded", appliedRevision=saved["revision"])
            self.store.put_in(db, item, "invocation")
            self.event_in(
                db, item, "applied", {"resourceId": saved["id"], "revision": saved["revision"]}
            )
            return item

    def events(self, workspace: str, identifier: str, after: int):
        self.store.get(workspace, identifier, "invocation")
        with self.store.documents.connection() as db:
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT body FROM studio_events WHERE invocation_id=? AND sequence>? "
                    "ORDER BY sequence LIMIT 500",
                    (identifier, after),
                )
            ]

    def recover(self):
        with self.store.documents.connection() as db:
            for (body,) in db.execute(
                "SELECT body FROM studio_objects WHERE kind='invocation'"
            ).fetchall():
                item = json.loads(body)
                if item["status"] in {"queued", "running", "cancel_requested"}:
                    item.update(status="interrupted", error="服务重启，请检查后重试；不会自动重放")
                    self.settle_progress(item, "interrupted")
                    self.store.put_in(db, item, "invocation")
                    self.event_in(db, item, "interrupted", {})

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
