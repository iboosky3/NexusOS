"""Persist editable plugin designs and keep rendering payloads out of model context."""

import copy
import json
import unittest

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.prd.prototype import (
    Prototype,
    PrototypeDesign,
    brief_digest,
    parse_prototype,
    prototype_appendix,
)
from pydantic import ValidationError

from tests.integration import test_prd_prototype as prototype_tests
from tests.integration.test_prd_workspace import ROOT

IMAGE = prototype_tests.IMAGE


def block(kind="Button", id="button-one", target=""):
    return {
        "type": kind,
        "props": {
            "id": id,
            "label": "提交",
            "detail": "保存表单并返回列表",
            "target": target,
            "tone": "green",
            "left": [],
            "right": [],
        },
    }


def design():
    return {"engine": "puck", "version": 1, "width": 960, "content": [block()]}


class DesignerWorkflowTests(unittest.TestCase):
    setUp = prototype_tests.PrototypeTests.setUp
    run_job = prototype_tests.PrototypeTests.run_job

    def test_editable_design_roundtrip_and_generation_context(self):
        brief = {
            **self.brief,
            "prototype": {
                "pages": [
                    {
                        "id": "form",
                        "title": "申请表单",
                        "description": "用户填写信息后提交。",
                        "design": design(),
                    }
                ]
            },
        }
        with TestClient(create_app(root=ROOT, prd_store=self.store)) as client:
            response = client.post("/v1/prd/documents", json=brief)
            self.assertEqual(response.status_code, 201, response.text)
            doc = response.json()
            self.assertEqual(
                doc["brief"]["prototype"]["pages"][0]["design"],
                PrototypeDesign.model_validate(design()).model_dump(),
            )
            self.assertIn("# 原型设计方案", doc["brief"]["prototype"]["document"])
            self.assertIn("提交", doc["brief"]["prototype"]["document"])
            self.assertEqual(doc["brief"]["prototype"]["pages"][0]["elements"][0]["label"], "提交")
            self.assertEqual(
                client.get(f"/v1/prd/documents/{doc['id']}").json()["brief"]["prototype"],
                doc["brief"]["prototype"],
            )
        confirmed = copy.deepcopy(doc["brief"])
        confirmed["prototype"]["pages"][0]["screenshot"] = IMAGE
        confirmed["prototype"].update(confirmed=True, input_digest=brief_digest(confirmed))
        doc = self.store.save(
            doc["id"],
            doc["revision"],
            confirmed,
            prototype_appendix(Prototype.model_validate(confirmed["prototype"])),
            "确认设计",
        )
        doc, _ = self.run_job(doc, "generate")
        self.assertIn(IMAGE, doc["content"])
        self.assertEqual(doc["content"].count("<!-- nexus-prototype:start -->"), 1)
        with self.assertRaisesRegex(ValueError, "已有文档"):
            self.store.start_job(doc["id"], doc["revision"], "generate", "")
        self.assertIn("用户填写信息后提交", doc["content"])
        for request in self.gateway.requests:
            text = "".join(message.content for message in request.messages)
            self.assertNotIn("button-one", text)
            self.assertNotIn("YWJjZA==", text)
        self.assertTrue(
            any(
                "提交" in message.content
                for request in self.gateway.requests
                for message in request.messages
            )
        )


class DesignerSchemaTests(unittest.TestCase):
    def test_row_layout_and_styles_roundtrip(self):
        value = design()
        row = block("Row", "row")
        row["props"]["appearance"] = {"gap": 24, "align": "end", "wrap": "nowrap"}
        row["props"]["left"] = [block("Input", "input"), block(id="submit"), block(id="cancel")]
        row["props"]["left"][1]["props"]["appearance"] = {
            "width": 180,
            "height": 56,
            "fontSize": 20,
            "radius": 16,
            "color": "#ffffff",
            "background": "#315fba",
        }
        value["content"] = [row]
        validated = PrototypeDesign.model_validate(value)
        self.assertEqual([e.kind for e in validated.elements()], ["input", "button", "button"])
        self.assertEqual(validated.content[0].props.left[1].props.appearance.width, 180)
        self.assertEqual(
            PrototypeDesign.model_validate_json(validated.model_dump_json()), validated
        )
        for invalid in [
            {"width": -1},
            {"fontSize": 500},
            {"background": "url(https://example.com)"},
            {"position": "absolute"},
        ]:
            row["props"]["appearance"] = invalid
            with self.assertRaises(ValidationError):
                PrototypeDesign.model_validate(value)

    def test_rejects_executable_unknown_and_oversized_designs(self):
        for mutate in [
            lambda d: d.update(engine="html"),
            lambda d: d.update(version=2),
            lambda d: d["content"][0]["props"].update(html="<script>alert(1)</script>"),
            lambda d: d["content"][0].update(type="Script"),
            lambda d: d["content"].append(copy.deepcopy(d["content"][0])),
            lambda d: d.update(content=[block(id=f"b{i}") for i in range(65)]),
        ]:
            value = design()
            mutate(value)
            with self.assertRaises(ValidationError):
                PrototypeDesign.model_validate(value)

    def test_nested_summary_links_and_empty_draft(self):
        value = design()
        value["content"] = [block("Columns", "layout")]
        value["content"][0]["props"]["left"] = [block(target="missing")]
        with self.assertRaisesRegex(ValidationError, "跳转目标"):
            Prototype.model_validate({"pages": [{"id": "home", "title": "页面", "design": value}]})
        empty = {
            "pages": [
                {
                    "id": "home",
                    "title": "页面",
                    "description": "说明",
                    "design": {**design(), "content": []},
                }
            ]
        }
        self.assertFalse(Prototype.model_validate(empty).confirmed)
        empty["confirmed"] = True
        empty["pages"][0]["screenshot"] = IMAGE
        with self.assertRaises(ValidationError):
            Prototype.model_validate(empty)
        with self.assertRaisesRegex(ValueError, "模型原型"):
            parse_prototype(
                json.dumps({"pages": [{"id": "home", "title": "页面", "design": design()}]})
            )
