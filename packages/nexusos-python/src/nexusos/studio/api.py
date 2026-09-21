"""Versioned local-user HTTP transport for composable workspaces."""

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field

from nexusos.prd.schemas_base import StrictModel
from nexusos.prd.store import ConflictError, NotFoundError
from nexusos.studio.agents import InvocationService
from nexusos.studio.handoffs import HandoffService
from nexusos.studio.store import StudioStore


class CreateWorkspace(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    clientRequestId: str = Field(min_length=1, max_length=200)


class ImportedResource(StrictModel):
    resourceType: str
    schemaVersion: int = Field(default=1, ge=1)
    payload: dict[str, Any]


class ImportWorkspace(StrictModel):
    schemaVersion: int = Field(ge=1, le=1)
    title: str = Field(min_length=1, max_length=200)
    resources: list[ImportedResource] = Field(max_length=100)
    clientRequestId: str = Field(min_length=1, max_length=200)


class Configuration(StrictModel):
    expectedRevision: int = Field(ge=1)
    plugins: list[str] = Field(max_length=100)
    layouts: dict[str, Any] = Field(default_factory=dict)


class CreateResource(StrictModel):
    resourceType: str
    schemaVersion: int = Field(default=1, ge=1, le=1)
    payload: dict[str, Any]
    clientRequestId: str = Field(min_length=1, max_length=200)


class SaveResource(StrictModel):
    clientRequestId: str = Field(min_length=1, max_length=200)
    expectedRevision: int = Field(ge=1)
    payload: dict[str, Any]


class Invocation(StrictModel):
    resourceId: str
    revision: int = Field(ge=1)
    capabilityId: str
    instruction: str = Field(min_length=1, max_length=12000)
    clientRequestId: str = Field(min_length=1, max_length=200)
    retryOf: str | None = None
    input: dict[str, Any] = Field(default_factory=dict)


class Publish(StrictModel):
    resourceId: str
    revision: int = Field(ge=1)
    clientRequestId: str = Field(min_length=1, max_length=200)


class Handoff(StrictModel):
    artifactId: str
    targetId: str
    clientRequestId: str = Field(min_length=1, max_length=200)


class Approval(StrictModel):
    proposalDigest: str = Field(min_length=64, max_length=64)
    artifactDigest: str = ""


def call(function, *args):
    try:
        return function(*args)
    except NotFoundError as error:
        raise HTTPException(404, {"code": "RESOURCE_NOT_FOUND", "message": "资源不存在"}) from error
    except PermissionError as error:
        raise HTTPException(403, {"code": str(error), "message": "插件或能力未启用"}) from error
    except ConflictError as error:
        raise HTTPException(
            409, {"code": str(error).split("：")[0], "message": str(error)}
        ) from error
    except (ValueError, KeyError, TypeError) as error:
        raise HTTPException(422, {"code": "INVALID_INPUT", "message": str(error)}) from error


def create_studio_router(store: StudioStore, agents: InvocationService):
    router = APIRouter(prefix="/v1/studio/workspaces", tags=["Plugin workspaces"])
    handoffs = HandoffService(store)

    @router.get("")
    def list_workspaces():
        import json

        with store.documents.connection() as db:
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT body FROM studio_objects WHERE kind='workspace' ORDER BY rowid DESC"
                )
            ]

    @router.post("")
    def create_workspace(payload: CreateWorkspace):
        return call(store.create_workspace, payload.title, payload.clientRequestId)

    @router.post("/import")
    def import_workspace(payload: ImportWorkspace):
        return call(
            store.import_workspace,
            payload.title,
            [resource.model_dump() for resource in payload.resources],
            payload.clientRequestId,
        )

    @router.get("/{workspace}/configuration")
    def configuration(workspace: str):
        return call(store.get, workspace, workspace, "workspace")

    @router.patch("/{workspace}/configuration")
    def configure(workspace: str, payload: Configuration):
        return call(
            store.configure, workspace, payload.expectedRevision, payload.plugins, payload.layouts
        )

    @router.get("/{workspace}/resources")
    def resources(workspace: str):
        return call(store.list, workspace, "resource")

    @router.post("/{workspace}/resources")
    def create_resource(workspace: str, payload: CreateResource):
        return call(
            store.create_resource,
            workspace,
            payload.resourceType,
            payload.payload,
            payload.clientRequestId,
        )

    @router.get("/{workspace}/resources/{identifier}")
    def resource(workspace: str, identifier: str):
        return call(store.get, workspace, identifier, "resource")

    @router.patch("/{workspace}/resources/{identifier}")
    def save(workspace: str, identifier: str, payload: SaveResource):
        return call(
            store.save,
            workspace,
            identifier,
            payload.expectedRevision,
            payload.payload,
            payload.clientRequestId,
        )

    @router.get("/{workspace}/resources/{identifier}/versions/{revision}")
    def version(workspace: str, identifier: str, revision: int):
        return call(store.version, workspace, identifier, revision)

    @router.get("/{workspace}/invocations")
    def invocations(workspace: str):
        return call(store.list, workspace, "invocation")

    @router.post("/{workspace}/invocations")
    async def invoke(workspace: str, payload: Invocation):
        return call(agents.create, workspace, payload.model_dump())

    @router.get("/{workspace}/invocations/{identifier}")
    def invocation(workspace: str, identifier: str):
        return call(store.get, workspace, identifier, "invocation")

    @router.post("/{workspace}/invocations/{identifier}/cancel")
    async def cancel(workspace: str, identifier: str):
        call(store.get, workspace, identifier, "invocation")
        return await agents.cancel(workspace, identifier)

    @router.post("/{workspace}/invocations/{identifier}/apply")
    def apply_invocation(workspace: str, identifier: str, payload: Approval):
        return call(agents.apply, workspace, identifier, payload.proposalDigest)

    @router.get("/{workspace}/invocations/{identifier}/events")
    def events(workspace: str, identifier: str, after: int = Query(default=0, ge=0)):
        return call(agents.events, workspace, identifier, after)

    @router.post("/{workspace}/artifacts")
    def publish(workspace: str, payload: Publish):
        return call(
            handoffs.publish,
            workspace,
            payload.resourceId,
            payload.revision,
            payload.clientRequestId,
        )

    @router.get("/{workspace}/artifacts")
    def artifacts(workspace: str):
        return call(store.list, workspace, "artifact")

    @router.post("/{workspace}/handoffs")
    def handoff(workspace: str, payload: Handoff):
        return call(
            handoffs.create,
            workspace,
            payload.artifactId,
            payload.targetId,
            payload.clientRequestId,
        )

    @router.get("/{workspace}/handoffs")
    def list_handoffs(workspace: str):
        return call(store.list, workspace, "handoff")

    @router.post("/{workspace}/handoffs/{identifier}/apply")
    def apply_handoff(workspace: str, identifier: str, payload: Approval):
        return call(
            handoffs.apply, workspace, identifier, payload.proposalDigest, payload.artifactDigest
        )

    return router
