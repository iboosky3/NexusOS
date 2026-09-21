"""Optional FastAPI transport around framework-neutral application services."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from nexusos.api.read_store import InMemoryRunReadStore, RunNotFoundError
from nexusos.api.workspace_store import (
    InMemoryWorkspaceStore,
    WorkspaceAlreadyExistsError,
    WorkspaceNotFoundError,
    WorkspaceVersionConflictError,
)
from nexusos.bootstrap import build_reference_orchestrator
from nexusos.health import HealthCheck, HealthRegistry
from nexusos.orchestrator import RunRecord

logger = logging.getLogger(__name__)  # Technical logs link back to workspace event IDs.


def serialize_run_record(record: RunRecord) -> dict[str, Any]:
    """Convert internal value objects into the stable v1 response contract."""

    state = record.state
    task_definitions = record.tasks
    return {
        "run_id": state.run_id,
        "status": "succeeded" if state.review and state.review.passed else "blocked",
        "request": state.user_request,
        "started_at": record.started_at.isoformat(),
        "completed_at": record.completed_at.isoformat(),
        "duration_ms": record.duration_ms,
        "iteration": state.iteration,
        "review": {
            "overall_score": state.review.overall_score if state.review else None,
            "passed": state.review.passed if state.review else False,
            "dimensions": dict(state.review.dimensions) if state.review else {},
        },
        "usage": {
            "input_tokens": state.token_usage.input_tokens,
            "output_tokens": state.token_usage.output_tokens,
            "total_tokens": state.token_usage.total_tokens,
        },
        "tasks": [
            {
                "task_id": task_id,
                "title": task_definitions[task_id].title,
                "objective": task_definitions[task_id].objective,
                "dependencies": task_definitions[task_id].dependencies,
                "status": status.value,
                "agent_id": state.selected_agents.get(task_id),
                "skill_ids": state.selected_skills.get(task_id, ()),
            }
            for task_id, status in state.task_status.items()
        ],
        "routing": [
            {
                "task_id": task_id,
                "candidates": [
                    {
                        "skill_id": candidate.skill.id,
                        "score": candidate.score,
                        "reasons": dict(candidate.reasons),
                        "instruction_tokens": candidate.skill.estimated_tokens,
                    }
                    for candidate in candidates
                ],
            }
            for task_id, candidates in record.routes.items()
        ],
        "context_budgets": [
            {
                "task_id": task_id,
                "maximum_tokens": budget.maximum_tokens,
                "consumed_tokens": budget.consumed_tokens,
                "reserved_tokens": budget.reserved_tokens,
                "borrowed_tokens": budget.borrowed_tokens,
                "omitted_fragments": budget.omitted_fragments,
                "section_tokens": dict(budget.section_tokens),
            }
            for task_id, budget in record.budgets.items()
        ],
        "artifacts": [
            {
                "name": item.name,
                "media_type": item.media_type,
                "size_bytes": len(item.content.encode("utf-8")),
                "content": item.content,
            }
            for item in state.artifacts
        ],
    }


def create_app(
    *,
    root: str | Path = ".",
    run_store: InMemoryRunReadStore | None = None,
    workspace_store: InMemoryWorkspaceStore | None = None,
    readiness_checks: Mapping[str, tuple[HealthCheck, bool]] | None = None,
):
    """Create the optional FastAPI application without coupling core imports to FastAPI."""

    try:
        from fastapi import FastAPI, Header, HTTPException
        from fastapi.responses import JSONResponse
    except ImportError as exc:
        raise RuntimeError("install nexusos with the 'api' extra to run the HTTP service") from exc

    app = FastAPI(
        title="NexusOS API",
        version="0.1.0",
        description="多智能体编排与 Skill 智能基础设施 API",
    )
    store = run_store or InMemoryRunReadStore()
    workspaces = workspace_store or InMemoryWorkspaceStore()
    repository_root = Path(root)
    checks = readiness_checks or {
        "agent_manifests": (lambda: any((repository_root / "agents").rglob("agent.yaml")), True),
        "skill_manifests": (lambda: any((repository_root / "skills").rglob("skill.yaml")), True),
    }
    health_registry = HealthRegistry(checks)

    @app.get("/livez")
    @app.get("/healthz", deprecated=True)
    async def liveness() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    async def readiness() -> Any:
        report = await health_registry.evaluate()
        return JSONResponse(status_code=200 if report.ready else 503, content=report.as_dict())

    @app.post("/v1/prd/runs")
    async def create_prd_run(payload: dict[str, Any]) -> dict[str, Any]:
        request = payload.get("request")
        if not isinstance(request, str) or not request.strip():
            raise HTTPException(status_code=422, detail="request must be a non-empty string")
        record = await build_reference_orchestrator(root).run(request)
        projection = serialize_run_record(record)
        store.save(projection)
        return projection

    @app.get("/v1/runs")
    async def list_runs(limit: int = 20) -> dict[str, Any]:
        try:
            items = store.list_summaries(limit)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return {"items": items, "next_cursor": None}

    @app.get("/v1/runs/{run_id}")
    async def get_run(run_id: str) -> dict[str, Any]:
        try:
            return store.get(run_id)
        except RunNotFoundError as exc:
            raise HTTPException(status_code=404, detail="run not found") from exc

    @app.post("/v1/workspaces", status_code=201)
    async def create_workspace(
        payload: dict[str, Any],
        x_correlation_id: str | None = Header(default=None),
    ) -> dict[str, Any]:
        try:
            workspace = workspaces.create(
                str(payload.get("project_id", "")),
                str(payload.get("title", "")),
                actor_id=str(payload.get("actor_id", "development-user")),
                correlation_id=x_correlation_id,
            )
        except WorkspaceAlreadyExistsError as exc:
            raise HTTPException(status_code=409, detail="workspace already exists") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _log_workspace_event(workspace["events"][-1])
        return workspace

    @app.get("/v1/workspaces/{project_id}")
    async def get_workspace(project_id: str) -> dict[str, Any]:
        try:
            return workspaces.get(project_id)
        except WorkspaceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="workspace not found") from exc

    @app.put("/v1/workspaces/{project_id}/mode")
    async def set_workspace_mode(
        project_id: str,
        payload: dict[str, Any],
        x_correlation_id: str | None = Header(default=None),
    ) -> dict[str, Any]:
        try:
            workspace = workspaces.set_mode(
                project_id,
                str(payload.get("mode", "")),
                actor_id=str(payload.get("actor_id", "development-user")),
                correlation_id=x_correlation_id,
            )
        except WorkspaceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="workspace not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _log_workspace_event(workspace["events"][-1])
        return workspace

    @app.put("/v1/workspaces/{project_id}/prd")
    async def update_workspace_prd(
        project_id: str,
        payload: dict[str, Any],
        x_correlation_id: str | None = Header(default=None),
    ) -> dict[str, Any]:
        try:
            workspace = workspaces.update_prd(
                project_id,
                str(payload.get("content", "")),
                int(payload.get("expected_version", -1)),
                actor_id=str(payload.get("actor_id", "development-user")),
                correlation_id=x_correlation_id,
                run_id=_optional_string(payload.get("run_id")),
            )
        except WorkspaceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="workspace not found") from exc
        except WorkspaceVersionConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _log_workspace_event(workspace["events"][-1])
        return workspace

    @app.put("/v1/workspaces/{project_id}/prototype")
    async def update_workspace_prototype(
        project_id: str,
        payload: dict[str, Any],
        x_correlation_id: str | None = Header(default=None),
    ) -> dict[str, Any]:
        try:
            workspace = workspaces.update_prototype(
                project_id,
                str(payload.get("html", "")),
                int(payload.get("expected_version", -1)),
                actor_id=str(payload.get("actor_id", "development-user")),
                correlation_id=x_correlation_id,
                run_id=_optional_string(payload.get("run_id")),
            )
        except WorkspaceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="workspace not found") from exc
        except WorkspaceVersionConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _log_workspace_event(workspace["events"][-1])
        return workspace

    @app.post("/v1/workspaces/{project_id}/screenshots", status_code=201)
    async def add_workspace_screenshot(
        project_id: str,
        payload: dict[str, Any],
        x_correlation_id: str | None = Header(default=None),
    ) -> dict[str, Any]:
        try:
            workspace = workspaces.add_screenshot(
                project_id,
                prototype_version=int(payload.get("prototype_version", -1)),
                purpose=str(payload.get("purpose", "")),
                node_id=_optional_string(payload.get("node_id")),
                object_key=_optional_string(payload.get("object_key")),
                actor_id=str(payload.get("actor_id", "development-user")),
                correlation_id=x_correlation_id,
            )
        except WorkspaceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="workspace not found") from exc
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        _log_workspace_event(workspace["events"][-1])
        return workspace

    @app.post("/v1/workspaces/{project_id}/assistant")
    async def request_workspace_assistant(
        project_id: str,
        payload: dict[str, Any],
        x_correlation_id: str | None = Header(default=None),
    ) -> dict[str, Any]:
        try:
            workspace, response = workspaces.record_assistant_exchange(
                project_id,
                str(payload.get("instruction", "")),
                actor_id=str(payload.get("actor_id", "development-user")),
                correlation_id=x_correlation_id,
            )
        except WorkspaceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="workspace not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        for event in workspace["events"][-2:]:
            _log_workspace_event(event)
        return {"response": response, "events": workspace["events"][-2:]}

    @app.get("/v1/workspaces/{project_id}/events")
    async def list_workspace_events(
        project_id: str,
        after_sequence: int = 0,
    ) -> dict[str, Any]:
        try:
            return {"items": workspaces.list_events(project_id, after_sequence)}
        except WorkspaceNotFoundError as exc:
            raise HTTPException(status_code=404, detail="workspace not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return app


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _log_workspace_event(event: Mapping[str, Any]) -> None:
    """Correlate technical logs with the append-only business event stream."""

    logger.info(
        "workspace_event action=%s event_id=%s correlation_id=%s run_id=%s resource=%s:%s",
        event.get("action"),
        event.get("event_id"),
        event.get("correlation_id"),
        event.get("run_id"),
        event.get("resource_kind"),
        event.get("resource_id"),
    )
