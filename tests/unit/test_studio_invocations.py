"""Invocation lifecycle, fixed context, runtime selection and write approval."""

import asyncio

import pytest
from nexusos.core.models import TokenUsage
from nexusos.models import ModelResponse
from nexusos.prd.store import ConflictError, PrdStore
from nexusos.studio.agents import InvocationService
from nexusos.studio.store import StudioStore

from tests.workflow_fixtures import stage_content


@pytest.fixture
def platform(tmp_path):
    store = StudioStore(PrdStore(tmp_path / "studio.sqlite"))
    workspace = store.create_workspace("测试", "create")
    return store, workspace["id"]


def prd(store, workspace):
    return store.create_resource(workspace, "nexus.prd", {"brief": {"title": "产品"}}, "prd")


class Gateway:
    async def complete(self, request):
        return ModelResponse(
            provider="test",
            model="test",
            usage=TokenUsage(1, 1),
            finish_reason="stop",
            content=stage_content(request.metadata["stage_id"]),
        )


@pytest.mark.asyncio
async def test_agent_proposal_requires_approval_and_rechecks_plugin(platform):
    store, workspace = platform
    resource = prd(store, workspace)
    service = InvocationService(store, Gateway(), "test")
    request = {
        "resourceId": resource["id"],
        "revision": 1,
        "capabilityId": "draft",
        "instruction": "生成",
        "clientRequestId": "agent",
    }
    invocation = service.create(workspace, request)
    assert service.create(workspace, request)["id"] == invocation["id"]
    await asyncio.gather(*service.tasks.values())
    result = store.get(workspace, invocation["id"], "invocation")
    assert result["status"] == "waiting_confirmation"
    assert store.get(workspace, resource["id"], "resource")["revision"] == 1
    store.configure(workspace, 1, [], {})
    with pytest.raises(PermissionError):
        service.apply(workspace, result["id"], result["result"]["digest"])
    store.configure(workspace, 2, ["nexus.prd-writer"], {})
    assert (
        service.apply(workspace, result["id"], result["result"]["digest"])["status"] == "succeeded"
    )
    events = service.events(workspace, result["id"], 0)
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    await service.close()


@pytest.mark.asyncio
async def test_agent_cancel_never_applies_late_response(platform):
    store, workspace = platform
    resource = prd(store, workspace)
    entered = asyncio.Event()

    class SlowGateway:
        async def complete(self, request):
            entered.set()
            await asyncio.Event().wait()

    service = InvocationService(store, SlowGateway(), "test")
    invocation = service.create(
        workspace,
        {
            "resourceId": resource["id"],
            "revision": 1,
            "capabilityId": "draft",
            "instruction": "生成",
            "clientRequestId": "cancel",
        },
    )
    await entered.wait()
    cancelled = await service.cancel(workspace, invocation["id"])
    assert cancelled["status"] == "cancelled"
    assert store.get(workspace, resource["id"], "resource")["revision"] == 1


@pytest.mark.asyncio
async def test_runtime_selection_versions_and_stale_approval(platform):
    store, workspace = platform
    resource = prd(store, workspace)
    service = InvocationService(store, Gateway(), "test")
    item = service.create(
        workspace,
        {
            "resourceId": resource["id"],
            "revision": 1,
            "capabilityId": "draft",
            "instruction": "编写需求",
            "clientRequestId": "fixed",
        },
    )
    assert item["execution"]["stages"][3]["agent"]["id"] == "writer"
    assert item["execution"]["stages"][3]["agent"]["version"] == "1.0.0"
    assert item["execution"]["handlerVersion"] == "studio-workflow/1"
    store.save(workspace, resource["id"], 1, {**resource["payload"], "content": "人工内容"})
    await asyncio.gather(*service.tasks.values())
    proposal = store.get(workspace, item["id"], "invocation")
    assert proposal["status"] == "waiting_confirmation"
    assert proposal["tokenUsage"] == {"input": 7, "output": 7}
    with pytest.raises(ConflictError, match="REVISION"):
        service.apply(workspace, item["id"], proposal["result"]["digest"])
    assert service.events(workspace, item["id"], 1)[0]["sequence"] == 2
    assert store.get(workspace, resource["id"], "resource")["payload"]["content"] == "人工内容"


@pytest.mark.asyncio
async def test_retry_is_checked_in_service_and_recovery_does_not_replay(platform):
    store, workspace = platform
    resource = prd(store, workspace)
    service = InvocationService(store, Gateway(), "test")
    request = {
        "resourceId": resource["id"],
        "revision": 1,
        "capabilityId": "draft",
        "instruction": "编写需求",
        "clientRequestId": "first",
    }
    item = service.create(workspace, request)
    with pytest.raises(ConflictError, match="INVALID_RETRY"):
        service.create(workspace, {**request, "clientRequestId": "invalid", "retryOf": item["id"]})
    service.recover()
    await asyncio.gather(*service.tasks.values())
    assert store.get(workspace, item["id"], "invocation")["status"] == "interrupted"
    retried = service.create(
        workspace, {**request, "clientRequestId": "retry", "retryOf": item["id"]}
    )
    await asyncio.gather(*service.tasks.values())
    assert retried["id"] != item["id"]
    assert retried["request"]["retryOf"] == item["id"]
    assert store.get(workspace, resource["id"], "resource")["revision"] == 1


@pytest.mark.asyncio
async def test_cancel_request_stays_pending_until_uncooperative_gateway_finishes(platform):
    store, workspace = platform
    resource = prd(store, workspace)
    entered, release = asyncio.Event(), asyncio.Event()

    class UncooperativeGateway(Gateway):
        async def complete(self, request):
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                await release.wait()
            return await super().complete(request)

    service = InvocationService(store, UncooperativeGateway(), "test")
    item = service.create(
        workspace,
        {
            "resourceId": resource["id"],
            "revision": 1,
            "capabilityId": "draft",
            "instruction": "编写需求",
            "clientRequestId": "cancel",
        },
    )
    await entered.wait()
    result = await service.cancel(workspace, item["id"])
    assert result["status"] == "cancel_requested"
    release.set()
    await asyncio.gather(*service.tasks.values())
    assert store.get(workspace, item["id"], "invocation")["status"] == "cancelled"
    assert store.get(workspace, resource["id"], "resource")["revision"] == 1
