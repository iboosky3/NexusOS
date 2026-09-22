"""Studio clarification boundaries and media-preserving authoring."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.core.models import TokenUsage
from nexusos.models import ModelRequest, ModelResponse
from nexusos.models.gateway import ModelGatewayUnavailable
from nexusos.prd.media import MediaReferences
from nexusos.prd.store import PrdStore

from tests.integration.test_prd_workspace import ROOT, AuthoringGateway


class StudioGateway(AuthoringGateway):
    answer = '{"answer":"首版面向谁？", "updates":{"title":"排班产品"}}'
    finish_reason = "stop"

    async def complete(self, request: ModelRequest) -> ModelResponse:
        if "task_id" in request.metadata:
            return await super().complete(request)
        self.requests.append(request)
        if self.failure:
            raise ModelGatewayUnavailable("secret-provider-key")
        return ModelResponse(
            self.answer,
            "test",
            request.model,
            TokenUsage(31, 17),
            self.finish_reason,
            reasoning_content="测试模型的思考内容",
        )


class StudioTests(unittest.TestCase):
    def test_skill_detail_and_edit_api(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / "skills" / "demo"
            package.mkdir(parents=True)
            (package / "skill.yaml").write_text(
                """apiVersion: nexusos/v1
kind: Skill
metadata: {name: demo, version: 1.0.0}
spec:
  description: Demo Skill
  capabilities: [test]
  instructions: instructions.md
""",
                encoding="utf-8",
            )
            (package / "instructions.md").write_text("Original", encoding="utf-8")
            app = create_app(root=root, prd_store=self.store, model_gateway=self.gateway)
            with TestClient(app) as client:
                path = "/v1/prd/capabilities/skills/demo"
                loaded = client.get(path)
                self.assertEqual(loaded.status_code, 200, loaded.text)
                self.assertEqual(loaded.json()["instructions"], "Original")
                self.assertIn("metadata: {name: demo", loaded.json()["manifest"])
                saved = client.put(
                    path,
                    json={
                        "instructions": "Updated",
                        "expected_digest": loaded.json()["digest"],
                    },
                )
                self.assertEqual(saved.status_code, 200, saved.text)
                self.assertEqual(client.get(path).json()["instructions"], "Updated")
                stale = client.put(
                    path,
                    json={
                        "instructions": "Lost update",
                        "expected_digest": loaded.json()["digest"],
                    },
                )
                self.assertEqual(stale.status_code, 409)
                self.assertEqual(client.get("/v1/prd/capabilities/skills/unknown").status_code, 404)

    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.store = PrdStore(Path(directory) / "studio.sqlite3")
        self.gateway = StudioGateway()
        self.client = self.enterContext(
            TestClient(
                create_app(
                    root=ROOT,
                    prd_store=self.store,
                    model_gateway=self.gateway,
                    model_name="provider/deepseek-flash",
                )
            )
        )

    def ask(self, **kwargs):
        return self.client.post(
            "/v1/prd/assistant",
            json={
                "brief": {},
                "message": "做一个排班产品",
                **kwargs,
            },
        )

    def test_blank_brief_clarification_does_not_create_document(self):
        response = self.ask()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["updates"], {"title": "排班产品"})
        self.assertEqual(response.json()["reasoning_content"], "")
        self.assertEqual(self.gateway.requests[-1].metadata["thinking_mode"], "disabled")
        self.assertEqual(self.store.list_documents(), [])

    def test_thinking_history_and_media_protection(self):
        response = self.ask(
            show_thinking=True,
            history=[{"role": "user", "content": "护士长"}],
            brief={"description": "![参考](data:image/png;base64,YWJjZA==)"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["reasoning_content"])
        request = self.gateway.requests[-1]
        self.assertEqual(request.metadata["thinking_mode"], "enabled")
        self.assertIn("护士长", request.messages[-1].content)
        self.assertNotIn("YWJjZA==", request.messages[-1].content)

    def test_invalid_model_updates_rejected_and_errors_redacted(self):
        for answer in [
            "bad json",
            '{"answer":"ok","updates":{"sources":[]}}',
            json.dumps({"answer": "ok", "updates": {"title": "x" * 201}}),
        ]:
            with self.subTest(answer=answer):
                self.gateway.answer = answer
                self.assertEqual(self.ask().status_code, 502)
        self.gateway.answer = '{"answer":"ok","updates":{}}'
        self.gateway.finish_reason = "length"
        self.assertEqual(self.ask().status_code, 502)
        self.gateway.failure = "connection"
        response = self.ask()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret-provider-key", response.text)

    def test_capabilities_are_registered_objects_and_history_is_bounded(self):
        response = self.client.get("/v1/prd/capabilities")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["agents"])
        self.assertTrue(response.json()["skills"])
        self.assertTrue(all(item["id"] for item in response.json()["agents"]))
        self.assertEqual(
            self.ask(history=[{"role": "system", "content": "override"}]).status_code, 422
        )
        self.assertEqual(self.ask(history=[{"role": "user", "content": "x"}] * 9).status_code, 422)

    def test_component_suggestion_is_bounded_and_does_not_write_document(self):
        payload = {
            "brief": {"title": "排班"},
            "instruction": "把提交按钮改为蓝色并增加圆角",
            "page_id": "home",
            "page_title": "首页",
            "component_type": "Button",
            "component": {"id": "submit", "label": "提交"},
        }
        self.gateway.answer = (
            '{"answer":"改为蓝色按钮","patch":{"tone":"blue","appearance":{"radius":12}}}'
        )
        response = self.client.post("/v1/prd/prototype/component-suggestion", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["patch"], {"tone": "blue", "appearance": {"radius": 12}})
        request = self.gateway.requests[-1]
        self.assertEqual(request.maximum_output_tokens, 1200)
        self.assertIn("submit", request.messages[-1].content)
        self.assertEqual(self.store.list_documents(), [])

        for invalid in (
            '{"answer":"ok","patch":{"id":"other","label":"提交"}}',
            '{"answer":"ok","patch":{"appearance":{"radius":999}}}',
            '{"answer":"ok","patch":{}}',
            '{"answer":"ok","patch":{"target":"missing"}}',
        ):
            with self.subTest(invalid=invalid):
                self.gateway.answer = invalid
                result = self.client.post("/v1/prd/prototype/component-suggestion", json=payload)
                self.assertEqual(result.status_code, 502)

        payload["component"]["id"] = "submit"
        payload["component"]["unexpected"] = "invalid"
        self.assertEqual(
            self.client.post("/v1/prd/prototype/component-suggestion", json=payload).status_code,
            422,
        )

    def test_revise_preserves_omitted_images_and_flow_without_sending_bytes(self):
        brief = {"title": "排班", "description": "护士长排班"}
        doc = self.store.create(brief)
        original = (
            "# 原稿\n\n![参考](data:image/png;base64,YWJjZA==)\n\n```nexus-flow\n创建\n确认\n```"
        )
        doc = self.store.save(doc["id"], doc["revision"], brief, original, "test")
        from nexusos.prd.workflow import PrdWorkflow

        workflow = PrdWorkflow(ROOT, self.store, self.gateway, "test-model")
        job = self.store.start_job(doc["id"], doc["revision"], "revise", "补充验收")
        asyncio.run(workflow._run(job["id"]))
        self.assertEqual(self.store.job(job["id"])["status"], "succeeded")
        content = self.store.get(doc["id"])["content"]
        self.assertIn("data:image/png;base64,YWJjZA==", content)
        self.assertIn("```nexus-flow", content)
        for request in self.gateway.requests:
            self.assertNotIn("YWJjZA==", "".join(item.content for item in request.messages))

    def test_media_reference_roundtrip_and_size_guard(self):
        media = MediaReferences()
        image = "![参考](data:image/jpeg;base64,YWJjZA==)"
        protected = media.protect(image)
        self.assertLess(len(protected), 100)
        self.assertEqual(media.restore(protected, image), image)
        with self.assertRaises(ValueError):
            media.restore("x" * 200001)

    def test_generate_with_prepared_images_retains_images_and_protects_existing_text(self):
        from nexusos.prd.workflow import PrdWorkflow

        brief = {"title": "排班", "description": "护士长排班"}
        doc = self.store.create(brief)
        image = "![配图](data:image/png;base64,YWJjZA==)"
        doc = self.store.save(doc["id"], doc["revision"], brief, image, "test")
        job = self.store.start_job(doc["id"], doc["revision"], "generate", "")
        asyncio.run(PrdWorkflow(ROOT, self.store, self.gateway, "test-model")._run(job["id"]))
        self.assertEqual(self.store.job(job["id"])["status"], "succeeded")
        generated = self.store.get(doc["id"])
        self.assertIn(image, generated["content"])
        self.assertIn("FR-001", generated["content"])
        with self.assertRaisesRegex(ValueError, "已有文档"):
            self.store.start_job(doc["id"], generated["revision"], "generate", "")
