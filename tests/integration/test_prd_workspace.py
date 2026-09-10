"""Exercise persistence, model orchestration, and failure semantics through HTTP."""

import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.core.models import TokenUsage
from nexusos.models import ModelRequest, ModelResponse
from nexusos.models.gateway import ModelGatewayUnavailable
from nexusos.prd.schemas import Brief, Source
from nexusos.prd.store import ConflictError, PrdStore

ROOT = Path(__file__).resolve().parents[2]


class AuthoringGateway:
    def __init__(self, failure: str = "") -> None:
        self.requests: list[ModelRequest] = []
        self.failure = failure

    async def complete(self, request: ModelRequest) -> ModelResponse:
        self.requests.append(request)
        await asyncio.sleep(0.01)
        task = request.metadata["task_id"]
        if self.failure == "slow":
            await asyncio.sleep(10)
        if self.failure == "connection":
            raise ModelGatewayUnavailable("secret provider error must not reach the client")
        if task == "review":
            output = json.dumps(
                {
                    "summary": "需要确认验收口径",
                    "issues": [
                        {
                            "severity": "major",
                            "section": "FR-001",
                            "problem": "缺少成功指标口径",
                            "suggestion": "补充事件与分母定义",
                        }
                    ],
                }
            )
            if self.failure == "review":
                output = "不是结构化评审"
        elif task == "write":
            output = "# 排班产品 PRD\n\n## FR-001 班次冲突\n\n引用 [S1]，禁止重复排班。"
        else:
            output = f"## {task}\n\nFR-001 班次冲突；AC-001 重复排班被阻止。"
        return ModelResponse(
            output,
            "test",
            request.model,
            TokenUsage(101, 51),
            "length" if self.failure == "truncated" and task == "write" else "stop",
        )


class PrdWorkspaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = PrdStore(Path(self.directory.name) / "prd.sqlite3")
        self.gateway = AuthoringGateway()
        self.client = self.enterContext(
            TestClient(
                create_app(
                    root=ROOT,
                    prd_store=self.store,
                    model_gateway=self.gateway,
                    model_name="test-model",
                )
            )
        )
        self.brief = Brief(
            title="排班产品",
            description="面向医院排班主管",
            scope="仅排班，不做记账",
            constraints="单人不得被重复排班",
            sources=[Source(name="排班访谈", content="护士长需要发现冲突")],
        ).model_dump()

    def create(self):
        response = self.client.post("/v1/prd/documents", json=self.brief)
        self.assertEqual(response.status_code, 201)
        return response.json()

    def start(self, item, action="generate", instruction=""):
        response = self.client.post(
            f"/v1/prd/documents/{item['id']}/jobs",
            json={
                "expected_revision": item["revision"],
                "action": action,
                "instruction": instruction,
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def finish(self, job):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            response = self.client.get(f"/v1/prd/jobs/{job['id']}").json()
            if response["status"] in {"succeeded", "failed", "cancelled"}:
                return response
            time.sleep(0.02)
        self.fail("job did not terminate")

    def test_generates_routes_reviews_and_persists_original_context(self):
        item = self.create()
        job = self.finish(self.start(item))
        self.assertEqual(job["status"], "succeeded", job)
        self.assertEqual(len(job["steps"]), 5)
        self.assertEqual(job["input_tokens"], 505)
        self.assertEqual(job["output_tokens"], 255)
        self.assertTrue(all(step["skill_ids"] for step in job["steps"]))
        for request in self.gateway.requests:
            self.assertIn("仅排班，不做记账", request.messages[-1].content)
            self.assertIn("护士长需要发现冲突", request.messages[-1].content)
            self.assertIn('"id": "S1"', request.messages[-1].content)
        item = self.client.get(f"/v1/prd/documents/{item['id']}").json()
        self.assertIsNone(item["active_job_id"])
        self.assertIn("FR-001", item["content"])
        self.assertNotIn("快速记账", item["content"])
        self.assertEqual(item["review"]["status"], "needs_revision")
        self.assertNotIn("overall_score", item["review"])
        reopened = PrdStore(self.store.path).get(item["id"])
        self.assertEqual(reopened, {k: v for k, v in item.items() if k != "questions"})
        versions = self.client.get(f"/v1/prd/documents/{item['id']}/versions").json()["items"]
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0]["content"], item["content"])

    def test_revisions_use_edited_document_and_feedback_without_losing_history(self):
        item = self.create()
        self.finish(self.start(item))
        item = self.store.get(item["id"])
        content = item["content"] + "\n\n人工确认：夜班时长为 8 小时。"
        item = self.client.put(
            f"/v1/prd/documents/{item['id']}",
            json={
                "expected_revision": item["revision"],
                "brief": self.brief,
                "content": content,
            },
        ).json()
        self.assertIsNone(item["review"])
        job = self.finish(self.start(item, "revise", "补充请假冲突规则，保留夜班时长"))
        self.assertEqual(job["status"], "succeeded")
        writer = self.gateway.requests[-2]
        self.assertIn("夜班时长为 8 小时", writer.messages[-1].content)
        self.assertIn("补充请假冲突规则", writer.messages[-1].content)
        self.assertEqual(len(self.store.versions(item["id"])), 3)

    def test_rejects_stale_saves_and_does_not_create_duplicate_versions(self):
        item = self.create()
        url = f"/v1/prd/documents/{item['id']}"
        payload = {"expected_revision": 1, "brief": self.brief, "content": "# 人工 PRD"}
        saved = self.client.put(url, json=payload)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.client.put(url, json=payload).status_code, 409)
        payload["expected_revision"] = saved.json()["revision"]
        self.client.put(url, json=payload)
        self.assertEqual(len(self.store.versions(item["id"])), 1)

    def test_rejects_overlapping_jobs_and_edits_then_supports_cancellation(self):
        self.gateway.failure = "slow"
        item = self.create()
        job = self.start(item)
        url = f"/v1/prd/documents/{item['id']}"
        self.assertEqual(
            self.client.post(url + "/jobs", json={"expected_revision": 1}).status_code, 409
        )
        self.assertEqual(
            self.client.put(
                url,
                json={
                    "expected_revision": 1,
                    "brief": self.brief,
                    "content": "不能覆盖",
                },
            ).status_code,
            409,
        )
        response = self.client.post(f"/v1/prd/jobs/{job['id']}/cancel")
        self.assertEqual(response.json()["status"], "cancelled")
        self.assertIsNone(self.store.get(item["id"])["active_job_id"])

    def test_review_failure_preserves_generated_draft(self):
        self.gateway.failure = "review"
        item = self.create()
        job = self.finish(self.start(item))
        self.assertEqual(job["status"], "failed")
        item = self.store.get(item["id"])
        self.assertTrue(item["content"])
        self.assertIsNone(item["review"])
        self.assertIsNone(item["active_job_id"])
        self.gateway.failure = ""
        retried = self.finish(self.start(item, "review"))
        self.assertEqual(retried["status"], "succeeded")
        self.assertEqual(len(self.store.versions(item["id"])), 1)

    def test_truncated_output_never_replaces_document(self):
        self.gateway.failure = "truncated"
        item = self.create()
        job = self.finish(self.start(item))
        self.assertEqual(job["status"], "failed")
        self.assertEqual(self.store.get(item["id"])["content"], "")

    def test_provider_error_is_actionable_without_leaking_provider_details(self):
        self.gateway.failure = "connection"
        item = self.create()
        job = self.finish(self.start(item))
        self.assertEqual(job["status"], "failed")
        self.assertNotIn("secret", job["error"])
        self.assertIn("模型连接失败", job["error"])

    def test_missing_model_does_not_fall_back_to_demo(self):
        with patch.dict("os.environ", {"NEXUS_MODEL_NAME": ""}):
            client = TestClient(create_app(root=ROOT, prd_store=self.store))
        item = self.create()
        self.assertFalse(client.get("/v1/prd/configuration").json()["configured"])
        response = client.post(
            f"/v1/prd/documents/{item['id']}/jobs", json={"expected_revision": 1}
        )
        self.assertEqual(response.status_code, 503)
        self.assertIsNone(self.store.get(item["id"])["active_job_id"])

    def test_input_validation_and_missing_resources(self):
        self.assertEqual(
            self.client.post("/v1/prd/documents", json={"title": " "}).status_code, 422
        )
        self.assertEqual(
            self.client.post(
                "/v1/prd/documents",
                json={
                    "title": "x",
                    "sources": [{"name": "x", "content": "x" * 20001}],
                },
            ).status_code,
            422,
        )
        self.assertEqual(self.client.get("/v1/prd/documents/absent").status_code, 404)
        self.assertEqual(self.client.get("/v1/prd/jobs/absent").status_code, 404)
        item = self.create()
        self.assertGreater(len(item["questions"]), 0)
        self.assertEqual(
            self.client.post(
                f"/v1/prd/documents/{item['id']}/jobs",
                json={
                    "expected_revision": 1,
                    "action": "revise",
                    "instruction": "改一下",
                },
            ).status_code,
            422,
        )

    def test_restart_marks_interrupted_jobs_without_replaying_paid_calls(self):
        item = self.store.create(self.brief)
        job = self.store.start_job(item["id"], 1, "generate", "")
        reopened = PrdStore(self.store.path)
        reopened.recover()
        self.assertEqual(reopened.job(job["id"])["status"], "failed")
        self.assertIsNone(reopened.get(item["id"])["active_job_id"])
        self.assertEqual(self.gateway.requests, [])
        with self.assertRaises(ConflictError):
            reopened.publish(job["id"], content="late output")

    def test_over_budget_inputs_fail_without_dropping_sources_or_calling_model(self):
        self.brief["description"] = "需" * 12000
        self.brief["scope"] = "范" * 8000
        self.brief["sources"] = [
            {"name": "访谈一", "content": "证" * 20000},
            {"name": "访谈二", "content": "据" * 20000},
            {"name": "访谈三", "content": "材" * 10000},
        ]
        item = self.create()
        job = self.finish(self.start(item))
        self.assertEqual(job["status"], "failed")
        self.assertIn("上下文预算", job["error"])
        self.assertEqual(self.gateway.requests, [])
        self.assertEqual(self.store.get(item["id"])["brief"], self.brief)
