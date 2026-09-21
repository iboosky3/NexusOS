"""HTTP boundary regression tests for the independent plugin workbench."""

from pathlib import Path

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.prd.store import PrdStore

ROOT = Path(__file__).resolve().parents[2]
BASE = "/v1/studio/workspaces"


def test_configuration_resource_errors_and_old_routes(tmp_path):
    with TestClient(create_app(root=ROOT, prd_store=PrdStore(tmp_path / "test.sqlite"))) as client:
        old = client.post("/v1/workspaces", json={"project_id": "legacy", "title": "旧项目"})
        assert old.status_code == 201
        created = client.post(BASE, json={"title": "新工作区", "clientRequestId": "workspace"})
        assert created.status_code == 200
        workspace = created.json()["id"]
        resource = client.post(
            f"{BASE}/{workspace}/resources",
            json={
                "resourceType": "nexus.prd",
                "payload": {"brief": {"title": "需求"}},
                "clientRequestId": "resource",
            },
        ).json()
        path = f"{BASE}/{workspace}/resources/{resource['id']}"
        saved = client.patch(
            path,
            json={"expectedRevision": 1, "payload": resource["payload"], "clientRequestId": "save"},
        )
        assert saved.status_code == 200
        assert (
            client.patch(
                path,
                json={
                    "expectedRevision": 1,
                    "payload": resource["payload"],
                    "clientRequestId": "conflict",
                },
            ).status_code
            == 409
        )
        assert (
            client.get(f"{BASE}/not-this-workspace/resources/{resource['id']}").status_code == 404
        )
        assert (
            client.patch(
                f"{BASE}/{workspace}/configuration", json={"expectedRevision": 1, "plugins": []}
            ).status_code
            == 200
        )
        assert (
            client.patch(
                path,
                json={
                    "expectedRevision": 2,
                    "payload": resource["payload"],
                    "clientRequestId": "disabled",
                },
            ).status_code
            == 403
        )
        assert client.get(path).status_code == 200


def test_project_import_http_is_atomic(tmp_path):
    with TestClient(
        create_app(root=ROOT, prd_store=PrdStore(tmp_path / "import.sqlite"))
    ) as client:
        payload = {
            "schemaVersion": 1,
            "title": "HTTP 导入项目",
            "clientRequestId": "import",
            "resources": [{"resourceType": "nexus.prd", "payload": {"brief": {"title": "文档"}}}],
        }
        created = client.post(f"{BASE}/import", json=payload)
        assert created.status_code == 200
        identifier = created.json()["id"]
        assert len(client.get(f"{BASE}/{identifier}/resources").json()) == 1
        assert client.post(f"{BASE}/import", json=payload).json()["id"] == identifier
        invalid = {
            **payload,
            "clientRequestId": "bad",
            "resources": [
                *payload["resources"],
                {"resourceType": "nexus.note", "payload": {"title": ""}},
            ],
        }
        assert client.post(f"{BASE}/import", json=invalid).status_code == 422
        assert len(client.get(BASE).json()) == 1
