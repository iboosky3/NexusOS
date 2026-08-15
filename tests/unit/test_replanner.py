import unittest

from nexusos.core.models import ReviewResult
from nexusos.orchestrator import RevisionPlanner


class RevisionPlannerTests(unittest.TestCase):
    def test_targets_only_failed_review_dimensions(self) -> None:
        review = ReviewResult(
            overall_score=70,
            dimensions={
                "clarity": 90,
                "completeness": 70,
                "feasibility": 60,
                "consistency": 90,
                "evidence": 90,
            },
            revision_tasks=("补充需求和风险",),
        )

        graph = RevisionPlanner().plan(review, 1)
        identifiers = {task.id for task in graph.tasks}

        self.assertIn("revision-1-requirements", identifiers)
        self.assertIn("revision-1-technical", identifiers)
        self.assertNotIn("revision-1-research", identifiers)
        self.assertEqual(graph.topological_layers()[-1][0].id, "revision-1-review")

    def test_rejects_passing_review(self) -> None:
        review = ReviewResult(90, {"clarity": 90})

        with self.assertRaisesRegex(ValueError, "passing review"):
            RevisionPlanner().plan(review, 1)


if __name__ == "__main__":
    unittest.main()
