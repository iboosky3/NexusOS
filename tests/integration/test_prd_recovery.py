"""Exercise explicit restart and durable stage recovery through the public API."""

import asyncio
import json
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.models.gateway import ModelGatewayUnavailable
from nexusos.prd.store import PrdStore

from tests.integration import test_prd_execution_trace as trace_tests
from tests.integration.test_prd_workspace import AuthoringGateway

ROOT = trace_tests.ROOT


class RecoveryGateway(AuthoringGateway):
    fail_stage = "write-2"

    async def complete(self, request):
        if request.metadata["stage_id"] == self.fail_stage:
            self.requests.append(request)
            raise ModelGatewayUnavailable("controlled failure")
        return await super().complete(request)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = PrdStore(Path(self.directory.name) / "trace.sqlite3")
        self.gateway = AuthoringGateway()
        self.client = self.enterContext(
            TestClient(
                create_app(
                    root=ROOT,
                    prd_store=self.store,
                    model_gateway=self.gateway,
                    model_name="deepseek-flash",
                )
            )
        )
        self.document = self.client.post(
            "/v1/prd/documents",
            json={
                "title": "排班追溯",
                "description": "必须保留的原始要求",
            },
        ).json()

    start = trace_tests.ExecutionTraceTests.start
    finish = trace_tests.ExecutionTraceTests.finish
    trace = trace_tests.ExecutionTraceTests.trace

    def fail_at(self, stage="write-2"):
        gateway = RecoveryGateway()
        gateway.fail_stage = stage
        # The fixture's gateway object remains wired into the application.
        self.gateway.complete = gateway.complete
        self.controlled = gateway
        job = self.finish(self.start())
        self.assertEqual(job["status"], "failed")
        return job

    def execute_again(self, job, mode="resume", expected=202):
        doc = self.store.get(self.document["id"])
        response = self.client.post(
            f"/v1/prd/documents/{doc['id']}/jobs",
            json={
                "expected_revision": doc["revision"],
                "action": job["action"],
                "instruction": job["instruction"],
                ("resume_of_job_id" if mode == "resume" else "retry_of_job_id"): job["id"],
            },
        )
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def test_resume_reuses_successful_sections_and_restart_runs_all_stages(self):
        old = self.fail_at()
        before = self.trace(old)["events"]
        self.controlled.fail_stage = ""
        self.controlled.requests.clear()
        resumed = self.finish(self.execute_again(old))
        self.assertEqual(resumed["status"], "succeeded")
        self.assertEqual(
            [r.metadata["stage_id"] for r in self.controlled.requests],
            ["write-2", "write-3", "review"],
        )
        recorded_calls = [
            e["payload"]["stage_id"]
            for e in self.trace(resumed)["events"]
            if e["name"] == "model.requested"
        ]
        self.assertEqual(recorded_calls, ["write-2", "write-3", "review"])
        self.assertEqual(resumed["input_hash"], old["input_hash"])
        self.assertEqual(resumed["input_tokens"], 303)
        self.assertEqual(self.trace(old)["events"], before)
        self.assertEqual(sum(e["name"] == "stage.reused" for e in self.trace(resumed)["events"]), 4)
        self.controlled.requests.clear()
        restarted = self.finish(self.execute_again(old, "restart"))
        self.assertEqual(restarted["status"], "succeeded")
        self.assertEqual(len(self.controlled.requests), 7)
        self.assertEqual(len(self.store.versions(self.document["id"])), 2)

    def test_review_failure_retries_review_without_duplicate_document_version(self):
        self.gateway.failure = "review"
        old = self.finish(self.start())
        self.assertEqual(old["status"], "failed")
        self.assertNotIn("review", old["checkpoint"]["stages"])
        self.gateway.failure = ""
        self.gateway.requests.clear()
        resumed = self.finish(self.execute_again(old))
        self.assertEqual(resumed["status"], "succeeded")
        self.assertEqual([r.metadata["task_id"] for r in self.gateway.requests], ["review"])
        self.assertEqual(len(self.store.versions(self.document["id"])), 1)

    def test_resume_after_reopening_database_and_application(self):
        old = self.fail_at()
        self.client.close()
        reopened = PrdStore(self.store.path)
        gateway = AuthoringGateway()
        with TestClient(
            create_app(
                root=ROOT, prd_store=reopened, model_gateway=gateway, model_name="deepseek-flash"
            )
        ) as client:
            self.client = client
            resumed = self.finish(self.execute_again(old))
            self.assertEqual(resumed["status"], "succeeded")
            self.assertEqual(
                [r.metadata["stage_id"] for r in gateway.requests], ["write-2", "write-3", "review"]
            )
        with sqlite3.connect(str(self.store.path) + ".checkpoints") as db:
            self.assertGreater(db.execute("SELECT COUNT(*) FROM checkpoints").fetchone()[0], 0)

    def test_native_checkpoint_covers_model_success_before_business_commit(self):
        complete = self.store.complete_stage

        def fail_commit(job_id, step, payload):
            if step["id"] == "ux":
                raise sqlite3.OperationalError("controlled commit failure")
            complete(job_id, step, payload)

        with patch.object(self.store, "complete_stage", side_effect=fail_commit):
            old = self.finish(self.start())
        self.assertEqual(old["status"], "failed")
        self.assertNotIn("ux", old["checkpoint"]["stages"])
        self.gateway.requests.clear()
        resumed = self.finish(self.execute_again(old))
        self.assertEqual(resumed["status"], "succeeded")
        self.assertNotIn("ux", [r.metadata["task_id"] for r in self.gateway.requests])
        self.assertEqual(
            sum(e["name"] == "checkpoint.runtime_recovered" for e in self.trace(resumed)["events"]),
            1,
        )

    def test_changed_document_rejects_resume_but_allows_restart(self):
        old = self.fail_at()
        doc = self.store.get(self.document["id"])
        self.store.save(doc["id"], doc["revision"], {**doc["brief"], "scope": "新范围"}, "", "edit")
        self.execute_again(old, expected=409)
        info = self.client.get(f"/v1/prd/jobs/{old['id']}").json()["recovery"]
        self.assertFalse(info["can_resume"])
        self.controlled.fail_stage = ""
        self.assertEqual(self.finish(self.execute_again(old, "restart"))["status"], "succeeded")

    def test_repeated_resume_keeps_transitive_checkpoints(self):
        old = self.fail_at()
        self.controlled.fail_stage = "write-3"
        second = self.finish(self.execute_again(old))
        self.assertEqual(second["status"], "failed")
        self.execute_again(old, expected=409)
        self.controlled.fail_stage = ""
        self.controlled.requests.clear()
        third = self.finish(self.execute_again(second))
        self.assertEqual(third["status"], "succeeded")
        self.assertEqual(
            [r.metadata["stage_id"] for r in self.controlled.requests], ["write-3", "review"]
        )

    def test_legacy_accepted_events_can_be_adopted_without_inventing_checkpoints(self):
        old = self.fail_at()
        with self.store.connection() as db:
            old.pop("checkpoint")
            old.pop("checkpoint_revision")
            self.store._put(db, "prd_jobs", old)
        self.controlled.fail_stage = ""
        self.controlled.requests.clear()
        new = self.finish(self.execute_again(old))
        self.assertEqual(new["status"], "succeeded")
        self.assertTrue(new["checkpoint"]["legacy_import"])
        self.assertEqual(len(self.controlled.requests), 3)

    def test_cancelled_task_can_resume_without_repeating_completed_stage(self):
        original = self.gateway.complete

        async def slow(request):
            if request.metadata["task_id"] == "ux":
                await asyncio.sleep(10)
            return await original(request)

        self.gateway.complete = slow
        old = self.start()
        for _ in range(100):
            if self.store.job(old["id"])["stage"] == "细化流程与异常":
                break
            time.sleep(0.02)
        old = self.client.post(f"/v1/prd/jobs/{old['id']}/cancel").json()
        self.gateway.complete = original
        self.gateway.requests.clear()
        new = self.finish(self.execute_again(old))
        self.assertEqual(new["status"], "succeeded")
        self.assertNotIn("requirements", [r.metadata["task_id"] for r in self.gateway.requests])

    def test_modes_are_exclusive_and_cannot_resume_other_document(self):
        old = self.fail_at()
        doc = self.store.get(self.document["id"])
        body = {
            "expected_revision": doc["revision"],
            "resume_of_job_id": old["id"],
            "retry_of_job_id": old["id"],
        }
        self.assertEqual(
            self.client.post(f"/v1/prd/documents/{doc['id']}/jobs", json=body).status_code, 422
        )
        other = self.client.post("/v1/prd/documents", json={"title": "Other"}).json()
        body.pop("retry_of_job_id")
        body["expected_revision"] = other["revision"]
        self.assertEqual(
            self.client.post(f"/v1/prd/documents/{other['id']}/jobs", json=body).status_code, 422
        )

    def test_sigkill_retains_completed_stages_and_records_interruption(self):
        path = Path(self.directory.name) / "killed.sqlite3"
        marker = Path(self.directory.name) / "ready.json"
        script = """
import asyncio, json, sys
from pathlib import Path
from nexusos.prd.store import PrdStore
from nexusos.prd.workflow import PrdWorkflow
from tests.integration.test_prd_workspace import AuthoringGateway, ROOT
class Gateway(AuthoringGateway):
    async def complete(self, request):
        if request.metadata['task_id'] == 'ux':
            Path(sys.argv[2]).write_text(json.dumps({'job': job, 'document': doc}))
            await asyncio.sleep(120)
        return await super().complete(request)
store = PrdStore(sys.argv[1])
doc = store.create({'title': 'Killed process'})
job = store.start_job(doc['id'], 1, 'generate', '')
asyncio.run(PrdWorkflow(ROOT, store, Gateway(), 'deepseek-flash')._run(job['id']))
"""
        proc = subprocess.Popen([sys.executable, "-c", script, str(path), str(marker)], cwd=ROOT)
        try:
            for _ in range(200):
                if marker.exists():
                    break
                if proc.poll() is not None:
                    self.fail("worker exited before reaching failure injection point")
                time.sleep(0.05)
            self.assertTrue(marker.exists())
        finally:
            proc.kill()
            proc.wait(timeout=10)
        state = json.loads(marker.read_text())
        reopened = PrdStore(path)
        gateway = AuthoringGateway()
        with TestClient(
            create_app(
                root=ROOT, prd_store=reopened, model_gateway=gateway, model_name="deepseek-flash"
            )
        ) as client:
            old = client.get(f"/v1/prd/jobs/{state['job']['id']}").json()
            self.assertEqual(old["status"], "failed")
            self.assertTrue(old["recovery"]["can_resume"])
            self.assertIn("requirements", old["recovery"]["completed_stages"])
            response = client.post(
                f"/v1/prd/documents/{state['document']['id']}/jobs",
                json={
                    "expected_revision": 1,
                    "resume_of_job_id": old["id"],
                },
            )
            self.assertEqual(response.status_code, 202, response.text)
            for _ in range(200):
                job = client.get(f"/v1/prd/jobs/{response.json()['id']}").json()
                if job["status"] in {"failed", "succeeded"}:
                    break
                time.sleep(0.05)
            self.assertEqual(job["status"], "succeeded", job.get("error"))
            self.assertNotIn("requirements", [r.metadata["task_id"] for r in gateway.requests])
            names = [
                e["name"] for e in client.get(f"/v1/prd/jobs/{old['id']}/trace").json()["events"]
            ]
            self.assertIn("job.interrupted", names)

    def test_published_review_is_not_repeated_after_final_state_failure(self):
        update = self.store.update_job

        def fail_final(job_id, **changes):
            if changes.get("status") == "succeeded":
                raise sqlite3.OperationalError("failed final state")
            return update(job_id, **changes)

        with patch.object(self.store, "update_job", side_effect=fail_final):
            old = self.finish(self.start())
        before = self.store.get(self.document["id"])
        self.gateway.requests.clear()
        new = self.finish(self.execute_again(old))
        self.assertEqual(new["status"], "succeeded")
        self.assertEqual(self.gateway.requests, [])
        after = self.store.get(self.document["id"])
        self.assertEqual(after["revision"], before["revision"])
        self.assertEqual(after["version"], before["version"])

    def test_resume_requires_compatible_checkpoint_and_rejects_overlapping_start(self):
        old = self.fail_at()
        checkpoint = old["checkpoint"]
        with self.store.connection() as db:
            old["checkpoint"] = {**checkpoint, "version": "future-version"}
            self.store._put(db, "prd_jobs", old)
        self.execute_again(old, expected=409)
        with self.store.connection() as db:
            old["checkpoint"] = checkpoint
            self.store._put(db, "prd_jobs", old)
        with patch("nexusos.prd.workflow.PrdWorkflow.start"):
            queued = self.execute_again(old)
            self.execute_again(old, expected=409)
        self.client.post(f"/v1/prd/jobs/{queued['id']}/cancel")

    def test_merge_failure_invalidates_sections_but_keeps_analyses(self):
        from nexusos.prd.workflow import MergeValidationError

        with patch(
            "nexusos.prd.workflow.validate_merged_prd",
            side_effect=MergeValidationError("bad merge"),
        ):
            old = self.finish(self.start())
        self.assertEqual(old["error_type"], "MergeValidationError")
        self.gateway.requests.clear()
        new = self.finish(self.execute_again(old))
        self.assertEqual(new["status"], "succeeded")
        self.assertEqual(
            [r.metadata["stage_id"] for r in self.gateway.requests],
            ["write-1", "write-2", "write-3", "review"],
        )
