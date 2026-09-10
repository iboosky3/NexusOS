"""HTTP boundary for the persistent authoring workspace."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

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
            )
        except ConflictError as exc:
            raise HTTPException(409, str(exc)) from exc
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
                document_id, payload.expected_revision, payload.action, payload.instruction
            )
        except ConflictError as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        workflow.start(job["id"])
        return job

    @router.get("/jobs/{job_id}")
    async def get_job(job_id: str) -> dict[str, Any]:
        try:
            return store.job(job_id)
        except NotFoundError as exc:
            raise HTTPException(404, "任务不存在") from exc

    @router.post("/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str) -> dict[str, Any]:
        await get_job(job_id)
        return await workflow.cancel(job_id)

    return router
