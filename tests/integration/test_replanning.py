import asyncio
import unittest

from nexusos.agents import AgentResolver, FileAgentRegistry
from nexusos.context import ContextBudgetManager
from nexusos.core.models import AgentResult, Artifact
from nexusos.memory import InMemoryMemoryStore
from nexusos.orchestrator import ListEventSink, PrdOrchestrator, ReferencePrdPlanner
from nexusos.router import HybridSkillRouter
from nexusos.runtime import LocalAgentRuntime
from nexusos.skills import FileSkillRepository


class IncompleteWriterRuntime(LocalAgentRuntime):
    async def execute(self, agent_id, task, context):
        result = await super().execute(agent_id, task, context)
        if task.metadata.get("handler", task.id) != "write":
            return result
        content = "# 产品需求文档\n\n内容不足。"
        return AgentResult(
            task_id=task.id,
            agent_id=agent_id,
            content=content,
            artifacts=(Artifact("PRD.md", "text/markdown", content),),
            token_usage=result.token_usage,
        )


class ReplanningTests(unittest.TestCase):
    def test_stops_after_bounded_failed_revisions(self) -> None:
        async def scenario():
            skills = FileSkillRepository("skills")
            events = ListEventSink()
            orchestrator = PrdOrchestrator(
                planner=ReferencePrdPlanner(),
                resolver=AgentResolver(FileAgentRegistry("agents").list()),
                skills=skills,
                router=HybridSkillRouter(skills.list_summaries()),
                context_manager=ContextBudgetManager(),
                runtime=IncompleteWriterRuntime(),
                memory=InMemoryMemoryStore(),
                events=events,
                maximum_iterations=2,
            )
            return await orchestrator.run("面向大学生的 AI 学习笔记产品")

        record = asyncio.run(scenario())

        self.assertEqual(record.state.iteration, 2)
        self.assertFalse(record.state.review and record.state.review.passed)
        self.assertIn("revision-2-write", record.state.completed_tasks)
        self.assertEqual(record.events[-1]["name"], "nexus.run.blocked")


if __name__ == "__main__":
    unittest.main()
