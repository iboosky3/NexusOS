"""Prototype approval, screenshot preservation and observable workflow contracts."""

import asyncio
import copy
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.core.models import TokenUsage
from nexusos.models import ModelRequest, ModelResponse
from nexusos.prd.prototype import brief_digest, parse_prototype
from nexusos.prd.schemas import Brief
from nexusos.prd.store import PrdStore
from nexusos.prd.workflow import PrdWorkflow
from pydantic import ValidationError

from tests.integration.test_prd_workspace import ROOT, AuthoringGateway

DESIGN = {
    "pages": [
        {
            "id": "home",
            "title": "班次列表",
            "description": "护士长查看班次，点击新增进入表单。",
            "elements": [{"kind": "button", "label": "新增班次", "target": "form"}],
        },
        {
            "id": "form",
            "title": "新增班次",
            "description": "填写日期和人员；重复排班时保留输入并显示冲突。",
            "elements": [{"kind": "input", "label": "值班人员"}],
        },
    ]
}
IMAGE = "data:image/png;base64,YWJjZA=="


class PrototypeGateway(AuthoringGateway):
    async def complete(self, request: ModelRequest) -> ModelResponse:
        if request.metadata.get("task_id") != "prototype":
            return await super().complete(request)
        self.requests.append(request)
        await asyncio.sleep(0.05)
        return ModelResponse(
            json.dumps(DESIGN, ensure_ascii=False),
            "test",
            request.model,
            TokenUsage(100, 60),
            "stop",
        )


class PrototypeTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.store = PrdStore(Path(directory) / "test.sqlite3")
        self.gateway = PrototypeGateway()
        self.workflow = PrdWorkflow(ROOT, self.store, self.gateway, "test-model")
        self.brief = Brief(title="排班", description="护士长安排班次").model_dump()

    def run_job(self, doc, action, instruction=""):
        job = self.store.start_job(doc["id"], doc["revision"], action, instruction)
        asyncio.run(self.workflow._run(job["id"]))
        self.assertEqual(self.store.job(job["id"])["status"], "succeeded")
        return self.store.get(doc["id"]), self.store.job(job["id"])

    def test_design_approval_generation_revision_and_trace(self):
        doc, job = self.run_job(self.store.create(self.brief), "prototype")
        self.assertFalse(doc["brief"]["prototype"]["confirmed"])
        self.assertEqual(doc["content"], "")
        self.assertEqual(job["plan"], ["prototype"])
        self.assertEqual(job["steps"][0]["status"], "succeeded")
        optional = self.store.create(copy.deepcopy(doc["brief"]))
        optional, _ = self.run_job(optional, "generate")
        self.assertNotIn("## 原型页面与交互说明", optional["content"])
        self.assertTrue(doc["brief"]["prototype"]["document"].startswith("# 原型设计方案"))
        confirmed = copy.deepcopy(doc["brief"])
        for page in confirmed["prototype"]["pages"]:
            page["screenshot"] = IMAGE
        confirmed["prototype"].update(confirmed=True, input_digest=brief_digest(confirmed))
        doc = self.store.save(doc["id"], doc["revision"], confirmed, "", "确认原型")
        doc, generation = self.run_job(doc, "generate")
        self.assertIn("## 原型页面与交互说明", doc["content"])
        self.assertIn("护士长查看班次", doc["content"])
        self.assertIn("![P1 班次列表]", doc["content"])
        self.assertIn(IMAGE, doc["content"])
        doc, revision = self.run_job(doc, "revise", "补充验收要求")
        self.assertEqual(doc["content"].count("## 原型页面与交互说明"), 1)
        self.assertEqual(doc["content"].count("![P1 班次列表]"), 1)
        for request in self.gateway.requests:
            self.assertNotIn("YWJjZA==", "".join(m.content for m in request.messages))
        with TestClient(create_app(root=ROOT, prd_store=self.store)) as client:
            first = client.get(f"/v1/prd/jobs/{generation['id']}/events?limit=2").json()
            following = client.get(
                f"/v1/prd/jobs/{generation['id']}/events?after={first['next_cursor']}&limit=100"
            ).json()
            self.assertTrue(first["items"])
            self.assertTrue(following["items"])
            self.assertLess(first["items"][-1]["sequence"], following["items"][0]["sequence"])
            self.assertTrue(all(e["job_id"] == generation["id"] for e in following["items"]))
            self.assertNotEqual(generation["id"], revision["id"])
            self.assertEqual(
                client.get(f"/v1/prd/jobs/{job['id']}/events?after=-1").status_code, 422
            )

    def test_stale_confirmation_invalidated_and_unsaved_reconfirmation_accepted(self):
        prototype = parse_prototype(json.dumps(DESIGN)).model_dump()
        for page in prototype["pages"]:
            page["screenshot"] = IMAGE
        prototype.update(confirmed=True, input_digest=brief_digest(self.brief))
        brief = {**self.brief, "prototype": prototype}
        doc = self.store.create(brief)
        changed = {**brief, "description": "新的排班范围"}
        doc = self.store.save(doc["id"], doc["revision"], changed, "", "改范围")
        self.assertFalse(doc["brief"]["prototype"]["confirmed"])
        changed = copy.deepcopy(doc["brief"])
        changed["description"] = "再次调整范围并重新核对原型"
        changed["prototype"].update(confirmed=True, input_digest=brief_digest(changed))
        doc = self.store.save(doc["id"], doc["revision"], changed, "", "确认新范围")
        self.assertTrue(doc["brief"]["prototype"]["confirmed"])

    def test_model_cannot_invent_approval_urls_or_broken_links(self):
        for mutation in ["duplicate", "target", "url", "empty", "confirmed"]:
            design = copy.deepcopy(DESIGN)
            if mutation == "duplicate":
                design["pages"][1]["id"] = "home"
            elif mutation == "target":
                design["pages"][0]["elements"][0]["target"] = "missing"
            elif mutation == "url":
                design["pages"][0]["screenshot"] = "https://example.com/tracker.png"
            elif mutation == "empty":
                design["pages"][0]["elements"] = []
            else:
                design["confirmed"] = True
            with self.subTest(mutation=mutation), self.assertRaises((ValueError, ValidationError)):
                parse_prototype(json.dumps(design))

    def test_imported_screenshot_requires_description_and_confirmation(self):
        brief = {
            **self.brief,
            "prototype": {
                "pages": [
                    {
                        "id": "imported",
                        "title": "首页",
                        "description": "查看班次列表",
                        "screenshot": IMAGE,
                    }
                ]
            },
        }
        validated = Brief.model_validate(brief)
        self.assertFalse(validated.prototype.confirmed)
        brief["prototype"]["pages"][0]["description"] = ""
        brief["prototype"]["confirmed"] = True
        with self.assertRaises(ValidationError):
            Brief.model_validate(brief)
