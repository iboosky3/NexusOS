import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from nexusos.core.models import AgentContext, Goal, Task, TokenUsage
from nexusos.models import DeterministicModelGateway, ModelRequest, ModelResponse
from nexusos.runtime import LangGraphRuntime


class _FakeStateGraph:
    def __init__(self, state_type):
        self.node = None

    def add_node(self, name, node):
        self.node = node

    def add_edge(self, source, target):
        return None

    def compile(self, *, checkpointer=None):
        return self

    async def ainvoke(self, state, *, config=None):
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

    def test_continues_and_combines_length_limited_output(self) -> None:
        class Gateway:
            def __init__(self) -> None:
                self.requests: list[ModelRequest] = []

            async def complete(self, request):
                self.requests.append(request)
                if len(self.requests) == 1:
                    return ModelResponse(
                        "first half ",
                        "test",
                        request.model,
                        TokenUsage(10, 5),
                        "length",
                    )
                return ModelResponse(
                    "second half",
                    "test",
                    request.model,
                    TokenUsage(15, 6),
                    "stop",
                )

        async def scenario():
            gateway = Gateway()
            runtime = LangGraphRuntime(gateway, model="test-model")
            task = Task(
                "write",
                "Write PRD",
                "Create a structured document",
                metadata={"maximum_continuations": "2"},
            )
            context = AgentContext("run-1", Goal("Create a PRD"), task)
            fake_module = SimpleNamespace(StateGraph=_FakeStateGraph, START="start", END="end")
            with patch("nexusos.runtime.langgraph.import_module", return_value=fake_module):
                result = await runtime.execute("writer", task, context)
            return gateway, result

        gateway, result = asyncio.run(scenario())

        self.assertEqual(result.content, "first half second half")
        self.assertEqual(result.token_usage, TokenUsage(25, 11))
        self.assertEqual(len(gateway.requests), 2)
        self.assertEqual(gateway.requests[1].metadata["continuation_index"], "1")
        self.assertEqual(gateway.requests[1].messages[-2].content, "first half ")


if __name__ == "__main__":
    unittest.main()
