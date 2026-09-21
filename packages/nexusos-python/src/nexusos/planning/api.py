"""Local single-user planning API. Proposing never starts execution."""

from fastapi import APIRouter, HTTPException

from nexusos.planning.schemas import ExecutePlan, PlanRequest, RevisePlan


def create_planning_router(service):
    router = APIRouter(prefix="/v1/planning", tags=["planning"])

    @router.get("/configuration")
    async def configuration():
        return {
            "configured": bool(service.gateway and service.model),
            "model": service.model,
            "execution_policy": "text-only/v1",
            "maximum_nodes": 12,
        }

    @router.post("/plans", status_code=201)
    async def propose(payload: PlanRequest):
        if not service.gateway or not service.model:
            raise HTTPException(503, "尚未配置规划模型")
        try:
            return await service.propose(payload)
        except LookupError as exc:
            raise HTTPException(404, "关联计划不存在") from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @router.get("/plans/{plan_id}")
    async def get_plan(plan_id: str):
        try:
            return service.store.get(plan_id)
        except LookupError as exc:
            raise HTTPException(404, "计划不存在") from exc

    @router.post("/plans/{plan_id}/revision", status_code=201)
    async def revise(plan_id: str, payload: RevisePlan):
        try:
            return service.revise(plan_id, payload)
        except LookupError as exc:
            raise HTTPException(404, "计划不存在") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.post("/plans/{plan_id}/confirmation")
    async def confirm(plan_id: str, payload: ExecutePlan):
        try:
            return service.confirm(plan_id, payload.digest)
        except LookupError as exc:
            raise HTTPException(404, "计划不存在") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.get("/plans/{plan_id}/confirmation")
    async def confirmation(plan_id: str):
        try:
            return service.store.confirmation(plan_id)
        except LookupError as exc:
            raise HTTPException(404, "请先确认编排方案") from exc

    @router.post("/plans/{plan_id}/run", status_code=202)
    async def start(plan_id: str, payload: ExecutePlan):
        try:
            return service.start(plan_id, payload.digest)
        except LookupError as exc:
            raise HTTPException(404, "计划不存在") from exc
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.get("/plans/{plan_id}/run")
    async def get_run(plan_id: str):
        try:
            return service.store.run(plan_id)
        except LookupError as exc:
            raise HTTPException(404, "执行记录不存在") from exc

    return router
