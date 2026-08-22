import asyncio
import unittest

from nexusos.api import InMemoryRunReadStore, RunNotFoundError, serialize_run_record
from nexusos.bootstrap import build_reference_orchestrator


class ApiContractTests(unittest.TestCase):
    def test_serializes_a_stable_run_summary(self) -> None:
        record = asyncio.run(
            build_reference_orchestrator().run("面向大学生的 AI 学习笔记产品")
        )

        payload = serialize_run_record(record)

        self.assertEqual(payload["status"], "succeeded")
        self.assertTrue(payload["review"]["passed"])
        self.assertGreaterEqual(payload["duration_ms"], 0)
        self.assertEqual(len(payload["tasks"]), 7)
        self.assertEqual(payload["tasks"][0]["title"], "理解产品构想")
        self.assertTrue(payload["routing"][0]["candidates"][0]["reasons"])
        self.assertEqual(payload["artifacts"][0]["name"], "PRD.md")
        self.assertGreater(payload["usage"]["total_tokens"], 0)

    def test_stores_bounded_defensive_run_projections(self) -> None:
        store = InMemoryRunReadStore(maximum_entries=2)
        for index in range(3):
            store.save(
                {
                    "run_id": f"run-{index}",
                    "status": "succeeded",
                    "request": f"request {index}",
                    "started_at": "2026-08-22T00:00:00+00:00",
                    "completed_at": "2026-08-22T00:00:01+00:00",
                    "duration_ms": 1000,
                    "iteration": 0,
                    "review": {"overall_score": 90},
                    "usage": {"total_tokens": index},
                    "tasks": [{"task_id": "task"}],
                    "artifacts": [],
                }
            )

        summaries = store.list_summaries()

        self.assertEqual([item["run_id"] for item in summaries], ["run-2", "run-1"])
        self.assertEqual(summaries[0]["task_count"], 1)
        with self.assertRaises(RunNotFoundError):
            store.get("run-0")

        stored = store.get("run-2")
        stored["status"] = "corrupted"
        self.assertEqual(store.get("run-2")["status"], "succeeded")

    def test_rejects_unbounded_summary_queries(self) -> None:
        store = InMemoryRunReadStore()

        with self.assertRaisesRegex(ValueError, "between 1 and 100"):
            store.list_summaries(101)


if __name__ == "__main__":
    unittest.main()
