"""New API owns PRD workflow writes; stages are durable execution evidence only."""

import asyncio
from dataclasses import replace

import pytest
from nexusos.core.models import TokenUsage
from nexusos.models import ModelResponse
from nexusos.prd.store import ConflictError, PrdStore
from nexusos.studio.agents import InvocationService
from nexusos.studio.store import StudioStore, digest

from tests.workflow_fixtures import stage_content


@pytest.fixture
def platform(tmp_path):
    store = StudioStore(PrdStore(tmp_path / "studio.sqlite"))
    workspace = store.create_workspace("测试", "workspace")["id"]
    resource = store.create_resource(
        workspace,
        "nexus.prd",
        {
            "brief": {
                "title": "需求",
                "scope": "只做需求",
                "sources": [{"name": "访谈", "content": "事实"}],
            },
            "content": "人工正文",
        },
        "resource",
    )
    return store, workspace, resource


class Gateway:
    def __init__(self, failure=None, observer=None):
        self.calls = []
        self.failure = failure
        self.observer = observer

    async def complete(self, request):
        self.calls.append(request)
        stage = request.metadata["stage_id"]
        if self.observer:
            self.observer(stage)
        content = "invalid" if stage == self.failure else stage_content(stage)
        return ModelResponse(content, "test", request.model, TokenUsage(2, 3), "stop")


def request(resource, capability="draft", key="invoke"):
    return {
        "resourceId": resource["id"],
        "revision": resource["revision"],
        "capabilityId": capability,
        "instruction": "只做需求；需要人工确认",
        "clientRequestId": key,
    }


async def finished(service, store, workspace, item):
    await asyncio.gather(*service.tasks.values())
    return store.get(workspace, item["id"], "invocation")


@pytest.mark.asyncio
async def test_seven_stages_keep_resource_unchanged_and_survive_service_recreation(platform):
    store, workspace, resource = platform

    def observe(stage):
        assert store.get(workspace, resource["id"], "resource") == resource
        assert store.documents.list_documents() == []

    gateway = Gateway(observer=observe)
    service = InvocationService(store, gateway, "test")
    item = await finished(service, store, workspace, service.create(workspace, request(resource)))
    assert item["status"] == "waiting_confirmation"
    assert len(item["progress"]) == len(gateway.calls) == 7
    assert all(stage["status"] == "succeeded" for stage in item["progress"].values())
    assert item["result"]["payload"]["brief"] == resource["payload"]["brief"]
    assert "人工验收" in item["result"]["answer"]
    for call in gateway.calls:
        assert "只做需求；需要人工确认" in str(call.messages)
    assert [stage["agent"]["id"] for stage in item["execution"]["stages"]] == [
        "product-manager",
        "ux-designer",
        "architect",
        "writer",
        "writer",
        "writer",
        "reviewer",
    ]
    assert item["tokenUsage"] == {"input": 14, "output": 21}
    second = InvocationService(StudioStore(store.documents), gateway, "test")
    second.recover()
    events = second.events(workspace, item["id"], 0)
    assert len([e for e in events if e["type"] == "stage.succeeded"]) == 7
    for stage in item["progress"].values():
        assert stage["digest"] == digest(stage["content"])
    second.apply(workspace, item["id"], item["result"]["digest"])
    assert store.get(workspace, resource["id"], "resource")["revision"] == 2
    assert store.version(workspace, resource["id"], 1)["payload"]["content"] == "人工正文"


@pytest.mark.asyncio
async def test_review_failure_retains_stage_records_without_publishing_and_retry_starts_new_run(
    platform,
):
    store, workspace, resource = platform
    gateway = Gateway(failure="review")
    service = InvocationService(store, gateway, "test")
    req = request(resource)
    item = await finished(service, store, workspace, service.create(workspace, req))
    assert item["status"] == "failed"
    assert item["result"] is None
    assert item["progress"]["review"]["status"] == "failed"
    assert len([p for p in item["progress"].values() if p["status"] == "succeeded"]) == 6
    assert store.get(workspace, resource["id"], "resource") == resource
    gateway.failure = None
    retry = await finished(
        service,
        store,
        workspace,
        service.create(workspace, {**req, "clientRequestId": "retry", "retryOf": item["id"]}),
    )
    assert retry["status"] == "waiting_confirmation"
    assert len(gateway.calls) == 14
    assert store.get(workspace, item["id"], "invocation")["status"] == "failed"


@pytest.mark.asyncio
@pytest.mark.parametrize("capability, count", [("revise", 4), ("review", 1)])
async def test_revision_and_read_only_review_have_own_plans(platform, capability, count):
    store, workspace, resource = platform
    service = InvocationService(store, Gateway(), "test")
    item = await finished(
        service, store, workspace, service.create(workspace, request(resource, capability))
    )
    assert len(item["progress"]) == count
    assert item["status"] == ("succeeded" if capability == "review" else "waiting_confirmation")
    if capability == "review":
        assert "payload" not in item["result"]
        assert "FR" in item["result"]["answer"]  # Deterministic traceability review still runs.
    assert store.get(workspace, resource["id"], "resource") == resource


@pytest.mark.asyncio
async def test_cancel_late_reply_does_not_start_next_stage(platform):
    store, workspace, resource = platform
    entered, release = asyncio.Event(), asyncio.Event()

    class LateGateway(Gateway):
        async def complete(self, request):
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                await release.wait()
            return await super().complete(request)

    gateway = LateGateway()
    service = InvocationService(store, gateway, "test")
    item = service.create(workspace, request(resource))
    await entered.wait()
    assert (await service.cancel(workspace, item["id"]))["status"] == "cancel_requested"
    release.set()
    result = await finished(service, store, workspace, item)
    assert result["status"] == "cancelled"
    assert len(gateway.calls) == 1
    assert result["progress"]["requirements"]["status"] == "cancelled"
    assert store.get(workspace, resource["id"], "resource") == resource


@pytest.mark.asyncio
async def test_plugin_disable_prevents_following_stages(platform):
    store, workspace, resource = platform
    gateway = Gateway(observer=lambda _: store.configure(workspace, 1, [], {}))
    service = InvocationService(store, gateway, "test")
    item = await finished(service, store, workspace, service.create(workspace, request(resource)))
    assert item["status"] == "failed"
    assert len(gateway.calls) == 1
    assert store.get(workspace, resource["id"], "resource") == resource


@pytest.mark.asyncio
async def test_new_revision_rejects_workflow_approval(platform):
    store, workspace, resource = platform
    service = InvocationService(store, Gateway(), "test")
    item = service.create(workspace, request(resource))
    store.save(workspace, resource["id"], 1, {**resource["payload"], "content": "人工修改"})
    item = await finished(service, store, workspace, item)
    with pytest.raises(ConflictError, match="REVISION"):
        service.apply(workspace, item["id"], item["result"]["digest"])
    assert store.get(workspace, resource["id"], "resource")["payload"]["content"] == "人工修改"


@pytest.mark.asyncio
async def test_handoff_sections_and_provenance_survive_generation(platform):
    store, workspace, resource = platform
    section = (
        "<!-- studio-source:design:start -->\n![截图](/api/studio/media/image)\n"
        "设计来源 r3\n<!-- studio-source:design:end -->"
    )
    with store.documents.connection() as db:
        resource = store.save_in(
            db,
            workspace,
            resource["id"],
            1,
            {
                **resource["payload"],
                "content": "原有正文\n" + section,
                "provenance": [{"sourceResourceId": "design", "sectionDigest": digest(section)}],
            },
        )
    service = InvocationService(store, Gateway(), "test")
    item = await finished(service, store, workspace, service.create(workspace, request(resource)))
    proposed = item["result"]["payload"]
    assert section in proposed["content"]
    assert proposed["content"].count("studio-source:design:start") == 1
    assert proposed["provenance"] == resource["payload"]["provenance"]


@pytest.mark.asyncio
async def test_third_plugin_can_supply_workflow_without_platform_branches(platform, monkeypatch):
    from nexusos.studio import plugins
    from nexusos.studio.plugin_contract import AgentCapability, AgentWorkflow, WorkflowStage

    store, workspace, _ = platform
    workflow = AgentWorkflow(
        "notes/1",
        (
            WorkflowStage(
                "organize",
                "整理",
                "整理便签",
                ("structured_writing",),
                "保持事实",
                lambda source, outputs: source,
            ),
        ),
        lambda source, outputs: {**source, "content": outputs["organize"]},
    )
    notes = replace(
        plugins.PLUGINS[0],
        actions=(AgentCapability("revise", ("structured_writing",), workflow=workflow),),
    )
    monkeypatch.setattr(plugins, "PLUGINS", (notes, *plugins.PLUGINS[1:]))
    store.configure(workspace, 1, [notes.id], {})
    resource = store.create_resource(workspace, notes.resource_type, {"title": "便签"}, "note")

    class NotesGateway:
        async def complete(self, request):
            return ModelResponse("整理完成", "test", "test", TokenUsage(1, 1), "stop")

    service = InvocationService(store, NotesGateway(), "test")
    item = await finished(
        service, store, workspace, service.create(workspace, request(resource, "revise"))
    )
    assert item["status"] == "waiting_confirmation"
    assert item["progress"]["organize"]["status"] == "succeeded"
    service.apply(workspace, item["id"], item["result"]["digest"])
    assert store.get(workspace, resource["id"], "resource")["payload"]["content"] == "整理完成"
