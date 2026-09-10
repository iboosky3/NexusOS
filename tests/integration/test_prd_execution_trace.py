"""Prove trace lineage and preservation across errors, revisions, and restarts."""

import hashlib
import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.prd.store import PrdStore

from tests.integration.test_prd_workspace import AuthoringGateway

ROOT = Path(__file__).resolve().parents[2]


class ExecutionTraceTests(unittest.TestCase):
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
                    model_name="test-model",
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

    def start(self, action="generate", retry_of=None):
        document = self.store.get(self.document["id"])
        response = self.client.post(
            f"/v1/prd/documents/{document['id']}/jobs",
            json={
                "expected_revision": document["revision"],
                "action": action,
                "retry_of_job_id": retry_of,
            },
        )
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def finish(self, job):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            current = self.store.job(job["id"])
            if current["status"] in {"succeeded", "failed", "cancelled"}:
                return current
            time.sleep(0.02)
        self.fail("job did not finish")

    def trace(self, job):
        response = self.client.get(f"/v1/prd/jobs/{job['id']}/trace")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_every_model_call_and_artifact_has_stable_lineage(self):
        job = self.finish(self.start())
        bundle = self.trace(job)
        events = bundle["events"]
        names = [event["name"] for event in events]
        self.assertEqual(names[0], "job.queued")
        self.assertEqual(names[-1], "job.succeeded")
        self.assertEqual(names.count("model.requested"), 5)
        self.assertEqual(names.count("model.responded"), 5)
        self.assertEqual(names.count("capabilities.selected"), 5)
        self.assertEqual(bundle["artifacts"][0]["origin_job_id"], job["id"])
        self.assertEqual(bundle["artifacts"][0]["parent_version"], 0)
        self.assertEqual(bundle["input"]["brief"]["description"], "必须保留的原始要求")
        self.assertEqual({event["trace_id"] for event in events}, {job["trace_id"]})
        stages = {event["span_id"] for event in events if event["name"] == "stage.started"}
        requests = [event for event in events if event["name"] == "model.requested"]
        for request, actual in zip(requests, self.gateway.requests, strict=True):
            self.assertIn(request["parent_span_id"], stages)
            self.assertEqual(actual.metadata["span_id"], request["span_id"])
            self.assertEqual(
                request["payload"]["messages"],
                [{"role": message.role, "content": message.content} for message in actual.messages],
            )
            self.assertTrue(
                any(
                    event["name"] == "model.responded" and event["span_id"] == request["span_id"]
                    for event in events
                )
            )
        for event in events:
            canonical = json.dumps(
                event["payload"], ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            self.assertEqual(event["payload_hash"], hashlib.sha256(canonical.encode()).hexdigest())
        selected = next(event for event in events if event["name"] == "capabilities.selected")
        self.assertTrue(selected["payload"]["agent"]["version"])
        self.assertTrue(selected["payload"]["skills"][0]["instructions_hash"])
        self.assertTrue(selected["payload"]["skills"][0]["reasons"])

    def test_later_edits_cannot_change_original_input_or_trace(self):
        job = self.finish(self.start())
        before = self.trace(job)
        document = self.store.get(self.document["id"])
        brief = {**document["brief"], "description": "完全不同的新需求"}
        self.store.save(document["id"], document["revision"], brief, "# 人工改稿", "修改")
        after = self.trace(job)
        self.assertEqual(before["input"], after["input"])
        self.assertEqual(before["events"], after["events"])
        self.assertEqual(before["artifacts"], after["artifacts"])
        reopened = PrdStore(self.store.path)
        self.assertEqual(reopened.trace_bundle(job["id"])["events"], before["events"])

    def test_truncated_response_is_recorded_even_when_artifact_is_rejected(self):
        self.gateway.failure = "truncated"
        job = self.finish(self.start())
        bundle = self.trace(job)
        self.assertEqual(job["status"], "failed")
        responses = [e for e in bundle["events"] if e["name"] == "model.responded"]
        self.assertEqual(responses[-1]["payload"]["finish_reason"], "length")
        self.assertTrue(responses[-1]["payload"]["content"])
        self.assertEqual(bundle["artifacts"], [])
        self.assertTrue(any(e["name"] == "stage.failed" for e in bundle["events"]))

    def test_failure_retry_is_a_new_linked_trace(self):
        self.gateway.failure = "connection"
        original = self.finish(self.start())
        failed_events = self.trace(original)["events"]
        self.assertTrue(any(e["name"] == "model.failed" for e in failed_events))
        self.assertNotIn("secret provider error", json.dumps(failed_events))
        self.gateway.failure = ""
        retry = self.finish(self.start(retry_of=original["id"]))
        self.assertEqual(retry["status"], "succeeded")
        self.assertNotEqual(retry["trace_id"], original["trace_id"])
        self.assertEqual(retry["retry_of_job_id"], original["id"])
        self.assertEqual(failed_events, self.trace(original)["events"])
        items = self.client.get(f"/v1/prd/documents/{self.document['id']}/jobs").json()["items"]
        self.assertEqual([item["id"] for item in items], [retry["id"], original["id"]])

    def test_cancel_preserves_unknown_provider_outcome_and_terminal_event(self):
        self.gateway.failure = "slow"
        job = self.start()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.gateway.requests:
                break
            time.sleep(0.02)
        self.client.post(f"/v1/prd/jobs/{job['id']}/cancel")
        events = self.trace(job)["events"]
        cancelled = next(e for e in events if e["name"] == "model.cancelled")
        self.assertEqual(cancelled["payload"]["provider_outcome"], "unknown")
        self.assertEqual(events[-1]["name"], "job.cancelled")

    def test_document_timeline_paginates_without_losing_or_duplicating_events(self):
        job = self.finish(self.start())
        events = []
        cursor = 0
        while True:
            page = self.client.get(
                f"/v1/prd/documents/{self.document['id']}/trace?after={cursor}&limit=3"
            ).json()
            events.extend(page["items"])
            if page["next_cursor"] is None:
                break
            cursor = page["next_cursor"]
        self.assertEqual(events[0]["name"], "document.created")
        self.assertEqual(events[-1]["name"], "job.succeeded")
        self.assertEqual(len(events), len({event["event_id"] for event in events}))
        self.assertEqual(len(events), len(self.trace(job)["events"]) + 1)
        self.assertEqual(
            self.client.get(f"/v1/prd/documents/{self.document['id']}/trace?limit=501").status_code,
            422,
        )
        for query in [
            "trace?after=-1",
            "trace?after=9223372036854775808",
            "jobs?before=0",
            "jobs?before=9223372036854775808",
        ]:
            with self.subTest(query=query):
                self.assertEqual(
                    self.client.get(f"/v1/prd/documents/{self.document['id']}/{query}").status_code,
                    422,
                )

    def test_database_prohibits_trace_mutation_and_rolls_back_untraced_artifact(self):
        job = self.finish(self.start())
        for statement in [
            "UPDATE prd_trace_events SET name='changed'",
            "DELETE FROM prd_trace_events",
            "UPDATE prd_trace_objects SET body='{}'",
            "DELETE FROM prd_trace_objects",
        ]:
            with (
                self.subTest(statement=statement),
                self.assertRaises(sqlite3.IntegrityError),
                self.store.connection() as db,
            ):
                db.execute(statement)
        document = self.store.get(self.document["id"])
        with (
            patch(
                "nexusos.prd.store.append_event", side_effect=sqlite3.OperationalError("disk full")
            ),
            self.assertRaises(sqlite3.OperationalError),
        ):
            self.store.save(
                document["id"], document["revision"], document["brief"], "changed", "edit"
            )
        self.assertEqual(self.store.get(document["id"]), document)
        self.assertEqual(len(self.trace(job)["artifacts"]), 1)

    def test_request_is_not_sent_if_trace_cannot_be_persisted(self):
        original = self.store.record_event

        def fail_request(job_id, name, payload, **kwargs):
            if name == "model.requested":
                raise sqlite3.OperationalError("disk full")
            return original(job_id, name, payload, **kwargs)

        with patch.object(self.store, "record_event", side_effect=fail_request):
            job = self.finish(self.start())
        self.assertEqual(job["status"], "failed")
        self.assertEqual(self.gateway.requests, [])

    def test_legacy_task_is_marked_incomplete_instead_of_inventing_history(self):
        legacy = {
            "id": "e" * 32,
            "document_id": self.document["id"],
            "status": "succeeded",
            "steps": [],
            "created_at": "2026-01-01T00:00:00Z",
        }
        with self.store.connection() as db:
            db.execute(
                "INSERT INTO prd_jobs VALUES (?,?,?)",
                (
                    legacy["id"],
                    legacy["document_id"],
                    json.dumps(legacy),
                ),
            )
        bundle = self.trace(legacy)
        self.assertEqual(bundle["coverage"], "legacy_incomplete")
        self.assertIsNone(bundle["input"])
        self.assertEqual(bundle["events"], [])

    def test_restore_records_source_version_and_rejects_wrong_retry_parent(self):
        job = self.finish(self.start())
        document = self.store.get(self.document["id"])
        saved = self.client.put(
            f"/v1/prd/documents/{document['id']}",
            json={
                "expected_revision": document["revision"],
                "brief": document["brief"],
                "content": "# 从历史版本修改",
                "restored_from_version": 1,
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(self.store.versions(document["id"])[0]["restored_from_version"], 1)
        response = self.client.post(
            f"/v1/prd/documents/{document['id']}/jobs",
            json={
                "expected_revision": saved.json()["revision"],
                "action": "review",
                "retry_of_job_id": job["id"],
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_restart_retains_inputs_and_appends_interruption(self):
        job = self.store.start_job(self.document["id"], 1, "generate", "")
        self.store.update_job(
            job["id"],
            status="running",
            stage="写作",
            steps=[
                {
                    "id": "write",
                    "status": "running",
                    "span_id": "a" * 16,
                }
            ],
        )
        previous = self.trace(job)["events"]
        self.store.recover()
        events = self.trace(job)["events"]
        self.assertEqual(events[: len(previous)], previous)
        self.assertEqual(events[-2]["name"], "stage.interrupted")
        self.assertEqual(events[-1]["name"], "job.interrupted")
        self.assertEqual(events[-1]["payload"]["stage"], "写作")
        self.assertEqual(self.gateway.requests, [])
        self.assertEqual(self.trace(job)["input"]["brief"]["title"], "排班追溯")
