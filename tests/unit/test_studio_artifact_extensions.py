"""New artifact domains assemble without changing the handoff host."""

from dataclasses import replace

import pytest
from nexusos.prd.store import ConflictError, PrdStore
from nexusos.studio import plugins
from nexusos.studio.extensions.example_notes import plugin as notes
from nexusos.studio.handoffs import HandoffService
from nexusos.studio.plugin_contract import ArtifactConsumer, ArtifactProducer
from nexusos.studio.store import StudioStore


def assemble(monkeypatch, plugin):
    monkeypatch.setattr(
        plugins, "PLUGINS", tuple(plugin if p.id == plugin.id else p for p in plugins.PLUGINS)
    )


@pytest.fixture
def domain(tmp_path, monkeypatch):
    def prepare(source, put_media):
        return {"text": source["content"]}

    def consume(artifact, payload, target):
        return {**target, "content": target["content"] + "\n" + payload["text"]}

    plugin = replace(
        notes,
        artifact_producer=ArtifactProducer(
            "example.text", 3, prepare, lambda payload, read: payload
        ),
        artifact_consumers=(ArtifactConsumer("example.text", 3, consume),),
    )
    assemble(monkeypatch, plugin)
    store = StudioStore(PrdStore(tmp_path / "extensions.sqlite"))
    workspace = store.create_workspace("text only", "create")["id"]
    store.configure(workspace, 1, [plugin.id], {})
    source = store.create_resource(
        workspace, "nexus.note", {"title": "来源", "content": "确定内容"}, "source"
    )
    target = store.create_resource(
        workspace, "nexus.note", {"title": "接收", "content": "人工正文"}, "target"
    )
    service = HandoffService(store)
    artifact = service.publish(workspace, source["id"], 1, "publish")
    return store, workspace, service, artifact, target, plugin


def test_third_plugin_publishes_and_consumes_without_prototype_or_prd(domain):
    store, workspace, service, artifact, target, plugin = domain
    assert artifact["artifactType"] == "example.text"
    assert artifact["schemaVersion"] == 3
    assert artifact["producerPluginVersion"] == plugin.version
    assert store.list(workspace, "blob") == []
    transfer = service.create(workspace, artifact["id"], target["id"], "preview")
    assert store.get(workspace, target["id"], "resource") == target
    args = (workspace, transfer["id"], transfer["proposalDigest"], artifact["digest"])
    receipt = service.apply(*args)
    assert service.apply(*args) == receipt
    saved = store.get(workspace, target["id"], "resource")
    assert saved["payload"]["content"] == "人工正文\n确定内容"
    assert saved["revision"] == 2


def test_plugin_upgrade_requires_new_preview(domain, monkeypatch):
    store, workspace, service, artifact, target, plugin = domain
    transfer = service.create(workspace, artifact["id"], target["id"], "preview")
    assemble(monkeypatch, replace(plugin, version="2.0.0"))
    with pytest.raises(ConflictError, match="CONSUMER_CHANGED"):
        service.apply(workspace, transfer["id"], transfer["proposalDigest"], artifact["digest"])
    assert store.get(workspace, target["id"], "resource") == target
    fresh = service.create(workspace, artifact["id"], target["id"], "fresh")
    service.apply(workspace, fresh["id"], fresh["proposalDigest"], artifact["digest"])


@pytest.mark.parametrize("removed", ["producer", "consumer", "schema"])
def test_incompatible_contract_cannot_preview(domain, monkeypatch, removed):
    store, workspace, service, artifact, target, plugin = domain
    if removed == "producer":
        changed = replace(plugin, artifact_producer=None)
    elif removed == "consumer":
        changed = replace(plugin, artifact_consumers=())
    else:
        changed = replace(
            plugin, artifact_consumers=(replace(plugin.artifact_consumers[0], schema_version=4),)
        )
    assemble(monkeypatch, changed)
    with pytest.raises(ValueError, match="SCHEMA_INCOMPATIBLE"):
        service.create(workspace, artifact["id"], target["id"], "preview")
    assert store.list(workspace, "handoff") == []


def test_disabled_receiver_blocks_confirmation(domain):
    store, workspace, service, artifact, target, plugin = domain
    transfer = service.create(workspace, artifact["id"], target["id"], "preview")
    store.configure(workspace, 2, [], {})
    with pytest.raises(PermissionError):
        service.apply(workspace, transfer["id"], transfer["proposalDigest"], artifact["digest"])
    assert store.get(workspace, target["id"], "resource") == target


def test_invalid_consumer_output_rolls_back_preview(domain, monkeypatch):
    store, workspace, service, artifact, target, plugin = domain
    invalid = replace(plugin.artifact_consumers[0], propose=lambda *_: {"content": ["invalid"]})
    assemble(monkeypatch, replace(plugin, artifact_consumers=(invalid,)))
    with pytest.raises(ValueError):
        service.create(workspace, artifact["id"], target["id"], "preview")
    assert store.list(workspace, "handoff") == []
    assert store.get(workspace, target["id"], "resource") == target
