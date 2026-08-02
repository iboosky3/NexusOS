import unittest

from benchmarks.scale.run import generate_catalog, run
from nexusos.skills import FileSkillRepository


class ScaleBenchmarkTests(unittest.TestCase):
    def test_generates_stable_unique_catalog(self) -> None:
        real_skills = FileSkillRepository("skills").list_summaries()

        first = generate_catalog(real_skills, 100)
        second = generate_catalog(real_skills, 100)

        self.assertEqual(first, second)
        self.assertEqual(len({skill.id for skill in first}), 100)

    def test_preserves_quality_and_token_reduction_at_one_thousand_skills(self) -> None:
        report = run(1_000)

        self.assertGreaterEqual(report["quality"]["top1_accuracy"], 0.9)
        self.assertLess(
            report["tokens"]["average_selected_instructions"],
            report["tokens"]["all_skill_instructions"],
        )
        self.assertGreater(report["latency_ms"]["p95"], 0)


if __name__ == "__main__":
    unittest.main()
