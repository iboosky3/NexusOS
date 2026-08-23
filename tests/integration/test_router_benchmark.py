import unittest
from pathlib import Path

from benchmarks.router.run import run


class RouterBenchmarkTests(unittest.TestCase):
    def test_executes_all_versioned_baselines(self) -> None:
        report = run(Path("benchmarks/router/dataset.jsonl"), Path("skills"))

        self.assertEqual(report["examples"], 10)
        self.assertEqual(set(report["strategies"]), {"all_skills", "keyword", "nexus_hybrid"})
        self.assertLess(
            report["strategies"]["nexus_hybrid"]["average_selected_instruction_tokens"],
            report["strategies"]["all_skills"]["average_selected_instruction_tokens"],
        )


if __name__ == "__main__":
    unittest.main()
