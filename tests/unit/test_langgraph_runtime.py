import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from nexusos.core.models import AgentContext, Goal, Task
from nexusos.models import DeterministicModelGateway
from nexusos.runtime import LangGraphRuntime


class _FakeStateGraph:
    def __init__(self, state_type):
        self.node = None

    def add_node(self, name, node):
        self.node = node

    def add_edge(self, source, target):
        return None

    def compile(self):
        return self

    async def ainvoke(self, state):
        return {**state, **(await self.node(state))}


class LangGraphRuntimeTests(unittest.TestCase):
    def test_executes_behind_agent_runtime_contract(self) -> None:
        async def scenario():
            runtime = LangGraphRuntime(DeterministicModelGateway(), model="test-model")
            task = Task("write", "Write PRD", "Create a structured document")
            context = AgentContext(
                run_id="run-1",
                goal=Goal("Create a PRD"),
                task=task,
                sections={"skills": ("Use clear sections.",)},
                token_budget=2000,
            )
            fake_module = SimpleNamespace(StateGraph=_FakeStateGraph, START="start", END="end")
            with patch("nexusos.runtime.langgraph.import_module", return_value=fake_module):
                return await runtime.execute("writer", task, context)

        result = asyncio.run(scenario())

        self.assertEqual(result.agent_id, "writer")
        self.assertIn("Create a structured document", result.content)
        self.assertEqual(result.artifacts[0].name, "PRD.md")

    def test_explains_missing_optional_dependency(self) -> None:
        runtime = LangGraphRuntime(DeterministicModelGateway(), model="test-model")
        task = Task("task", "Task", "Execute")
        context = AgentContext("run-1", Goal("Execute"), task)

        async def scenario():
            with patch(
                "nexusos.runtime.langgraph.import_module",
                side_effect=ModuleNotFoundError("langgraph"),
            ):
                await runtime.execute("agent", task, context)

        with self.assertRaisesRegex(RuntimeError, "runtime.*extra"):
            asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
