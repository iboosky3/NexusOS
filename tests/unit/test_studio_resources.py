"""Resource invariants independent of Agent and artifact implementations."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from nexusos.prd.store import ConflictError, NotFoundError, PrdStore
from nexusos.studio.store import StudioStore


@pytest.fixture
def setup(tmp_path):
    store = StudioStore(PrdStore(tmp_path / "resources.sqlite"))
    workspace = store.create_workspace("workspace", "create")["id"]
    resource = store.create_resource(workspace, "nexus.prd", {"brief": {"title": "PRD"}}, "prd")
    return store, workspace, resource


def test_save_response_loss_replays_exact_revision(setup):
    store, workspace, resource = setup
    payload = {**resource["payload"], "content": "first"}
    saved = store.save(workspace, resource["id"], 1, payload, "save")
    store.save(workspace, resource["id"], 2, {**payload, "content": "later"}, "later")
    assert store.save(workspace, resource["id"], 1, payload, "save") == saved
    assert store.get(workspace, resource["id"], "resource")["revision"] == 3
    with pytest.raises(ConflictError, match="IDEMPOTENCY"):
        store.save(workspace, resource["id"], 1, {**payload, "content": "changed"}, "save")


def test_concurrent_cas_has_one_winner_and_preserves_history(setup):
    store, workspace, resource = setup

    def write(text):
        try:
            return store.save(
                workspace, resource["id"], 1, {**resource["payload"], "content": text}
            )
        except ConflictError:
            return None

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(write, ["A", "B"]))
    assert sum(item is not None for item in results) == 1
    assert store.version(workspace, resource["id"], 1)["payload"]["content"] == ""
    assert store.get(workspace, resource["id"], "resource")["revision"] == 2


def test_independent_prototype_and_empty_workspace(setup):
    store, workspace, resource = setup
    store.configure(workspace, 1, ["nexus.prototype-designer"], {})
    prototype = store.create_resource(workspace, "nexus.prototype", {"title": "independent"}, "p")
    assert "brief" not in prototype["payload"]
    with pytest.raises(PermissionError):
        store.save(workspace, resource["id"], 1, resource["payload"])
    store.configure(workspace, 2, [], {})
    assert len(store.list(workspace, "resource")) == 2
    other = store.create_workspace("other", "other")["id"]
    with pytest.raises(NotFoundError):
        store.version(other, prototype["id"], 1)


def test_user_cannot_forge_source_provenance(setup):
    store, workspace, resource = setup
    payload = {**resource["payload"], "provenance": [{"artifactId": "forged"}]}
    with pytest.raises(ValueError, match="PROVENANCE"):
        store.save(workspace, resource["id"], 1, payload)
    with pytest.raises(ValueError, match="PROVENANCE"):
        store.create_resource(workspace, "nexus.prd", payload, "forged")
    assert store.get(workspace, resource["id"], "resource")["revision"] == 1
