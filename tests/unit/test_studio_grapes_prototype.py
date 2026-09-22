"""The opt-in GrapesJS resource uses its own schema and standard handoff."""

import base64
import hashlib
import io
import json

import pytest
from nexusos.prd.store import PrdStore
from nexusos.studio.extensions.grapes_designer import GrapesPayload
from nexusos.studio.handoffs import HandoffService
from nexusos.studio.store import StudioStore
from PIL import Image


@pytest.fixture
def instance(tmp_path):
    store = StudioStore(PrdStore(tmp_path / "grapes.sqlite"))
    workspace = store.create_workspace("grapes", "create")
    store.configure(workspace["id"], 1, ["nexus.grapes-prototype", "nexus.prd-writer"], {})
    return store, workspace["id"]


def png():
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


def payload():
    project = json.dumps(
        {"pages": [{"frames": [{"component": {"type": "text", "content": "Hello"}}]}]}
    )
    return {
        "title": "自由画布",
        "description": "用户查看首页",
        "projectJson": project,
        "screenshot": png(),
        "screenshotProjectDigest": hashlib.sha256(project.encode()).hexdigest(),
        "confirmed": True,
    }


def test_publish_and_prd_handoff(instance):
    store, workspace = instance
    source = store.create_resource(workspace, "nexus.grapes-prototype", payload(), "source")
    target = store.create_resource(workspace, "nexus.prd", {"brief": {"title": "PRD"}}, "target")
    service = HandoffService(store)
    artifact = service.publish(workspace, source["id"], 1, "publish")
    assert artifact["producerPluginId"] == "nexus.grapes-prototype"
    assert artifact["artifactType"] == "nexus.prototype.snapshot"
    assert artifact["payload"]["pages"][0]["screenshotRef"]
    preview = service.create(workspace, artifact["id"], target["id"], "preview")
    assert store.get(workspace, target["id"], "resource") == target
    service.apply(workspace, preview["id"], preview["proposalDigest"], artifact["digest"])
    saved = store.get(workspace, target["id"], "resource")
    assert saved["payload"]["provenance"][0]["sourceResourceId"] == source["id"]
    assert "data:image/png" in saved["payload"]["content"]


def test_changed_project_requires_new_screenshot(instance):
    store, workspace = instance
    source = store.create_resource(workspace, "nexus.grapes-prototype", payload(), "source")
    changed = {**source["payload"], "projectJson": '{"pages":[]}'}
    with pytest.raises(ValueError, match="截图"):
        store.save(workspace, source["id"], 1, changed)
    changed.update(confirmed=False, screenshot="", screenshotProjectDigest="")
    draft = store.save(workspace, source["id"], 1, changed)
    with pytest.raises(ValueError, match="确认"):
        HandoffService(store).publish(workspace, source["id"], draft["revision"], "publish")


@pytest.mark.parametrize(
    "project",
    [
        '{"pages":[{"script":"alert(1)"}]}',
        '{"pages":[{"attributes":{"onload":"alert(1)"}}]}',
        '{"pages":[{"attributes":{"src":"https://evil.invalid/a.png"}}]}',
        '{"pages":[{"content":"<iframe src=evil>"}]}',
        '{"styles":[{"style":{"background":"url(https://evil.invalid/a.png)"}}]}',
        '{"pages":',
    ],
)
def test_unsafe_or_corrupt_project_is_rejected(project):
    with pytest.raises(ValueError, match="GRAPES_PROJECT"):
        GrapesPayload.model_validate({"projectJson": project})
