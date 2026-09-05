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


if __name__ == "__main__":
    unittest.main()
