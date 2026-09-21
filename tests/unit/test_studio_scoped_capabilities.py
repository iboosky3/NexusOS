"""Old clarification/component abilities use the uniform snapshot and approval boundary."""

import asyncio
import json
from copy import deepcopy

import pytest
from nexusos.core.models import TokenUsage
from nexusos.models import ModelResponse
from nexusos.prd.store import ConflictError, PrdStore
from nexusos.studio.agents import InvocationService
from nexusos.studio.api import Invocation
from nexusos.studio.store import StudioStore


@pytest.fixture
def platform(tmp_path):
    store = StudioStore(PrdStore(tmp_path / "studio.sqlite"))
    return store, store.create_workspace("测试", "workspace")["id"]


class Gateway:
    def __init__(self, value):
        self.value = value
        self.calls = []

    async def complete(self, request):
        self.calls.append(request)
        return ModelResponse(json.dumps(self.value), "test", "test", TokenUsage(1, 1), "stop")


def prototype(store, workspace):
    def block(identifier, label, kind="Text", **props):
        return {"type": kind, "props": {"id": identifier, "label": label, **props}}

    return store.create_resource(
        workspace,
        "nexus.prototype",
        {
            "title": "设计",
            "description": "设计目标",
            "prototype": {
                "pages": [
                    {
                        "id": "home",
                        "title": "首页",
                        "description": "保密页面说明",
                        "screenshot": "data:image/png;base64,YQ==",
                        "design": {
                            "engine": "puck",
                            "version": 1,
                            "width": 960,
                            "content": [
                                block(
                                    "group",
                                    "布局",
                                    "Columns",
                                    left=[
                                        block(
                                            "selected",
                                            "原按钮",
                                            "Button",
                                            appearance={"padding": 17},
                                        ),
                                        block("sibling", "保密同级内容"),
                                    ],
                                ),
                            ],
                        },
                    },
                    {
                        "id": "other",
                        "title": "另一页",
                        "description": "另一页私密信息",
                        "screenshot": "data:image/png;base64,Yg==",
                        "design": {
                            "engine": "puck",
                            "version": 1,
                            "width": 960,
                            "content": [block("other-only", "另一页私密内容")],
                        },
                    },
                ],
                "confirmed": True,
                "input_digest": "a" * 64,
            },
        },
        "prototype",
    )


def request(resource, **overrides):
    return Invocation(
        **{
            "resourceId": resource["id"],
            "revision": resource["revision"],
            "capabilityId": "component",
            "instruction": "调整",
            "input": {"pageId": "home", "componentId": "selected"},
            "clientRequestId": "invoke",
            **overrides,
        }
    ).model_dump()


async def finish(service, store, workspace, item):
    await asyncio.gather(*service.tasks.values())
    return store.get(workspace, item["id"], "invocation")


@pytest.mark.asyncio
async def test_component_context_is_scoped_and_approval_patches_only_original_target(platform):
    store, workspace = platform
    resource = prototype(store, workspace)
    original = deepcopy(resource["payload"])
    gateway = Gateway(
        {"answer": "建议", "patch": {"label": "提交", "appearance": {"fontSize": 18}}}
    )
    service = InvocationService(store, gateway, "test")
    item = service.create(workspace, request(resource))
    context = json.loads(item["execution"]["sections"]["resource_data"][0])
    assert context["component"]["props"]["id"] == "selected"
    assert "left" not in context["component"]["props"]
    assert context["allowedPageIds"] == ["home", "other"]
    encoded = json.dumps(context, ensure_ascii=False)
    assert all(secret not in encoded for secret in ("保密", "私密", "base64", "sibling"))
    item = await finish(service, store, workspace, item)
    assert item["status"] == "waiting_confirmation"
    assert item["result"]["answer"] == "建议"
    assert store.get(workspace, resource["id"], "resource")["payload"] == original
    service.apply(workspace, item["id"], item["result"]["digest"])
    saved = store.get(workspace, resource["id"], "resource")
    pages = saved["payload"]["prototype"]["pages"]
    target = pages[0]["design"]["content"][0]["props"]["left"][0]
    assert target["props"]["label"] == "提交"
    assert target["props"]["appearance"]["fontSize"] == 18
    assert target["props"]["appearance"]["padding"] == 17
    assert (
        pages[0]["design"]["content"][0]["props"]["left"][1]
        == original["prototype"]["pages"][0]["design"]["content"][0]["props"]["left"][1]
    )
    assert pages[1] == original["prototype"]["pages"][1]
    assert pages[0]["screenshot"] == ""
    assert saved["payload"]["prototype"]["confirmed"] is False
    assert saved["payload"]["prototype"]["input_digest"] == ""
    assert "提交" in saved["payload"]["prototype"]["document"]
    assert saved["revision"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "inputs",
    [
        {},
        {"pageId": "missing", "componentId": "selected"},
        {"pageId": "home", "componentId": "other-only"},
        {"pageId": "home", "componentId": "selected", "label": "伪造"},
    ],
)
async def test_missing_or_cross_page_scope_rejected_before_model(platform, inputs):
    store, workspace = platform
    resource = prototype(store, workspace)
    gateway = Gateway({})
    service = InvocationService(store, gateway, "test")
    with pytest.raises(ValueError):
        service.create(workspace, request(resource, input=inputs))
    assert not gateway.calls
    assert not store.list(workspace, "invocation")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "patch",
    [
        {"id": "replacement"},
        {"left": []},
        {"target": "missing-page"},
        {"appearance": {"fontSize": 999}},
        {},
    ],
)
async def test_invalid_patch_never_creates_applicable_proposal(platform, patch):
    store, workspace = platform
    resource = prototype(store, workspace)
    service = InvocationService(store, Gateway({"answer": "建议", "patch": patch}), "test")
    item = await finish(service, store, workspace, service.create(workspace, request(resource)))
    assert item["status"] == "failed"
    assert item["result"] is None
    assert store.get(workspace, resource["id"], "resource")["revision"] == 1


@pytest.mark.asyncio
async def test_clarification_preserves_content_sources_and_provenance_until_approval(platform):
    store, workspace = platform
    resource = store.create_resource(
        workspace,
        "nexus.prd",
        {
            "brief": {"title": "产品", "sources": [{"name": "材料", "content": "原始事实"}]},
            "content": "人工正文",
        },
        "prd",
    )
    # Provenance is normally written only by the handoff transaction.
    with store.documents.connection() as db:
        resource = store.save_in(
            db,
            workspace,
            resource["id"],
            1,
            {
                **resource["payload"],
                "provenance": [{"artifactId": "existing"}],
            },
        )
    service = InvocationService(
        store, Gateway({"answer": "请确认用户群", "updates": {"audience": "设计师"}}), "test"
    )
    item = await finish(
        service,
        store,
        workspace,
        service.create(workspace, request(resource, capabilityId="clarify", input={})),
    )
    assert item["status"] == "waiting_confirmation"
    assert item["result"]["answer"] == "请确认用户群"
    assert item["execution"]["agent"]["id"] == "product-manager"
    proposed = item["result"]["payload"]
    assert proposed["content"] == "人工正文"
    assert proposed["provenance"] == resource["payload"]["provenance"]
    assert proposed["brief"]["sources"] == resource["payload"]["brief"]["sources"]
    assert proposed["brief"]["audience"] == "设计师"
    assert store.get(workspace, resource["id"], "resource")["payload"]["brief"]["audience"] == ""
    service.apply(workspace, item["id"], item["result"]["digest"])
    assert store.get(workspace, resource["id"], "resource")["payload"] == proposed


@pytest.mark.asyncio
async def test_scope_retry_cannot_change_target_and_stale_or_tampered_approval_fails(platform):
    store, workspace = platform
    resource = prototype(store, workspace)
    service = InvocationService(
        store, Gateway({"answer": "建议", "patch": {"label": "提交"}}), "test"
    )
    req = request(resource)
    parent = service.create(workspace, req)
    service.recover()
    await finish(service, store, workspace, parent)
    for change in (
        {"input": {"pageId": "home", "componentId": "group"}},
        {"instruction": "新任务"},
    ):
        with pytest.raises(ConflictError, match="INVALID_RETRY"):
            service.create(
                workspace, {**req, "clientRequestId": "bad", "retryOf": parent["id"], **change}
            )
    item = await finish(
        service,
        store,
        workspace,
        service.create(workspace, {**req, "clientRequestId": "retry", "retryOf": parent["id"]}),
    )
    assert item["request"]["input"] == req["input"]
    store.configure(workspace, 1, [], {})
    with pytest.raises(PermissionError):
        service.apply(workspace, item["id"], item["result"]["digest"])
    store.configure(workspace, 2, ["nexus.prototype-designer"], {})
    store.save(workspace, resource["id"], 1, {**resource["payload"], "title": "人工修改"})
    with pytest.raises(ConflictError, match="REVISION"):
        service.apply(workspace, item["id"], item["result"]["digest"])
    with store.documents.connection() as db:
        item["result"]["payload"]["title"] = "损坏提案"
        store.put_in(db, item, "invocation")
    with pytest.raises(ConflictError, match="APPROVAL_STALE"):
        service.apply(workspace, item["id"], item["result"]["digest"])
    assert store.get(workspace, resource["id"], "resource")["payload"]["title"] == "人工修改"
