"""Transactional SQLite persistence for a single-instance authoring workspace."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from nexusos.prd.media import has_document_text
from nexusos.prd.prototype import Prototype, brief_digest
from nexusos.prd.trace import TRACE_SCHEMA, append_event, get_object, put_object, read_events


def now() -> str:
    return datetime.now(UTC).isoformat()


class NotFoundError(LookupError):
    """The requested workspace resource does not exist."""


class ConflictError(ValueError):
    """A concurrent edit or active generation prevents the requested mutation."""


class PrdStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS prd_documents (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS prd_versions (
                    document_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
                    PRIMARY KEY (document_id, version));
                CREATE TABLE IF NOT EXISTS prd_jobs (
                    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS prd_jobs_document ON prd_jobs(document_id);
            """)
            db.executescript(TRACE_SCHEMA)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _get(db: sqlite3.Connection, table: str, key: str) -> dict[str, Any]:
        row = db.execute(f"SELECT body FROM {table} WHERE id=?", (key,)).fetchone()
        if row is None:
            raise NotFoundError(key)
        return json.loads(row[0])  # type: ignore[no-any-return]

    @staticmethod
    def _put(db: sqlite3.Connection, table: str, item: dict[str, Any]) -> None:
        db.execute(f"UPDATE {table} SET body=? WHERE id=?", (json.dumps(item), item["id"]))

    def create(self, brief: dict[str, Any]) -> dict[str, Any]:
        item: dict[str, Any] = {
            "id": uuid4().hex,
            "brief": brief,
            "content": "",
            "revision": 1,
            "version": 0,
            "review": None,
            "active_job_id": None,
            "last_job_id": None,
            "created_at": now(),
            "updated_at": now(),
        }
        with self.connection() as db:
            db.execute("INSERT INTO prd_documents VALUES (?,?)", (item["id"], json.dumps(item)))
            append_event(
                db, item["id"], "document.created", {"snapshot": item, "actor": "local_user"}
            )
        return item

    def get(self, document_id: str) -> dict[str, Any]:
        with self.connection() as db:
            return self._get(db, "prd_documents", document_id)

    def list_documents(self) -> list[dict[str, Any]]:
        with self.connection() as db:
            items = [json.loads(row[0]) for row in db.execute("SELECT body FROM prd_documents")]
        return [
            {key: item[key] for key in ("id", "revision", "version", "updated_at", "active_job_id")}
            | {"title": item["brief"]["title"]}
            for item in sorted(items, key=lambda item: item["updated_at"], reverse=True)
        ]

    @staticmethod
    def _check(item: dict[str, Any], revision: int) -> None:
        if item["revision"] != revision:
            raise ConflictError("文档已在其他页面更新，请重新打开后再保存；当前编辑未被覆盖")
        if item["active_job_id"]:
            raise ConflictError("文档正在生成或评审，请等待完成或停止任务后再编辑")

    @staticmethod
    def _version(
        db: sqlite3.Connection,
        item: dict[str, Any],
        note: str,
        *,
        job: dict[str, Any] | None = None,
        restored_from_version: int | None = None,
    ) -> None:
        item["version"] += 1
        snapshot = {
            "version": item["version"],
            "brief": item["brief"],
            "content": item["content"],
            "note": note,
            "created_at": now(),
            "revision": item["revision"],
            "parent_version": item["version"] - 1,
            "origin_job_id": job["id"] if job else None,
            "restored_from_version": restored_from_version,
        }
        snapshot["snapshot_hash"] = put_object(
            db, {"brief": item["brief"], "content": item["content"]}
        )
        db.execute(
            "INSERT INTO prd_versions VALUES (?,?,?)",
            (
                item["id"],
                item["version"],
                json.dumps(snapshot),
            ),
        )
        append_event(db, item["id"], "artifact.version_created", snapshot, job=job)

    def save(
        self,
        document_id: str,
        revision: int,
        brief: dict[str, Any],
        content: str,
        note: str,
        restored_from_version: int | None = None,
    ) -> dict[str, Any]:
        with self.connection() as db:
            item = self._get(db, "prd_documents", document_id)
            self._check(item, revision)
            if (
                restored_from_version is not None
                and not db.execute(
                    "SELECT 1 FROM prd_versions WHERE document_id=? AND version=?",
                    (document_id, restored_from_version),
                ).fetchone()
            ):
                raise ValueError("要恢复的历史版本不存在")
            if item["brief"] == brief and item["content"] == content:
                return item
            if (
                brief.get("prototype")
                and brief["prototype"].get("confirmed")
                and brief["prototype"].get("input_digest") != brief_digest(brief)
            ):
                brief = {**brief, "prototype": {**brief["prototype"], "confirmed": False}}
            item.update(brief=brief, content=content, review=None, updated_at=now())
            item["revision"] += 1
            self._version(db, item, note, restored_from_version=restored_from_version)
            self._put(db, "prd_documents", item)
            append_event(
                db,
                document_id,
                "document.saved",
                {
                    "revision": item["revision"],
                    "version": item["version"],
                    "note": note,
                    "actor": "local_user",
                    "restored_from_version": restored_from_version,
                },
            )
            return item

    def versions(self, document_id: str) -> list[dict[str, Any]]:
        with self.connection() as db:
            self._get(db, "prd_documents", document_id)
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT body FROM prd_versions WHERE document_id=? ORDER BY version DESC",
                    (document_id,),
                )
            ]

    def start_job(
        self,
        document_id: str,
        revision: int,
        action: str,
        instruction: str,
        retry_of_job_id: str | None = None,
        resume_of_job_id: str | None = None,
        show_thinking: bool = False,
    ) -> dict[str, Any]:
        with self.connection() as db:
            item = self._get(db, "prd_documents", document_id)
            self._check(item, revision)
            if retry_of_job_id and resume_of_job_id:
                raise ValueError("重新执行与继续执行只能选择一种")
            checkpoint: dict[str, Any] = {"version": "prd-stages/v1", "stages": {}}
            original = None
            if retry_of_job_id or resume_of_job_id:
                original = self._get(db, "prd_jobs", retry_of_job_id or resume_of_job_id or "")
                if original["document_id"] != document_id or original["status"] not in {
                    "failed",
                    "cancelled",
                }:
                    raise ValueError("只能关联同一文档中失败或已停止的任务")
            if resume_of_job_id and original:
                reason = self._resume_reason(db, original, item)
                if reason:
                    raise ConflictError(reason)
                checkpoint = self._restore_checkpoint(db, original)
                action, instruction = original["action"], original["instruction"]
                show_thinking = bool(original.get("show_thinking", False))
                checkpoint["runtime_ancestors"] = [
                    original["id"],
                    *checkpoint.get("runtime_ancestors", []),
                ]
                if original.get("error_type") == "MergeValidationError":
                    checkpoint["invalidated_stages"] = ["write-1", "write-2", "write-3"]
                    checkpoint["stages"] = {
                        k: v
                        for k, v in checkpoint["stages"].items()
                        if k not in checkpoint["invalidated_stages"]
                    }
            if action in {"revise", "review"} and not item["content"].strip():
                raise ValueError("请先生成或导入 PRD 文档")
            if action == "revise" and not instruction.strip():
                raise ValueError("请填写修改要求")
            if action == "generate" and has_document_text(item["content"]) and not original:
                raise ValueError("已有文档请使用修改功能，以保留现有内容")
            if action in {"generate", "revise"} and item["brief"].get("prototype"):
                prototype = Prototype.model_validate(item["brief"]["prototype"])
                if not prototype.confirmed or prototype.input_digest != brief_digest(item["brief"]):
                    raise ValueError("请先预览并确认原型，再编写 PRD")
            job: dict[str, Any] = {
                "id": uuid4().hex,
                "document_id": document_id,
                "action": action,
                "instruction": instruction,
                "show_thinking": show_thinking,
                "status": "queued",
                "stage": "等待执行",
                "steps": [],
                "error": None,
                "created_at": now(),
                "updated_at": now(),
                "input_tokens": 0,
                "output_tokens": 0,
                "stream": None,
                "trace_id": uuid4().hex,
                "span_id": uuid4().hex[:16],
                "input_revision": item["revision"],
                "input_version": item["version"],
                "input_hash": put_object(db, item),
                "retry_of_job_id": retry_of_job_id,
                "resume_of_job_id": resume_of_job_id,
                "checkpoint": checkpoint,
                "checkpoint_revision": item["revision"],
            }
            if resume_of_job_id and original:
                for key in ("input_revision", "input_version", "input_hash"):
                    job[key] = original[key]
            item["active_job_id"] = job["id"]
            item["last_job_id"] = job["id"]
            self._put(db, "prd_documents", item)
            db.execute(
                "INSERT INTO prd_jobs VALUES (?,?,?)",
                (
                    job["id"],
                    document_id,
                    json.dumps(job),
                ),
            )
            append_event(
                db,
                document_id,
                "job.queued",
                {
                    "action": action,
                    "instruction": instruction,
                    "show_thinking": show_thinking,
                    "input_hash": job["input_hash"],
                    "input": get_object(db, job["input_hash"]),
                    "retry_of_job_id": retry_of_job_id,
                    "resume_of_job_id": resume_of_job_id,
                    "execution_policy": "resume completed stages"
                    if resume_of_job_id
                    else "restart from current input",
                    "reused_stage_ids": list(checkpoint["stages"]),
                },
                job=job,
            )
            return job

    def begin_stream(self, job_id: str, stage_id: str, title: str) -> None:
        """Reset the durable live snapshot when a model-backed stage starts."""

        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            if job["status"] != "running":
                return
            previous_sequence = int((job.get("stream") or {}).get("sequence", 0))
            job["stream"] = {
                "stage_id": stage_id,
                "title": title,
                "content": "",
                "reasoning_content": "",
                "sequence": previous_sequence + 1,
                "status": "streaming",
                "updated_at": now(),
            }
            job["updated_at"] = now()
            self._put(db, "prd_jobs", job)

    def append_stream_delta(
        self, job_id: str, stage_id: str, content: str, reasoning_content: str
    ) -> None:
        """Append a throttled provider delta to the current live snapshot."""

        if not content and not reasoning_content:
            return
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            stream = job.get("stream")
            if job["status"] != "running" or not stream or stream["stage_id"] != stage_id:
                return
            stream["content"] += content
            if job.get("show_thinking"):
                stream["reasoning_content"] += reasoning_content
            stream["sequence"] += 1
            stream["updated_at"] = now()
            job["updated_at"] = stream["updated_at"]
            self._put(db, "prd_jobs", job)

    def finish_stream(self, job_id: str, stage_id: str, status: str = "succeeded") -> None:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            stream = job.get("stream")
            if not stream or stream["stage_id"] != stage_id:
                return
            stream["status"] = status
            stream["sequence"] += 1
            stream["updated_at"] = now()
            job["updated_at"] = stream["updated_at"]
            self._put(db, "prd_jobs", job)

    def job(self, job_id: str) -> dict[str, Any]:
        with self.connection() as db:
            return self._get(db, "prd_jobs", job_id)

    def update_job(self, job_id: str, **changes: Any) -> dict[str, Any]:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            if job["status"] in {"succeeded", "failed", "cancelled"}:
                return job
            old_status = job["status"]
            job.update(changes, updated_at=now())
            if job["status"] in {"failed", "cancelled"}:
                job["steps"] = [
                    {**step, "status": job["status"]} if step["status"] == "running" else step
                    for step in job["steps"]
                ]
            if job["status"] in {"succeeded", "failed", "cancelled"} and job.get("stream"):
                job["stream"]["status"] = job["status"]
                job["stream"]["sequence"] += 1
            self._put(db, "prd_jobs", job)
            if job["status"] != old_status:
                append_event(
                    db,
                    job["document_id"],
                    f"job.{job['status']}",
                    {
                        "from_status": old_status,
                        "status": job["status"],
                        "stage": job["stage"],
                        "error": job["error"],
                        "error_type": job.get("error_type"),
                    },
                    job=job,
                )
            if job["status"] in {"succeeded", "failed", "cancelled"}:
                item = self._get(db, "prd_documents", job["document_id"])
                item["active_job_id"] = None
                self._put(db, "prd_documents", item)
            return job

    def publish(
        self,
        job_id: str,
        *,
        content: str | None = None,
        review: dict[str, Any] | None = None,
        prototype: dict[str, Any] | None = None,
    ) -> None:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            item = self._get(db, "prd_documents", job["document_id"])
            if item["active_job_id"] != job_id or job["status"] != "running":
                raise ConflictError("任务已结束，不能覆盖当前文档")
            checkpoint = job.setdefault("checkpoint", {"version": "prd-stages/v1", "stages": {}})
            if content is not None and checkpoint.get("published_content"):
                return
            if review is not None and checkpoint.get("published_review"):
                return
            item.update(updated_at=now(), review=review)
            item["revision"] += 1
            if prototype is not None:
                item["brief"] = {**item["brief"], "prototype": prototype}
                self._version(db, item, "AI 原型设计（待确认）", job=job)
            if content is not None:
                item["content"] = content
                self._version(
                    db, item, "AI 生成" if job["action"] == "generate" else "AI 修订", job=job
                )
            if review is not None:
                append_event(
                    db,
                    item["id"],
                    "review.published",
                    {
                        "revision": item["revision"],
                        "version": item["version"],
                        "review": review,
                    },
                    job=job,
                )
            if content is not None:
                checkpoint["published_content"] = {"version": item["version"], "job_id": job_id}
            if review is not None:
                checkpoint["published_review"] = {"revision": item["revision"], "job_id": job_id}
            job["checkpoint_revision"] = item["revision"]
            self._put(db, "prd_jobs", job)
            self._put(db, "prd_documents", item)

    def recover(self) -> None:
        """Fail interrupted work explicitly; never replay paid calls on startup."""
        with self.connection() as db:
            for (body,) in db.execute("SELECT body FROM prd_jobs").fetchall():
                job = json.loads(body)
                if job["status"] not in {"queued", "running"}:
                    continue
                for step in job["steps"]:
                    if step["status"] == "running":
                        step["status"] = "failed"
                        append_event(
                            db,
                            job["document_id"],
                            "stage.interrupted",
                            {
                                "stage_id": step["id"],
                                "reason": "service_restart",
                                "provider_outcome": "unknown",
                            },
                            job=job,
                            span_id=step.get("span_id"),
                            parent_span_id=job.get("span_id"),
                        )
                interrupted_stage = job["stage"]
                job.update(
                    status="failed",
                    stage="任务中断",
                    updated_at=now(),
                    error="服务重启导致任务中断。可继续执行以复用已完成阶段，或选择重新执行。",
                )
                self._put(db, "prd_jobs", job)
                append_event(
                    db,
                    job["document_id"],
                    "job.interrupted",
                    {
                        "reason": "service_restart",
                        "status": "failed",
                        "stage": interrupted_stage,
                        "note": "进程中断，未自动重放；供应商未返回的结果未知。",
                    },
                    job=job,
                )
                item = self._get(db, "prd_documents", job["document_id"])
                item["active_job_id"] = None
                self._put(db, "prd_documents", item)

    @staticmethod
    def _restore_checkpoint(db: sqlite3.Connection, job: dict[str, Any]) -> dict[str, Any]:
        if job.get("checkpoint"):
            return json.loads(json.dumps(job["checkpoint"]))  # type: ignore[no-any-return]
        # Adopt only explicitly accepted legacy stages, never infer success from a response.
        checkpoint: dict[str, Any] = {
            "version": "prd-stages/v1",
            "stages": {},
            "legacy_import": True,
        }
        for name, digest in db.execute(
            "SELECT name,payload_hash FROM prd_trace_events WHERE job_id=? ORDER BY sequence",
            (job["id"],),
        ):
            payload = get_object(db, digest)
            key = payload.get("stage_id")
            if name == "stage.succeeded" and key in {
                "requirements",
                "ux",
                "technical",
                "write-1",
                "write-2",
                "write-3",
                "prototype",
            }:
                checkpoint["stages"][key] = {
                    "content": payload["content"],
                    "source_job_id": job["id"],
                    "evidence_hash": digest,
                    "step": next(
                        (step for step in job["steps"] if step["id"] == key),
                        {"id": key, "title": key, "agent_id": "", "skill_ids": []},
                    ),
                }
            if name == "artifact.version_created":
                checkpoint["published_content"] = {
                    "version": payload["version"],
                    "job_id": job["id"],
                }
        return checkpoint

    @staticmethod
    def _resume_reason(
        db: sqlite3.Connection, job: dict[str, Any], item: dict[str, Any]
    ) -> str | None:
        if job["status"] not in {"failed", "cancelled"}:
            return "只有失败或已停止的任务可以继续执行"
        if not job.get("input_hash"):
            return "旧任务缺少原始输入快照，请选择重新执行"
        if item["last_job_id"] != job["id"]:
            return "已有后续任务，请选择最新任务继续或重新执行"
        if job.get("checkpoint", {}).get("version", "prd-stages/v1") != "prd-stages/v1":
            return "检查点版本不兼容，请选择重新执行"
        revision = job.get("checkpoint_revision", job["input_revision"])
        if not job.get("checkpoint"):
            for _name, digest in db.execute(
                "SELECT name,payload_hash FROM prd_trace_events WHERE job_id=? "
                "AND name IN ('artifact.version_created','review.published')",
                (job["id"],),
            ):
                revision = max(revision, get_object(db, digest).get("revision", revision))
        if item["revision"] != revision:
            return "文档或需求已修改，旧现场不能继续；请重新执行"
        if item["active_job_id"]:
            return "文档已有执行中的任务"
        return None

    def _recovery_info(self, db: sqlite3.Connection, job: dict[str, Any]) -> dict[str, Any]:
        item = self._get(db, "prd_documents", job["document_id"])
        reason = self._resume_reason(db, job, item)
        checkpoint = self._restore_checkpoint(db, job) if job.get("input_hash") else {"stages": {}}
        return {
            "can_resume": reason is None,
            "reason": reason,
            "completed_stages": list(checkpoint["stages"]),
        }

    def recovery_info(self, job_id: str) -> dict[str, Any]:
        with self.connection() as db:
            return self._recovery_info(db, self._get(db, "prd_jobs", job_id))

    def checkpoint_stage(self, job_id: str, key: str) -> dict[str, Any] | None:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            cached = job["checkpoint"]["stages"].get(key)
            if cached and get_object(db, cached["evidence_hash"])["content"] != cached["content"]:
                raise ValueError("检查点与原始证据不一致")
            return cached  # type: ignore[no-any-return]

    def complete_stage(self, job_id: str, step: dict[str, Any], payload: dict[str, Any]) -> None:
        """Commit accepted stage output, progress and evidence in one transaction."""
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            if job["status"] != "running":
                raise ConflictError("任务已停止，不能保存阶段结果")
            completed = {**step, "status": "succeeded", "content": payload["content"]}
            job["steps"] = [s for s in job["steps"] if s["id"] != step["id"]] + [completed]
            job["input_tokens"] += payload["input_tokens"]
            job["output_tokens"] += payload["output_tokens"]
            job["checkpoint"]["stages"][step["id"]] = {
                "content": payload["content"],
                "step": completed,
                "source_job_id": job_id,
                "evidence_hash": put_object(db, payload),
            }
            self._put(db, "prd_jobs", job)
            append_event(
                db,
                job["document_id"],
                "stage.succeeded",
                payload,
                job=job,
                span_id=step["span_id"],
                parent_span_id=job["span_id"],
            )
            append_event(
                db,
                job["document_id"],
                "checkpoint.saved",
                {
                    "stage_id": step["id"],
                    "output_hash": job["checkpoint"]["stages"][step["id"]]["evidence_hash"],
                    "runtime_thread_id": f"{job_id}:{step['id']}",
                },
                job=job,
            )

    def job_input(self, job_id: str) -> dict[str, Any]:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            if not job.get("input_hash"):
                raise ValueError("历史任务没有记录输入快照，不能推断当时输入")
            return get_object(db, job["input_hash"])  # type: ignore[no-any-return]

    def record_event(
        self,
        job_id: str,
        name: str,
        payload: dict[str, Any],
        *,
        span_id: str | None = None,
        parent_span_id: str | None = None,
    ) -> None:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            append_event(
                db,
                job["document_id"],
                name,
                payload,
                job=job,
                span_id=span_id,
                parent_span_id=parent_span_id,
            )

    def job_history(
        self, document_id: str, *, before: int | None = None, limit: int = 50
    ) -> dict[str, Any]:
        if not 1 <= limit <= 200 or (before is not None and not 1 <= before <= 2**63 - 1):
            raise ValueError("invalid history cursor or limit")
        with self.connection() as db:
            self._get(db, "prd_documents", document_id)
            rows = db.execute(
                "SELECT rowid, body FROM prd_jobs WHERE document_id=? AND rowid<? "
                "ORDER BY rowid DESC LIMIT ?",
                (document_id, before or 2**63 - 1, limit + 1),
            ).fetchall()
            items = []
            for _, body in rows[:limit]:
                job = json.loads(body)
                summary = {
                    key: value for key, value in job.items() if key not in {"steps", "checkpoint"}
                }
                summary["trace_available"] = bool(job.get("input_hash"))
                summary["recovery"] = self._recovery_info(db, job)
                items.append(summary)
            return {
                "items": items,
                "next_cursor": rows[limit - 1][0] if len(rows) > limit else None,
            }

    def timeline(self, document_id: str, *, after: int = 0, limit: int = 100) -> dict[str, Any]:
        with self.connection() as db:
            self._get(db, "prd_documents", document_id)
            result = read_events(db, document_id, after=after, limit=limit)
            result["coverage"] = "recorded_events_only"
            result["notice"] = "仅展示启用追溯后记录的事件；旧任务没有的输入和调用记录不会补造。"
            return result

    def job_events(self, job_id: str, *, after: int = 0, limit: int = 100) -> dict[str, Any]:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            return read_events(db, job["document_id"], after=after, limit=limit, job_id=job_id)

    def trace_bundle(self, job_id: str) -> dict[str, Any]:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            events = []
            cursor = 0
            while True:
                page = read_events(db, job["document_id"], after=cursor, limit=500, job_id=job_id)
                events.extend(page["items"])
                if page["next_cursor"] is None:
                    break
                cursor = page["next_cursor"]
            versions = [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT body FROM prd_versions WHERE document_id=? ORDER BY version",
                    (job["document_id"],),
                )
            ]
            return {
                "schema_version": "nexus.prd.trace/v1",
                "exported_at": now(),
                "coverage": "recorded" if job.get("input_hash") else "legacy_incomplete",
                "job": {**job, "recovery": self._recovery_info(db, job)},
                "events": events,
                "input": get_object(db, job["input_hash"]) if job.get("input_hash") else None,
                "artifacts": [
                    version for version in versions if version.get("origin_job_id") == job_id
                ],
                "notice": "包含用户材料和模型输入输出；任务启用思考显示时，也包含供应商返回的"
                " reasoning_content。不采集配置密钥或认证头。事件只追加且内容带 SHA-256；"
                "不是不可篡改存证，也不保证模型重跑相同。",
            }
