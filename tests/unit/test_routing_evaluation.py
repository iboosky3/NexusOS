import unittest

from nexusos.evaluation import RoutingExample, evaluate_rankings


class RoutingEvaluationTests(unittest.TestCase):
    def test_computes_standard_information_retrieval_metrics(self) -> None:
        examples = (
            RoutingExample("one", "first", frozenset({"a"})),
            RoutingExample("two", "second", frozenset({"b", "c"})),
        )
        rankings = (("a", "x"), ("x", "b", "c"))

        metrics = evaluate_rankings(examples, rankings)

        self.assertEqual(metrics.examples, 2)
        self.assertEqual(metrics.top1_accuracy, 0.5)
        self.assertEqual(metrics.recall_at_3, 1.0)
        self.assertAlmostEqual(metrics.mean_reciprocal_rank, 0.75)
        self.assertGreater(metrics.ndcg_at_5, 0.7)

    def test_rejects_misaligned_input(self) -> None:
        with self.assertRaisesRegex(ValueError, "aligned"):
            evaluate_rankings(
                (RoutingExample("one", "first", frozenset({"a"})),),
                (),
            )


if __name__ == "__main__":
    unittest.main()
