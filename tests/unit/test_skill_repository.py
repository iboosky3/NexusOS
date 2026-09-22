import tempfile
import unittest
from pathlib import Path

from nexusos.skills.repository import FileSkillRepository, SkillEditConflict, SkillManifestError


class FileSkillRepositoryTests(unittest.TestCase):
    def test_indexes_metadata_before_loading_instructions(self) -> None:
        repository = FileSkillRepository("skills")

        summaries = repository.list_summaries()

        self.assertEqual(len(summaries), 7)
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

    def test_instruction_edit_requires_current_digest_and_stays_in_registered_package(self) -> None:
        manifest = """apiVersion: nexusos/v1
kind: Skill
metadata: {name: editable, version: 1.0.0}
spec:
  description: Editable Skill
  capabilities: [test]
  instructions: instructions.md
"""
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / "editable"
            package.mkdir()
            (package / "skill.yaml").write_text(manifest, encoding="utf-8")
            source = package / "instructions.md"
            source.write_text("Original instructions", encoding="utf-8")
            repository = FileSkillRepository(directory)
            previous = repository.digest(repository.load("editable").instructions)

            current = repository.update_instructions("editable", "Revised instructions", previous)
            self.assertEqual(repository.load("editable").instructions, "Revised instructions")
            self.assertEqual(current, repository.digest("Revised instructions"))
            with self.assertRaises(SkillEditConflict):
                repository.update_instructions("editable", "Stale edit", previous)
            with self.assertRaisesRegex(ValueError, "不能为空"):
                repository.update_instructions("editable", " ", current)
            with self.assertRaises(KeyError):
                repository.update_instructions("missing", "Unexpected", current)
            self.assertEqual(source.read_text(encoding="utf-8"), "Revised instructions")

            (package / "skill.yaml").write_text(
                manifest.replace("instructions.md", "../outside.md"), encoding="utf-8"
            )
            with self.assertRaises(SkillManifestError):
                repository.load("editable")


if __name__ == "__main__":
    unittest.main()
