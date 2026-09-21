import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from nexusos.api import create_app

ROOT = Path(__file__).resolve().parents[2]


class HttpApiTests(unittest.TestCase):
    def test_separates_liveness_and_readiness(self) -> None:
        client = TestClient(create_app(root=ROOT))

        self.assertEqual(client.get("/livez").json(), {"status": "ok"})
        readiness = client.get("/readyz")
        self.assertEqual(readiness.status_code, 200)
        self.assertEqual(readiness.json()["status"], "ready")
        self.assertEqual(len(readiness.json()["components"]), 2)

    def test_rejects_traffic_when_critical_readiness_check_fails(self) -> None:
        client = TestClient(
            create_app(root=ROOT, readiness_checks={"database": (lambda: False, True)})
        )

        response = client.get("/readyz")

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()["ready"])

    def test_creates_lists_and_reads_a_prd_run(self) -> None:
        client = TestClient(create_app(root=ROOT))

        created = client.post("/v1/prd/runs", json={"request": "面向大学生的 AI 学习笔记产品"})
        run_id = created.json()["run_id"]
        listed = client.get("/v1/runs")
        detail = client.get(f"/v1/runs/{run_id}")

        self.assertEqual(created.status_code, 200)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["items"][0]["run_id"], run_id)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["status"], "succeeded")

    def test_workspace_resources_are_versioned_and_traceable(self) -> None:
        client = TestClient(create_app(root=ROOT))
        created = client.post(
            "/v1/workspaces",
            json={"project_id": "project-1", "title": "员工导入"},
            headers={"X-Correlation-ID": "create-1"},
        )
        prd = client.put(
            "/v1/workspaces/project-1/prd",
            json={"content": "# 员工导入", "expected_version": 1},
            headers={"X-Correlation-ID": "edit-1"},
        )
        prototype = client.put(
            "/v1/workspaces/project-1/prototype",
            json={"html": "<button>上传</button>", "expected_version": 0},
            headers={"X-Correlation-ID": "edit-1"},
        )
        events = client.get("/v1/workspaces/project-1/events?after_sequence=1")

        self.assertEqual(created.status_code, 201)
        self.assertEqual(prd.status_code, 200)
        self.assertEqual(prd.json()["prd"]["version"], 2)
        self.assertEqual(prototype.json()["prototype"]["version"], 1)
        self.assertEqual(events.status_code, 200)
        self.assertEqual(len(events.json()["items"]), 2)
        self.assertEqual(events.json()["items"][0]["correlation_id"], "edit-1")

    def test_workspace_update_rejects_stale_version(self) -> None:
        client = TestClient(create_app(root=ROOT))
        client.post("/v1/workspaces", json={"project_id": "project-1", "title": "员工导入"})
        client.put(
            "/v1/workspaces/project-1/prd",
            json={"content": "first", "expected_version": 1},
        )

        stale = client.put(
            "/v1/workspaces/project-1/prd",
            json={"content": "stale", "expected_version": 1},
        )

        self.assertEqual(stale.status_code, 409)


if __name__ == "__main__":
    unittest.main()
