import asyncio
import unittest

from nexusos.agents import AgentResolver, FileAgentRegistry
from nexusos.context import ContextBudgetManager
from nexusos.memory import InMemoryMemoryStore
from nexusos.observability import InMemoryTelemetrySink
from nexusos.orchestrator import PrdOrchestrator, ReferencePrdPlanner
from nexusos.router import HybridSkillRouter
from nexusos.runtime import LocalAgentRuntime
from nexusos.skills import FileSkillRepository


class TelemetryTests(unittest.TestCase):
    def test_records_run_and_task_lifecycle_with_correlated_ids(self) -> None:
        async def scenario():
            skills = FileSkillRepository("skills")
            telemetry = InMemoryTelemetrySink()
            orchestrator = PrdOrchestrator(
                planner=ReferencePrdPlanner(),
                resolver=AgentResolver(FileAgentRegistry("agents").list()),
                skills=skills,
                router=HybridSkillRouter(skills.list_summaries()),
                context_manager=ContextBudgetManager(),
                runtime=LocalAgentRuntime(),
                memory=InMemoryMemoryStore(),
                events=telemetry,
            )
            record = await orchestrator.run("面向大学生的 AI 学习笔记产品")
            return record, telemetry

        record, telemetry = asyncio.run(scenario())

        self.assertEqual(telemetry.metrics()["nexus.run.started"], 1)
        self.assertEqual(telemetry.metrics()["nexus.task.started"], 7)
        self.assertEqual(telemetry.metrics()["nexus.task.succeeded"], 7)
        self.assertEqual(telemetry.metrics()["nexus.run.succeeded"], 1)
        self.assertTrue(all(item.trace_id == record.state.run_id for item in telemetry.events))
        self.assertGreater(telemetry.metrics()["nexus.tokens.total"], 0)

    def test_redacts_sensitive_attributes(self) -> None:
        telemetry = InMemoryTelemetrySink()
        telemetry.emit("nexus.test", {"run_id": "run-1", "api_key": "sensitive"})

        self.assertEqual(telemetry.events[0].attributes["nexus.api_key"], "[REDACTED]")


if __name__ == "__main__":
    unittest.main()
