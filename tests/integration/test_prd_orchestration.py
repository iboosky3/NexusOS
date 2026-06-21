import asyncio
import unittest

from nexusos.agents import AgentResolver, FileAgentRegistry
from nexusos.context import ContextBudgetManager
from nexusos.memory import InMemoryMemoryStore
from nexusos.orchestrator import ListEventSink, PrdOrchestrator, ReferencePrdPlanner
from nexusos.router import HybridSkillRouter
from nexusos.runtime import LocalAgentRuntime
from nexusos.skills import FileSkillRepository


class PrdOrchestrationTests(unittest.TestCase):
    def test_executes_reference_workflow_end_to_end(self) -> None:
        async def scenario():
            skills = FileSkillRepository("skills")
            events = ListEventSink()
            orchestrator = PrdOrchestrator(
                planner=ReferencePrdPlanner(),
                resolver=AgentResolver(FileAgentRegistry("agents").list()),
                skills=skills,
                router=HybridSkillRouter(skills.list_summaries()),
                context_manager=ContextBudgetManager(),
                runtime=LocalAgentRuntime(),
                memory=InMemoryMemoryStore(),
                events=events,
            )
            return await orchestrator.run("面向大学生的 AI 学习笔记产品")

        record = asyncio.run(scenario())

        self.assertEqual(len(record.state.completed_tasks), 7)
        self.assertEqual(record.state.selected_agents["technical"], "architect")
        self.assertIn("architecture-review", record.state.selected_skills["technical"])
        self.assertTrue(record.state.review and record.state.review.passed)
        self.assertEqual(record.state.artifacts[0].name, "PRD.md")
        self.assertIn("# 产品需求文档", record.state.artifacts[0].content)
        self.assertEqual(record.events[0]["name"], "nexus.run.started")
        self.assertEqual(record.events[-1]["name"], "nexus.run.succeeded")
        self.assertGreater(record.state.token_usage.total_tokens, 0)


if __name__ == "__main__":
    unittest.main()
