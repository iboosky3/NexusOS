import unittest
from typing import ClassVar

from nexusos.router import HybridSkillRouter, RouteRequest, RoutingPolicy
from nexusos.skills import FileSkillRepository


class HybridSkillRouterTests(unittest.TestCase):
    router: ClassVar[HybridSkillRouter]

    @classmethod
    def setUpClass(cls) -> None:
        repository = FileSkillRepository("skills")
        cls.router = HybridSkillRouter(repository.list_summaries())

    def test_routes_competitor_research_with_explanations(self) -> None:
        candidates = self.router.route(
            RouteRequest(
                "分析 AI 设计工具的竞品定位和功能差异",
                required_capabilities=("competitor_research",),
                policy=RoutingPolicy(allowed_tools=("web.search",)),
            )
        )

        self.assertEqual(candidates[0].skill.id, "competitor-analysis")
        self.assertGreater(candidates[0].reasons["keyword"], 0)
        self.assertGreater(candidates[0].reasons["domain"], 0)

    def test_filters_required_tools_before_ranking(self) -> None:
        candidates = self.router.route(
            RouteRequest("分析竞品", policy=RoutingPolicy(allowed_tools=()))
        )

        self.assertNotIn("competitor-analysis", [item.skill.id for item in candidates])

    def test_respects_instruction_token_budget(self) -> None:
        candidates = self.router.route(
            RouteRequest(
                "生成产品需求文档并分析需求",
                maximum_results=5,
                token_budget=1000,
                policy=RoutingPolicy(allowed_tools=("file.write",)),
            )
        )

        self.assertLessEqual(sum(item.skill.estimated_tokens for item in candidates), 1000)
        self.assertNotIn("prd-writing", [item.skill.id for item in candidates])

    def test_applies_domain_policy_as_a_hard_constraint(self) -> None:
        candidates = self.router.route(
            RouteRequest(
                "给出技术架构与 API 设计",
                policy=RoutingPolicy(
                    allowed_domains=("engineering",),
                    allowed_tools=("knowledge.query",),
                ),
            )
        )

        self.assertEqual([item.skill.id for item in candidates], ["architecture-review"])


if __name__ == "__main__":
    unittest.main()
