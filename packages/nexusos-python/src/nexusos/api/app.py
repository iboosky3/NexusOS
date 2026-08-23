"""Optional FastAPI transport around framework-neutral application services."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from nexusos.api.read_store import InMemoryRunReadStore, RunNotFoundError
from nexusos.bootstrap import build_reference_orchestrator
from nexusos.orchestrator import RunRecord


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
):
    """Create the optional FastAPI application without coupling core imports to FastAPI."""

    try:
        from fastapi import FastAPI, HTTPException
    except ImportError as exc:
        raise RuntimeError("install nexusos with the 'api' extra to run the HTTP service") from exc

    app = FastAPI(
        title="NexusOS API",
        version="0.1.0",
        description="多智能体编排与 Skill 智能基础设施 API",
    )
    store = run_store or InMemoryRunReadStore()

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

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

    return app
