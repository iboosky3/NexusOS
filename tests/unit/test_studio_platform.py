"""Workspace isolation, optimistic writes, immutable artifacts and Agent approval."""

import base64
import io

import pytest
from nexusos.prd.store import ConflictError, NotFoundError, PrdStore
from nexusos.studio.handoffs import HandoffService
from nexusos.studio.store import StudioStore
from PIL import Image


@pytest.fixture
def platform(tmp_path):
    store = StudioStore(PrdStore(tmp_path / "studio.sqlite"))
    workspace = store.create_workspace("测试", "create")
    return store, workspace["id"]


def prd(store, workspace, key="prd"):
    return store.create_resource(workspace, "nexus.prd", {"brief": {"title": "产品"}}, key)


def screenshot():
    image = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(image, format="PNG")
    return "data:image/png;base64," + base64.b64encode(image.getvalue()).decode()


def prototype(store, workspace):
    return store.create_resource(
        workspace,
        "nexus.prototype",
        {
            "title": "设计",
            "prototype": {
                "confirmed": True,
                "pages": [
                    {
                        "id": "home",
                        "title": "首页",
                        "description": "查看内容",
                        "elements": [],
                        "screenshot": screenshot(),
                    }
                ],
            },
        },
        "prototype",
    )


def test_resource_cas_versions_and_workspace_isolation(platform):
    store, workspace = platform
    resource = prd(store, workspace)
    next_value = {**resource["payload"], "content": "更新"}
    saved = store.save(workspace, resource["id"], 1, next_value)
    assert saved["revision"] == 2
    with pytest.raises(ConflictError):
        store.save(workspace, resource["id"], 1, next_value)
    assert store.version(workspace, resource["id"], 1)["payload"]["content"] == ""
    other = store.create_workspace("other", "other")["id"]
    with pytest.raises(NotFoundError):
        store.version(other, resource["id"], 1)


def test_idempotency_and_plugin_disable(platform):
    store, workspace = platform
    resource = prd(store, workspace)
    assert prd(store, workspace)["id"] == resource["id"]
    with pytest.raises(ConflictError, match="IDEMPOTENCY"):
        store.create_resource(workspace, "nexus.prd", {"brief": {"title": "不同"}}, "prd")
    store.configure(workspace, 1, [], {})
    with pytest.raises(PermissionError):
        store.save(workspace, resource["id"], 1, resource["payload"])
    assert store.get(workspace, resource["id"], "resource") == resource


def test_handoff_is_versioned_and_applies_once(platform):
    store, workspace = platform
    source, target = prototype(store, workspace), prd(store, workspace)
    service = HandoffService(store)
    artifact = service.publish(workspace, source["id"], 1, "publish")
    assert service.publish(workspace, source["id"], 1, "publish") == artifact
    assert "screenshotRef" in artifact["payload"]["pages"][0]
    handoff = service.create(workspace, artifact["id"], target["id"], "handoff")
    args = (workspace, handoff["id"], handoff["proposalDigest"], artifact["digest"])
    receipt = service.apply(*args)
    assert receipt["appliedRevision"] == 2
    assert service.apply(*args) == receipt
    saved = store.get(workspace, target["id"], "resource")
    assert saved["payload"]["provenance"][0]["sourceRevision"] == 1
    assert "data:image/png" in saved["payload"]["content"]


def test_handoff_conflict_does_not_commit_receipt(platform):
    store, workspace = platform
    source, target = prototype(store, workspace), prd(store, workspace)
    service = HandoffService(store)
    artifact = service.publish(workspace, source["id"], 1, "publish")
    handoff = service.create(workspace, artifact["id"], target["id"], "handoff")
    store.save(workspace, target["id"], 1, {**target["payload"], "content": "人工编辑"})
    with pytest.raises(ConflictError):
        service.apply(workspace, handoff["id"], handoff["proposalDigest"], artifact["digest"])
    assert store.get(workspace, handoff["id"], "handoff")["status"] == "waiting_confirmation"
    assert store.get(workspace, target["id"], "resource")["payload"]["content"] == "人工编辑"


def test_unconfirmed_snapshot_cannot_publish(platform):
    store, workspace = platform
    resource = prototype(store, workspace)
    resource["payload"]["prototype"]["confirmed"] = False
    saved = store.save(workspace, resource["id"], 1, resource["payload"])
    with pytest.raises(ValueError, match="确认"):
        HandoffService(store).publish(workspace, resource["id"], saved["revision"], "publish")


def test_handoff_preserves_manual_edits_and_rejects_duplicate_intent(platform):
    store, workspace = platform
    source, target = prototype(store, workspace), prd(store, workspace)
    service = HandoffService(store)
    artifact = service.publish(workspace, source["id"], 1, "publish")
    transfer = service.create(workspace, artifact["id"], target["id"], "handoff")
    service.apply(workspace, transfer["id"], transfer["proposalDigest"], artifact["digest"])
    with pytest.raises(ConflictError, match="ARTIFACT_ALREADY_APPLIED"):
        service.create(workspace, artifact["id"], target["id"], "different-request")
    saved = store.get(workspace, target["id"], "resource")
    saved["payload"]["content"] = saved["payload"]["content"].replace(
        "查看内容", "用户补充的业务规则"
    )
    store.save(workspace, target["id"], 2, saved["payload"])
    with pytest.raises(ConflictError, match="SOURCE_SECTION_EDITED"):
        service.create(workspace, artifact["id"], target["id"], "manual-edit")
    assert (
        "用户补充的业务规则" in store.get(workspace, target["id"], "resource")["payload"]["content"]
    )


def test_handoff_rejects_damaged_source_markers(platform):
    store, workspace = platform
    source, target = prototype(store, workspace), prd(store, workspace)
    service = HandoffService(store)
    artifact = service.publish(workspace, source["id"], 1, "publish")
    target["payload"]["content"] = f"<!-- studio-source:{source['id']}:start -->人工内容"
    store.save(workspace, target["id"], 1, target["payload"])
    with pytest.raises(ConflictError, match="SOURCE_MARKERS_INVALID"):
        service.create(workspace, artifact["id"], target["id"], "handoff")


def test_invalid_media_rolls_back_all_artifacts_and_blobs(platform):
    store, workspace = platform
    source = prototype(store, workspace)
    pages = source["payload"]["prototype"]["pages"]
    pages.append({**pages[0], "id": "second", "screenshot": "data:image/png;base64,aGVsbG8="})
    source = store.save(workspace, source["id"], 1, source["payload"])
    with pytest.raises(ValueError, match="SCREENSHOT_INVALID"):
        HandoffService(store).publish(workspace, source["id"], 2, "invalid")
    assert store.list(workspace, "artifact") == []
    assert store.list(workspace, "blob") == []


def test_source_update_does_not_change_old_artifact_or_target(platform):
    store, workspace = platform
    source, target = prototype(store, workspace), prd(store, workspace)
    service = HandoffService(store)
    old = service.publish(workspace, source["id"], 1, "publish")
    transfer = service.create(workspace, old["id"], target["id"], "handoff")
    service.apply(workspace, transfer["id"], transfer["proposalDigest"], old["digest"])
    adopted = store.get(workspace, target["id"], "resource")
    source["payload"]["prototype"]["pages"][0]["description"] = "新版设计"
    store.save(workspace, source["id"], 1, source["payload"])
    updated = service.publish(workspace, source["id"], 2, "publish-new")
    assert updated["digest"] != old["digest"]
    assert store.get(workspace, old["id"], "artifact") == old
    assert store.get(workspace, target["id"], "resource") == adopted
    newer = service.create(workspace, updated["id"], target["id"], "handoff-new")
    service.apply(workspace, newer["id"], newer["proposalDigest"], updated["digest"])
    current = store.get(workspace, target["id"], "resource")
    assert current["payload"]["content"].count(f"studio-source:{source['id']}:start -->") == 1
    assert current["payload"]["provenance"][0]["sourceRevision"] == 2
    assert store.version(workspace, target["id"], 2) == adopted


def test_receipt_write_failure_rolls_back_resource(platform, monkeypatch):
    store, workspace = platform
    source, target = prototype(store, workspace), prd(store, workspace)
    service = HandoffService(store)
    artifact = service.publish(workspace, source["id"], 1, "publish")
    transfer = service.create(workspace, artifact["id"], target["id"], "handoff")
    original = store.put_in

    def fail_receipt(db, item, kind):
        if kind == "handoff":
            raise OSError("disk failure")
        return original(db, item, kind)

    monkeypatch.setattr(store, "put_in", fail_receipt)
    with pytest.raises(OSError):
        service.apply(workspace, transfer["id"], transfer["proposalDigest"], artifact["digest"])
    assert store.get(workspace, target["id"], "resource") == target
    assert store.get(workspace, transfer["id"], "handoff")["status"] == "waiting_confirmation"


def test_screenshot_rejects_wrong_mime_truncation_and_large_dimensions():
    from nexusos.studio.media import screenshot_bytes

    with pytest.raises(ValueError):
        screenshot_bytes(screenshot().replace("image/png", "image/jpeg"))
    raw = base64.b64decode(screenshot().split(",")[1])[:40]
    with pytest.raises(ValueError):
        screenshot_bytes("data:image/png;base64," + base64.b64encode(raw).decode())
    image = io.BytesIO()
    Image.new("RGB", (4097, 1)).save(image, format="PNG")
    with pytest.raises(ValueError):
        screenshot_bytes("data:image/png;base64," + base64.b64encode(image.getvalue()).decode())
