"""HTTP boundary for the persistent authoring workspace."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from nexusos.prd.schemas import Brief, SaveDocument, StartJob, clarification_questions
from nexusos.prd.store import ConflictError, NotFoundError, PrdStore
from nexusos.prd.workflow import PrdWorkflow


def create_prd_router(store: PrdStore, workflow: PrdWorkflow) -> APIRouter:
    router = APIRouter(prefix="/v1/prd", tags=["PRD workspace"])

    def document(document_id: str) -> dict[str, Any]:
        try:
            item = store.get(document_id)
        except NotFoundError as exc:
            raise HTTPException(404, "文档不存在") from exc
        item["questions"] = clarification_questions(Brief.model_validate(item["brief"]))
        return item

    @router.get("/configuration")
    async def configuration() -> dict[str, Any]:
        return workflow.configuration()

    @router.get("/documents")
    async def list_documents() -> dict[str, Any]:
        return {"items": store.list_documents()}

    @router.post("/documents", status_code=201)
    async def create_document(brief: Brief) -> dict[str, Any]:
        item = store.create(brief.model_dump())
        return document(item["id"])

    @router.get("/documents/{document_id}")
    async def get_document(document_id: str) -> dict[str, Any]:
        return document(document_id)

    @router.put("/documents/{document_id}")
    async def save_document(document_id: str, payload: SaveDocument) -> dict[str, Any]:
        document(document_id)
        try:
            store.save(
                document_id,
                payload.expected_revision,
                payload.brief.model_dump(),
                payload.content,
                payload.note,
                payload.restored_from_version,
            )
        except ConflictError as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return document(document_id)

    @router.get("/documents/{document_id}/versions")
    async def list_versions(document_id: str) -> dict[str, Any]:
        document(document_id)
        return {"items": store.versions(document_id)}

    @router.post("/documents/{document_id}/jobs", status_code=202)
    async def start_job(document_id: str, payload: StartJob) -> dict[str, Any]:
        document(document_id)
        if not workflow.configuration()["configured"]:
            raise HTTPException(
                503,
                "尚未配置生成模型。请在 API 服务设置 NEXUS_MODEL_NAME、"
                "NEXUS_MODEL_BASE_URL 和 NEXUS_MODEL_API_KEY，重启后再试。",
            )
        try:
            job = store.start_job(
                document_id,
                payload.expected_revision,
                payload.action,
                payload.instruction,
                payload.retry_of_job_id,
                payload.resume_of_job_id,
                payload.show_thinking,
            )
        except ConflictError as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except NotFoundError as exc:
            raise HTTPException(404, "关联任务不存在") from exc
        workflow.start(job["id"])
        return job

    @router.get("/jobs/{job_id}")
    async def get_job(job_id: str) -> dict[str, Any]:
        try:
            return {**store.job(job_id), "recovery": store.recovery_info(job_id)}
        except NotFoundError as exc:
            raise HTTPException(404, "任务不存在") from exc

    @router.get("/jobs/{job_id}/stream")
    async def stream_job(job_id: str, request: Request) -> StreamingResponse:
        try:
            store.job(job_id)
        except NotFoundError as exc:
            raise HTTPException(404, "任务不存在") from exc

        async def events():
            last_sequence = -1
            heartbeat = 0
            while not await request.is_disconnected():
                current = store.job(job_id)
                sequence = int((current.get("stream") or {}).get("sequence", 0))
                terminal = current["status"] in {
                    "succeeded",
                    "failed",
                    "cancelled",
                }
                if sequence != last_sequence or terminal:
                    event = {
                        key: value
                        for key, value in current.items()
                        if key not in {"checkpoint", "input_hash"}
                    }
                    if terminal:
                        event["recovery"] = store.recovery_info(job_id)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                    last_sequence = sequence
                    if terminal:
                        return
                heartbeat += 1
                if heartbeat % 60 == 0:
                    yield ": keep-alive\n\n"
                await asyncio.sleep(0.25)

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
        )

    @router.post("/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str) -> dict[str, Any]:
        await get_job(job_id)
        return await workflow.cancel(job_id)

    @router.get("/documents/{document_id}/jobs")
    async def list_jobs(
        document_id: str, before: int | None = None, limit: int = 50
    ) -> dict[str, Any]:
        document(document_id)
        try:
            return store.job_history(document_id, before=before, limit=limit)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.get("/documents/{document_id}/trace")
    async def timeline(document_id: str, after: int = 0, limit: int = 100) -> dict[str, Any]:
        document(document_id)
        try:
            return store.timeline(document_id, after=after, limit=limit)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.get("/jobs/{job_id}/trace")
    async def trace_bundle(job_id: str) -> dict[str, Any]:
        await get_job(job_id)
        return store.trace_bundle(job_id)

    return router
