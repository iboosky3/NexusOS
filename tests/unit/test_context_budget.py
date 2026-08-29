import unittest

from nexusos.context import ContextBudgetManager, ContextFragment
from nexusos.core.models import Goal, Task


class ContextBudgetManagerTests(unittest.TestCase):
    def test_prefers_required_and_high_priority_fragments(self) -> None:
        manager = ContextBudgetManager(reserve_share=0.2)
        task = Task("research", "Research", "Analyze the market")
        fragments = (
            ContextFragment("task", "Required task constraint", required=True, priority=100),
            ContextFragment("memory", "Relevant memory", relevance=0.9, priority=80),
            ContextFragment("memory", "Low priority memory " * 30, relevance=0.1, priority=1),
        )

        context, report = manager.build(
            run_id="run-1",
            goal=Goal("Create a PRD"),
            task=task,
            fragments=fragments,
            maximum_tokens=100,
        )

        self.assertEqual(context.sections["task"], ("Required task constraint",))
        self.assertEqual(report.reserved_tokens, 20)
        self.assertEqual(report.omitted_fragments, 1)
        self.assertLessEqual(report.consumed_tokens + report.reserved_tokens, 100)

    def test_rejects_required_fragment_that_cannot_fit(self) -> None:
        with self.assertRaisesRegex(ValueError, "required context does not fit"):
            ContextBudgetManager().build(
                run_id="run-1",
                goal=Goal("Create a PRD"),
                task=Task("write", "Write", "Write the PRD"),
                fragments=(ContextFragment("task", "x" * 100, required=True),),
                maximum_tokens=20,
            )

    def test_allows_required_fragment_to_borrow_unused_section_budget(self) -> None:
        manager = ContextBudgetManager(reserve_share=0.2)
        required_content = "x" * 60

        context, report = manager.build(
            run_id="run-1",
            goal=Goal("Create a PRD"),
            task=Task("write", "Write", "Write the PRD"),
            fragments=(
                ContextFragment("task", required_content, required=True),
                ContextFragment("task", "optional details", priority=10),
            ),
            maximum_tokens=100,
        )

        self.assertEqual(context.sections["task"], (required_content,))
        self.assertEqual(report.section_tokens["task"], 15)
        self.assertEqual(report.borrowed_tokens, 7)
        self.assertEqual(report.omitted_fragments, 1)
        self.assertLessEqual(report.consumed_tokens, 80)


if __name__ == "__main__":
    unittest.main()
