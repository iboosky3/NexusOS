"""A third domain uses the existing resource and Invocation paths unchanged."""

import asyncio
import json

import pytest
from nexusos.core.models import TokenUsage
from nexusos.models import ModelResponse
from nexusos.prd.store import PrdStore
from nexusos.studio.agents import InvocationService
from nexusos.studio.store import StudioStore


@pytest.mark.asyncio
async def test_opt_in_third_plugin_saves_and_applies_own_proposal(tmp_path):
    store = StudioStore(PrdStore(tmp_path / "third.sqlite"))
    workspace = store.create_workspace("third", "create")["id"]
    with pytest.raises(PermissionError):
        store.create_resource(workspace, "nexus.note", {"title": "Note"}, "note")
    store.configure(workspace, 1, ["nexus.example-notes"], {})
    resource = store.create_resource(workspace, "nexus.note", {"title": "Note"}, "note")

    class Gateway:
        async def complete(self, request):
            assert request.metadata["agent_id"] == "writer"
            return ModelResponse(
                json.dumps({"title": "Edited", "content": "Note content"}),
                "test",
                request.model,
                TokenUsage(1, 1),
                "stop",
            )

    service = InvocationService(store, Gateway(), "test")
    task = service.create(
        workspace,
        {
            "resourceId": resource["id"],
            "revision": 1,
            "capabilityId": "revise",
            "instruction": "整理便签",
            "clientRequestId": "invoke",
        },
    )
    await asyncio.gather(*service.tasks.values())
    proposal = store.get(workspace, task["id"], "invocation")
    assert proposal["status"] == "waiting_confirmation"
    service.apply(workspace, task["id"], proposal["result"]["digest"])
    assert store.get(workspace, resource["id"], "resource")["payload"]["title"] == "Edited"
    assert store.version(workspace, resource["id"], 1)["payload"]["title"] == "Note"
    assert len(store.list(workspace, "resource")) == 1
