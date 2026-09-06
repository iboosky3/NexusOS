import unittest
from typing import ClassVar

from nexusos.agents import AgentResolver, FileAgentRegistry
from nexusos.core.models import Task


class AgentRegistryTests(unittest.TestCase):
    registry: ClassVar[FileAgentRegistry]
    resolver: ClassVar[AgentResolver]

    @classmethod
    def setUpClass(cls) -> None:
        cls.registry = FileAgentRegistry("agents")
        cls.resolver = AgentResolver(cls.registry.list())

    def test_loads_versioned_agents(self) -> None:
        self.assertEqual(len(self.registry.list()), 6)
        self.assertEqual(self.registry.get("architect").role, "系统架构师")

    def test_resolves_agent_by_capability_and_domain(self) -> None:
        task = Task(
            "technical",
            "Technical design",
            "Design the architecture",
            required_capabilities=("technical_design", "api_design"),
            metadata={"domains": ("engineering",)},
        )

        self.assertEqual(self.resolver.resolve(task).id, "architect")

    def test_rejects_task_without_compatible_agent(self) -> None:
        task = Task(
            "legal",
            "Legal review",
            "Review legal obligations",
            required_capabilities=("legal_review",),
        )

        with self.assertRaisesRegex(LookupError, "no agent"):
            self.resolver.resolve(task)


if __name__ == "__main__":
    unittest.main()
