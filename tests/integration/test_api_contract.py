import asyncio
import unittest

from nexusos.api import serialize_run_record
from nexusos.bootstrap import build_reference_orchestrator


class ApiContractTests(unittest.TestCase):
    def test_serializes_a_stable_run_summary(self) -> None:
        record = asyncio.run(
            build_reference_orchestrator().run("面向大学生的 AI 学习笔记产品")
        )

        payload = serialize_run_record(record)

        self.assertEqual(payload["status"], "succeeded")
        self.assertTrue(payload["review"]["passed"])
        self.assertEqual(len(payload["tasks"]), 7)
        self.assertEqual(payload["artifacts"][0]["name"], "PRD.md")
        self.assertGreater(payload["usage"]["total_tokens"], 0)


if __name__ == "__main__":
    unittest.main()
