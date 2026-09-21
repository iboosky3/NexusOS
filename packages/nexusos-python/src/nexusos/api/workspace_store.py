"""Versioned development store for PRD workspaces and append-only trace events."""

from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from datetime import UTC, datetime
from threading import RLock
from typing import Any
from uuid import uuid4


class WorkspaceNotFoundError(LookupError):
    """Raised when a workspace does not exist."""


class WorkspaceAlreadyExistsError(ValueError):
    """Raised when a project already owns a workspace."""


class WorkspaceVersionConflictError(ValueError):
    """Raised when optimistic locking detects a stale client."""


class InMemoryWorkspaceStore:
    """Keep bounded workspace snapshots and immutable business trace events.

    This store is intended for development and contract tests. Production adapters must persist
    document versions and events transactionally in PostgreSQL.
    """

    def __init__(self, maximum_entries: int = 100) -> None:
        if maximum_entries < 1:
            raise ValueError("maximum entries must be positive")
        self._maximum_entries = maximum_entries
        self._workspaces: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = RLock()

    def create(
        self,
        project_id: str,
        title: str,
        *,
        actor_id: str = "development-user",
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        if not project_id.strip() or not title.strip():
            raise ValueError("project_id and title are required")
        with self._lock:
            if project_id in self._workspaces:
                raise WorkspaceAlreadyExistsError(project_id)
            now = _now()
            workspace = {
                "project_id": project_id,
                "title": title,
                "ai_mode": "brainstorm",
                "prd": {"content": "# 产品需求文档\n", "version": 1},
                "prototype": {"html": "", "version": 0},
                "screenshots": [],
                "events": [],
                "created_at": now,
                "updated_at": now,
            }
            self._append_event(
                workspace,
                action="workspace.created",
                summary="创建 PRD 与原型工作区",
                resource_kind="workspace",
                resource_id=project_id,
                resource_version=1,
                actor_id=actor_id,
                correlation_id=correlation_id,
            )
            self._workspaces[project_id] = workspace
            while len(self._workspaces) > self._maximum_entries:
                self._workspaces.popitem(last=False)
            return deepcopy(workspace)

    def get(self, project_id: str) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._require(project_id))

    def set_mode(
        self,
        project_id: str,
        mode: str,
        *,
        actor_id: str = "development-user",
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        if mode not in {"brainstorm", "professional"}:
            raise ValueError("mode must be brainstorm or professional")
        with self._lock:
            workspace = self._require(project_id)
            workspace["ai_mode"] = mode
            self._append_event(
                workspace,
                action="workspace.mode_changed",
                summary=f"切换为{mode}模式",
                resource_kind="workspace",
                resource_id=project_id,
                resource_version=None,
                actor_id=actor_id,
                correlation_id=correlation_id,
                metadata={"mode": mode},
            )
            return deepcopy(workspace)

    def update_prd(
        self,
        project_id: str,
        content: str,
        expected_version: int,
        *,
        actor_id: str = "development-user",
        correlation_id: str | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            workspace = self._require(project_id)
            prd = workspace["prd"]
            _check_version("PRD", expected_version, prd["version"])
            prd["content"] = content
            prd["version"] += 1
            self._append_event(
                workspace,
                action="prd.updated",
                summary="保存 PRD 内容修改",
                resource_kind="prd",
                resource_id=f"{project_id}:prd",
                resource_version=prd["version"],
                actor_id=actor_id,
                correlation_id=correlation_id,
                run_id=run_id,
                metadata={"content_length": len(content)},
            )
            return deepcopy(workspace)

    def update_prototype(
        self,
        project_id: str,
        html: str,
        expected_version: int,
        *,
        actor_id: str = "development-user",
        correlation_id: str | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            workspace = self._require(project_id)
            prototype = workspace["prototype"]
            _check_version("prototype", expected_version, prototype["version"])
            prototype["html"] = html
            prototype["version"] += 1
            self._append_event(
                workspace,
                action="prototype.updated",
                summary="保存可运行原型",
                resource_kind="prototype",
                resource_id=f"{project_id}:prototype",
                resource_version=prototype["version"],
                actor_id=actor_id,
                correlation_id=correlation_id,
                run_id=run_id,
                metadata={"content_length": len(html)},
            )
            return deepcopy(workspace)

    def add_screenshot(
        self,
        project_id: str,
        *,
        prototype_version: int,
        purpose: str,
        node_id: str | None = None,
        object_key: str | None = None,
        actor_id: str = "development-user",
        correlation_id: str | None = None,
    ) -> dict[str, Any]:
        if not purpose.strip():
            raise ValueError("screenshot purpose is required")
        with self._lock:
            workspace = self._require(project_id)
            current_version = workspace["prototype"]["version"]
            if prototype_version > current_version:
                raise ValueError("screenshot cannot reference a future prototype version")
            screenshot: dict[str, Any] = {
                "id": str(uuid4()),
                "prototype_version": prototype_version,
                "node_id": node_id,
                "object_key": object_key,
                "purpose": purpose,
                "created_at": _now(),
            }
            workspace["screenshots"].append(screenshot)
            self._append_event(
                workspace,
                action="screenshot.inserted",
                summary=f"截图已插入 PRD：{purpose}",
                resource_kind="screenshot",
                resource_id=screenshot["id"],
                resource_version=prototype_version,
                actor_id=actor_id,
                correlation_id=correlation_id,
                metadata={"node_id": node_id},
            )
            return deepcopy(workspace)

    def record_assistant_exchange(
        self,
        project_id: str,
        instruction: str,
        *,
        actor_id: str = "development-user",
        correlation_id: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if not instruction.strip():
            raise ValueError("instruction is required")
        with self._lock:
            workspace = self._require(project_id)
            correlation = correlation_id or str(uuid4())
            requested = self._append_event(
                workspace,
                action="assistant.requested",
                summary=instruction,
                resource_kind="assistant",
                resource_id=project_id,
                resource_version=None,
                actor_id=actor_id,
                correlation_id=correlation,
                metadata={"mode": workspace["ai_mode"]},
            )
            policy = (
                {"workflow": "direct", "temperature": 0.8, "maximum_output_tokens": 1200}
                if workspace["ai_mode"] == "brainstorm"
                else {"workflow": "orchestrated", "temperature": 0.1, "maximum_output_tokens": 4096}
            )
            response = {
                "status": "accepted",
                "mode": workspace["ai_mode"],
                "policy": policy,
                "message": "请求已进入模型执行边界；当前参考实现返回路由策略。",
            }
            self._append_event(
                workspace,
                action="assistant.responded",
                summary=f"已按 {policy['workflow']} 策略处理请求",
                resource_kind="assistant",
                resource_id=project_id,
                resource_version=None,
                actor_id="system",
                correlation_id=correlation,
                causation_id=requested["event_id"],
                metadata=policy,
            )
            return deepcopy(workspace), response

    def list_events(self, project_id: str, after_sequence: int = 0) -> tuple[dict[str, Any], ...]:
        if after_sequence < 0:
            raise ValueError("after_sequence cannot be negative")
        with self._lock:
            events = self._require(project_id)["events"]
            return tuple(deepcopy(event) for event in events if event["sequence"] > after_sequence)

    def _require(self, project_id: str) -> dict[str, Any]:
        try:
            return self._workspaces[project_id]
        except KeyError as exc:
            raise WorkspaceNotFoundError(project_id) from exc

    @staticmethod
    def _append_event(
        workspace: dict[str, Any],
        *,
        action: str,
        summary: str,
        resource_kind: str,
        resource_id: str,
        resource_version: int | None,
        actor_id: str,
        correlation_id: str | None,
        causation_id: str | None = None,
        run_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = _now()
        event = {
            "event_id": str(uuid4()),
            "sequence": len(workspace["events"]) + 1,
            "occurred_at": now,
            "actor_type": "system" if actor_id == "system" else "user",
            "actor_id": actor_id,
            "action": action,
            "resource_kind": resource_kind,
            "resource_id": resource_id,
            "resource_version": resource_version,
            "correlation_id": correlation_id or str(uuid4()),
            "causation_id": causation_id,
            "run_id": run_id,
            "summary": summary,
            "metadata": metadata or {},
        }
        workspace["events"].append(event)
        workspace["updated_at"] = now
        return event


def _check_version(resource: str, expected: int, actual: int) -> None:
    if expected != actual:
        raise WorkspaceVersionConflictError(
            f"{resource} version conflict: expected {expected}, current {actual}"
        )


def _now() -> str:
    return datetime.now(UTC).isoformat()
