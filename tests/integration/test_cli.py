import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from nexusos.cli import main


class CliTests(unittest.TestCase):
    def test_writes_prd_and_machine_readable_run_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch("builtins.print"):
            status = main(
                [
                    "prd",
                    "面向大学生的 AI 学习笔记产品",
                    "--output",
                    directory,
                ]
            )
            run_directories = list(Path(directory).iterdir())

            self.assertEqual(status, 0)
            self.assertEqual(len(run_directories), 1)
            self.assertTrue((run_directories[0] / "PRD.md").is_file())
            self.assertTrue((run_directories[0] / "run.json").is_file())
            self.assertIn(
                "# 产品需求文档",
                (run_directories[0] / "PRD.md").read_text(encoding="utf-8"),
            )

    def test_doctor_returns_success_for_core_with_optional_gaps(self) -> None:
        repository_root = Path(__file__).resolve().parents[2]
        with patch("builtins.print"):
            status = main(["doctor", "--root", str(repository_root)])

        self.assertEqual(status, 0)


if __name__ == "__main__":
    unittest.main()
