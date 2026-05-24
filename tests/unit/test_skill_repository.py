import tempfile
import unittest
from pathlib import Path

from nexusos.skills.repository import FileSkillRepository, SkillManifestError


class FileSkillRepositoryTests(unittest.TestCase):
    def test_indexes_metadata_before_loading_instructions(self) -> None:
        repository = FileSkillRepository("skills")

        summaries = repository.list_summaries()

        self.assertEqual(len(summaries), 5)
        self.assertEqual(summaries[0].id, "architecture-review")
        self.assertEqual(repository.load("competitor-analysis").summary.cost_level, "medium")
        self.assertIn("公开事实", repository.load("competitor-analysis").instructions)

    def test_rejects_duplicate_ids(self) -> None:
        manifest = """apiVersion: nexusos/v1
kind: Skill
metadata: {name: duplicate, version: 1.0.0}
spec:
  description: duplicate
  domains: [test]
  capabilities: [test]
  routing: {keywords: [test]}
  instructions: instructions.md
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("first", "second"):
                package = root / name
                package.mkdir()
                (package / "skill.yaml").write_text(manifest, encoding="utf-8")
                (package / "instructions.md").write_text("Run the test.", encoding="utf-8")

            with self.assertRaisesRegex(SkillManifestError, "duplicate skill id"):
                FileSkillRepository(root)


if __name__ == "__main__":
    unittest.main()
