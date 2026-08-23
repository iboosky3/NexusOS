import unittest

from nexusos.agents import AgentResolver, FileAgentRegistry
from nexusos.orchestrator import ReferencePrdPlanner


class ReferencePrdPlannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.planner = ReferencePrdPlanner()
        self.resolver = AgentResolver(FileAgentRegistry("agents").list())

    def test_standard_plan_exposes_parallel_design_and_technical_work(self) -> None:
        plan = self.planner.plan("面向大学生的 AI 学习笔记产品")
        layers = tuple(
            tuple(task.id for task in layer) for layer in plan.graph.topological_layers()
        )

        self.assertEqual(plan.complexity, "standard")
        self.assertIn(("technical", "ux"), layers)
        self.assertEqual(layers[-1], ("review",))
        self.assertTrue(all(self.resolver.resolve(task) for task in plan.graph.tasks))

    def test_complex_plan_adds_parallel_market_research(self) -> None:
        plan = self.planner.plan("为企业提供多租户 AI 设计合规审计平台")
        by_id = {task.id: task for task in plan.graph.tasks}

        self.assertEqual(plan.complexity, "complex")
        self.assertEqual(by_id["requirements"].dependencies, ("intake", "competitors", "market"))
        self.assertEqual(self.resolver.resolve(by_id["market"]).id, "researcher")


if __name__ == "__main__":
    unittest.main()
