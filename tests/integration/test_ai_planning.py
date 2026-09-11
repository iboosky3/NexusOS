"""Model-proposed plans must cross validation before any node executes."""

import asyncio
import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.core.models import TokenUsage
from nexusos.models import ModelResponse
from nexusos.planning.schemas import PlanRequest, RevisePlan
from nexusos.planning.service import PlanningService
from nexusos.planning.store import PlanningStore
from nexusos.prd.schemas import StartJob
from nexusos.prd.store import PrdStore
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[2]
INTENT = {
    "goal": "设计并评审用户流程",
    "domain": "design",
    "confidence": 0.9,
    "supported": True,
    "rationale": "用户提供了需求，要求比较方案",
    "acceptance_criteria": ["比较两个流程方案"],
}


def task(key, deps=()):
    return {
        "id": key,
        "title": key,
        "objective": f"完成 {key}",
        "dependencies": deps,
        "required_capabilities": ["user_flow"],
        "expected_output": "流程分析",
        "acceptance_criteria": ["列出关键操作和异常"],
        "output_tokens": 512,
    }


PROPOSAL = {
    "rationale": "两个独立方案可并行，之后综合",
    "tasks": [
        task("a"),
        task("b"),
        task("merge", ("a", "b")),
    ],
}


class Gateway:
    def __init__(self, proposal=None, intent=None, fail=None):
        self.proposal = proposal or copy.deepcopy(PROPOSAL)
        self.intent = intent or copy.deepcopy(INTENT)
        self.fail = fail
        self.requests = []
        self.finished = []
        self.active = 0
        self.peak = 0

    async def complete(self, request):
        self.requests.append(request)
        system = request.messages[0].content
        if "Schema:" in system:
            value = self.intent if '"IntentDecision"' in system else self.proposal
            content = value if isinstance(value, str) else json.dumps(value)
        else:
            data = json.loads(request.messages[1].content)
            key = data["task"]["id"]
            if key == "merge":
                assert set(self.finished) == {"a", "b"}
                assert set(data["dependencies"]) == {"a", "b"}
            self.active += 1
            self.peak = max(self.peak, self.active)
            await asyncio.sleep(0.01)
            self.active -= 1
            if key == self.fail:
                raise RuntimeError("sensitive transport error")
            self.finished.append(key)
            content = f"产物 {key}"
        return ModelResponse(content, "test", "test-model", TokenUsage(20, 10))


class PlanningTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.store = PlanningStore(self.directory / "plans.sqlite3")

    def service(self, gateway):
        return PlanningService(ROOT, self.store, gateway, "test-model")

    def test_freezes_executes_parallel_dependencies_and_accounts_separately(self):
        async def scenario():
            gateway = Gateway()
            service = self.service(gateway)
            plan = await service.propose(PlanRequest(request="设计两个用户流程"))
            self.assertEqual(plan["status"], "frozen", plan["issues"])
            self.assertEqual(len(gateway.requests), 2)
            self.assertEqual(
                [event["name"] for event in self.store.events(plan["id"])],
                ["model.requested", "model.responded", "model.requested", "model.responded"],
            )
            self.assertEqual(plan["planning_usage"]["input_tokens"], 40)
            with self.assertRaisesRegex(ValueError, "先确认"):
                service.start(plan["id"], plan["digest"])
            service.confirm(plan["id"], plan["digest"])
            self.assertEqual(len(gateway.requests), 2)
            service.start(plan["id"], plan["digest"])
            service.start(plan["id"], plan["digest"])
            await asyncio.gather(*tuple(service.background))
            run = self.store.run(plan["id"])
            self.assertEqual(run["status"], "succeeded")
            self.assertEqual(run["input_tokens"], 60)
            self.assertEqual(gateway.peak, 2)
            self.assertEqual(len(gateway.requests), 5)
            self.assertEqual(self.store.get(plan["id"]), plan)
            self.assertTrue(
                all(
                    not s["required_tools"]
                    for s in plan["registry"]["skills"]
                    if s["id"] == "user-flow-design"
                )
            )
            for binding in plan["bindings"].values():
                self.assertEqual(binding["agent"]["id"], "ux-designer")
            return plan

        plan = asyncio.run(scenario())
        reopened = PlanningStore(self.store.path)
        self.assertEqual(reopened.get(plan["id"])["digest"], plan["digest"])
        with self.store.connection() as db, self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE nexus_plans SET body='{}' WHERE id=?", (plan["id"],))

    def test_rejects_invalid_graphs_tools_partial_coverage_and_budgets(self):
        mutations = [
            lambda p: p["tasks"][0].update(dependencies=["merge"]),
            lambda p: p["tasks"][0].update(dependencies=["missing"]),
            lambda p: p["tasks"][1].update(id="a"),
            lambda p: p["tasks"][0].update(required_capabilities=["user_flow", "unknown"]),
            lambda p: p["tasks"][0].update(required_tools=["shell"]),
            lambda p: p["tasks"][0].update(risk="high"),
            lambda p: p["tasks"][0].update(acceptance_criteria=[]),
            lambda p: p["tasks"][0].update(code="rm everything"),
            lambda p: p.update(tasks=[task(str(i)) for i in range(13)]),
        ]

        async def scenario():
            for mutate in mutations:
                proposal = copy.deepcopy(PROPOSAL)
                mutate(proposal)
                gateway = Gateway(proposal)
                service = self.service(gateway)
                plan = await service.propose(PlanRequest(request="设计流程"))
                self.assertEqual(plan["status"], "rejected", proposal)
                self.assertTrue(plan["issues"])
                with self.assertRaises(ValueError):
                    service.start(plan["id"], "0" * 64)
                self.assertEqual(len(gateway.requests), 2)
            plan = await self.service(Gateway()).propose(
                PlanRequest(request="设计流程", maximum_output_tokens=512)
            )
            self.assertEqual(plan["status"], "rejected")

        asyncio.run(scenario())

    def test_clarification_does_not_call_planner_or_execute(self):
        async def scenario():
            gateway = Gateway(intent={**INTENT, "confidence": 0.4, "questions": ["目标用户是谁？"]})
            plan = await self.service(gateway).propose(PlanRequest(request="帮我设计"))
            self.assertEqual(plan["status"], "needs_clarification")
            self.assertEqual(len(gateway.requests), 1)
            self.assertNotIn("proposal", plan)

        asyncio.run(scenario())

    def test_revisions_revalidate_bindings_and_require_new_confirmation(self):
        async def scenario():
            gateway = Gateway()
            service = self.service(gateway)
            original = await service.propose(PlanRequest(request="设计流程"))
            service.confirm(original["id"], original["digest"])
            proposal = copy.deepcopy(original["proposal"])
            proposal["tasks"][0].update(title="用户调整", agent_id="ux-designer", skill_ids=[])
            revised = service.revise(
                original["id"], RevisePlan(digest=original["digest"], proposal=proposal)
            )
            self.assertEqual(revised["version"], 2)
            self.assertEqual(revised["bindings"]["a"]["skills"], [])
            self.assertEqual(self.store.get(original["id"]), original)
            self.assertEqual(len(gateway.requests), 2)
            with self.assertRaisesRegex(ValueError, "先确认"):
                service.start(revised["id"], revised["digest"])
            for update in (
                {"agent_id": "unknown"},
                {"skill_ids": ["unknown"]},
                {"dependencies": ["merge"]},
            ):
                invalid = copy.deepcopy(proposal)
                invalid["tasks"][0].update(update)
                with self.assertRaises(ValueError):
                    service.revise(
                        original["id"], RevisePlan(digest=original["digest"], proposal=invalid)
                    )
            self.assertIn("discovery", original)
            self.assertTrue(all(not s["required_tools"] for s in original["discovery"]["skills"]))

        asyncio.run(scenario())

    def test_failed_node_blocks_dependents_and_preserves_sibling(self):
        async def scenario():
            gateway = Gateway(fail="a")
            service = self.service(gateway)
            plan = await service.propose(PlanRequest(request="设计流程"))
            service.confirm(plan["id"], plan["digest"])
            service.start(plan["id"], plan["digest"])
            await asyncio.gather(*tuple(service.background))
            run = self.store.run(plan["id"])
            self.assertEqual(run["status"], "failed")
            self.assertEqual(run["tasks"]["merge"]["status"], "blocked")
            self.assertEqual(run["tasks"]["b"]["content"], "产物 b")
            self.assertNotIn("sensitive", json.dumps(run))

        asyncio.run(scenario())

    def test_replanning_keeps_old_snapshot_and_recovery_never_replays(self):
        async def scenario():
            service = self.service(Gateway())
            first = await service.propose(PlanRequest(request="流程一"))
            second = await service.propose(PlanRequest(request="流程二", supersedes=first["id"]))
            self.assertEqual(second["version"], 2)
            self.assertEqual(self.store.get(first["id"]), first)
            self.store.claim(first["id"], first["digest"])
            self.store.recover()
            self.assertEqual(self.store.run(first["id"])["status"], "interrupted")
            run, created = self.store.claim(first["id"], first["digest"])
            self.assertFalse(created)
            self.assertEqual(run["status"], "interrupted")

        asyncio.run(scenario())

    def test_transport_preview_and_explicit_execution_boundary(self):
        gateway = Gateway()
        app = create_app(
            root=ROOT,
            prd_store=PrdStore(self.directory / "api.sqlite3"),
            model_gateway=gateway,
            model_name="test-model",
        )
        with TestClient(app) as client:
            response = client.post("/v1/planning/plans", json={"request": "设计两个流程"})
            self.assertEqual(response.status_code, 201, response.text)
            plan = response.json()
            self.assertEqual(len(gateway.requests), 2)
            self.assertEqual(client.get(f"/v1/planning/plans/{plan['id']}").json(), plan)
            bad = client.post(f"/v1/planning/plans/{plan['id']}/run", json={"digest": "0" * 64})
            self.assertEqual(bad.status_code, 409)
            base = f"/v1/planning/plans/{plan['id']}"
            self.assertEqual(
                client.post(base + "/run", json={"digest": plan["digest"]}).status_code, 409
            )
            self.assertEqual(client.get(base + "/confirmation").status_code, 404)
            self.assertEqual(
                client.post(base + "/confirmation", json={"digest": "0" * 64}).status_code, 409
            )
            self.assertEqual(
                client.post(base + "/confirmation", json={"digest": plan["digest"]}).status_code,
                200,
            )
            self.assertEqual(client.get(base + "/confirmation").json()["digest"], plan["digest"])
            self.assertEqual(len(gateway.requests), 2)
            revised = client.post(
                base + "/revision", json={"digest": plan["digest"], "proposal": plan["proposal"]}
            )
            self.assertEqual(revised.status_code, 201)
            self.assertEqual(
                client.get(f"/v1/planning/plans/{revised.json()['id']}/confirmation").status_code,
                404,
            )
            rejected = client.post("/v1/planning/plans", json={"request": "x", "unknown": True})
            self.assertEqual(rejected.status_code, 422)
            self.assertEqual(client.get("/v1/planning/configuration").status_code, 200)

    def test_prd_mode_persisted_and_unsupported_mode_rejected(self):
        store = PrdStore(self.directory / "prd.sqlite3")
        doc = store.create({"title": "排班", "description": "排班工具"})
        job = store.start_job(doc["id"], doc["revision"], "prototype", "")
        self.assertEqual(store.job(job["id"])["planning_mode"], "controlled_dynamic")
        with self.assertRaises(ValidationError):
            StartJob(expected_revision=1, planning_mode="ai_dynamic")
