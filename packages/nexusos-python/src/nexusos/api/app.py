"""Optional FastAPI transport around framework-neutral application services."""

from __future__ import annotations

from typing import Any

from nexusos.bootstrap import build_reference_orchestrator
from nexusos.orchestrator import RunRecord


def serialize_run_record(record: RunRecord) -> dict[str, Any]:
    """Convert internal value objects into the stable v1 response contract."""

    state = record.state
    return {
        "run_id": state.run_id,
        "status": "succeeded" if state.review and state.review.passed else "blocked",
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
                "status": status,
                "agent_id": state.selected_agents.get(task_id),
                "skill_ids": state.selected_skills.get(task_id, ()),
            }
            for task_id, status in state.task_status.items()
        ],
        "artifacts": [
            {"name": item.name, "media_type": item.media_type, "content": item.content}
            for item in state.artifacts
        ],
    }


def create_app():
    """Create the optional FastAPI application without coupling core imports to FastAPI."""

    try:
        from fastapi import Body, FastAPI, HTTPException
    except ImportError as exc:
        raise RuntimeError("install nexusos with the 'api' extra to run the HTTP service") from exc

    app = FastAPI(
        title="NexusOS API",
        version="0.1.0",
        description="多智能体编排与 Skill 智能基础设施 API",
    )

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/prd/runs")
    async def create_prd_run(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        request = payload.get("request")
        if not isinstance(request, str) or not request.strip():
            raise HTTPException(status_code=422, detail="request must be a non-empty string")
        record = await build_reference_orchestrator().run(request)
        return serialize_run_record(record)

    return app
