"""Filesystem skill repository with explicit progressive disclosure."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import yaml

from nexusos.skills.models import SkillPackage, SkillSummary


class SkillManifestError(ValueError):
    """Raised when a skill package violates the NexusOS manifest contract."""


class FileSkillRepository:
    """Index manifests eagerly and load package bodies on selection."""

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)
        self._locations: dict[str, Path] = {}
        self._summaries: dict[str, SkillSummary] = {}
        self.refresh()

    def refresh(self) -> None:
        """Rebuild the metadata index without reading instruction files."""

        locations: dict[str, Path] = {}
        summaries: dict[str, SkillSummary] = {}
        for path in sorted(self._root.glob("**/skill.yaml")):
            manifest = self._read_manifest(path)
            summary = self._to_summary(manifest, path)
            if summary.id in summaries:
                raise SkillManifestError(f"duplicate skill id: {summary.id}")
            locations[summary.id] = path.parent
            summaries[summary.id] = summary
        self._locations = locations
        self._summaries = summaries

    def list_summaries(self) -> tuple[SkillSummary, ...]:
        """Return stable lightweight summaries sorted by skill id."""

        return tuple(self._summaries[key] for key in sorted(self._summaries))

    def get_summary(self, skill_id: str) -> SkillSummary:
        try:
            return self._summaries[skill_id]
        except KeyError as exc:
            raise KeyError(f"unknown skill: {skill_id}") from exc

    def load(self, skill_id: str) -> SkillPackage:
        """Load instructions and optional resources for one selected skill."""

        try:
            package_root = self._locations[skill_id]
        except KeyError as exc:
            raise KeyError(f"unknown skill: {skill_id}") from exc

        manifest = self._read_manifest(package_root / "skill.yaml")
        spec = self._mapping(manifest, "spec")
        instructions_path = package_root / str(spec.get("instructions", "instructions.md"))
        if not instructions_path.is_file():
            raise SkillManifestError(f"missing instructions for skill {skill_id}")

        return SkillPackage(
            summary=self._summaries[skill_id],
            instructions=instructions_path.read_text(encoding="utf-8"),
            input_schema=self._mapping(spec, "input_schema", required=False),
            output_schema=self._mapping(spec, "output_schema", required=False),
            examples=self._read_optional_directory(package_root / "examples"),
            references=self._read_optional_directory(package_root / "references"),
        )

    @staticmethod
    def _read_manifest(path: Path) -> Mapping[str, Any]:
        if not path.is_file():
            raise SkillManifestError(f"manifest does not exist: {path}")
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise SkillManifestError(f"manifest must be a mapping: {path}")
        if raw.get("apiVersion") != "nexusos/v1" or raw.get("kind") != "Skill":
            raise SkillManifestError(f"unsupported skill manifest: {path}")
        return raw

    @classmethod
    def _to_summary(cls, manifest: Mapping[str, Any], path: Path) -> SkillSummary:
        metadata = cls._mapping(manifest, "metadata")
        spec = cls._mapping(manifest, "spec")
        routing = cls._mapping(spec, "routing", required=False)
        requirements = cls._mapping(spec, "requirements", required=False)
        cost = cls._mapping(spec, "cost", required=False)
        risk = cls._mapping(spec, "risk", required=False)
        quality = cls._mapping(spec, "quality", required=False)
        performance = cls._mapping(spec, "performance", required=False)
        try:
            return SkillSummary(
                id=str(metadata["name"]),
                version=str(metadata["version"]),
                description=str(spec["description"]).strip(),
                domains=cls._strings(spec.get("domains", [])),
                capabilities=cls._strings(spec.get("capabilities", [])),
                keywords=cls._strings(routing.get("keywords", [])),
                required_tools=cls._strings(requirements.get("tools", [])),
                cost_level=str(cost.get("level", "medium")),
                risk_level=str(risk.get("level", "low")),
                estimated_tokens=int(cost.get("estimated_tokens", 0)),
                success_rate=float(quality.get("success_rate", 0.5)),
                average_latency_ms=int(performance.get("average_latency_ms", 1000)),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise SkillManifestError(f"invalid manifest fields: {path}: {exc}") from exc

    @staticmethod
    def _mapping(
        value: Mapping[str, Any], key: str, *, required: bool = True
    ) -> Mapping[str, Any]:
        item = value.get(key)
        if item is None and not required:
            return {}
        if not isinstance(item, dict):
            raise SkillManifestError(f"field {key!r} must be a mapping")
        return item

    @staticmethod
    def _strings(value: Any) -> tuple[str, ...]:
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise SkillManifestError("list field must contain only strings")
        return tuple(value)

    @staticmethod
    def _read_optional_directory(path: Path) -> tuple[str, ...]:
        if not path.is_dir():
            return ()
        return tuple(
            item.read_text(encoding="utf-8")
            for item in sorted(path.iterdir())
            if item.is_file()
        )
