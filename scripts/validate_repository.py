"""Validate repository contracts that do not require external service runtimes."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
EVOLUTION_ENTRY = re.compile(r"^### (\d{4}-\d{2}-\d{2}) · v(\d+\.\d+) · ", re.MULTILINE)
ISSUE_INDEX_ENTRY = re.compile(r"^\| (NX-\d{3}) \|", re.MULTILINE)
ISSUE_SECTION = re.compile(r"^## (NX-\d{3}) ·", re.MULTILINE)


def _walk_nav(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _walk_nav(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _walk_nav(item)


def validate_json_contracts() -> int:
    """Parse every JSON contract and reject duplicate schema identities."""

    schema_ids: set[str] = set()
    count = 0
    for path in sorted((ROOT / "contracts").rglob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        schema_id = document.get("$id")
        if not isinstance(schema_id, str) or not schema_id:
            raise AssertionError(f"contract has no $id: {path.relative_to(ROOT)}")
        if schema_id in schema_ids:
            raise AssertionError(f"duplicate contract $id: {schema_id}")
        schema_ids.add(schema_id)
        count += 1
    return count


def validate_yaml_and_manifests() -> tuple[int, int]:
    """Parse YAML and verify unique Agent and Skill identities and local references."""

    for path in sorted(ROOT.rglob("*.y*ml")):
        if any(part in {".git", "site", "node_modules"} for part in path.parts):
            continue
        yaml.safe_load(path.read_text(encoding="utf-8"))

    agent_ids: set[str] = set()
    for path in sorted((ROOT / "agents").rglob("agent.yaml")):
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        agent_id = document.get("metadata", {}).get("name")
        if not agent_id or agent_id in agent_ids:
            raise AssertionError(f"invalid or duplicate Agent id in {path.relative_to(ROOT)}")
        agent_ids.add(agent_id)

    skill_ids: set[str] = set()
    for path in sorted((ROOT / "skills").rglob("skill.yaml")):
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        skill_id = document.get("metadata", {}).get("name")
        if not skill_id or skill_id in skill_ids:
            raise AssertionError(f"invalid or duplicate Skill id in {path.relative_to(ROOT)}")
        skill_ids.add(skill_id)
        instructions = path.parent / document.get("spec", {}).get("instructions", "")
        if not instructions.is_file():
            raise AssertionError(f"missing Skill instructions: {instructions.relative_to(ROOT)}")
    return len(agent_ids), len(skill_ids)


def validate_documentation() -> int:
    """Resolve navigation targets and enforce append-only engineering ledgers."""

    config = yaml.safe_load((ROOT / "mkdocs.yml").read_text(encoding="utf-8"))
    docs_root = ROOT / config["docs_dir"]
    nav_paths = tuple(_walk_nav(config["nav"]))
    missing = [path for path in nav_paths if not (docs_root / path).is_file()]
    if missing:
        raise AssertionError(f"missing MkDocs navigation targets: {missing}")

    evolution = (docs_root / "architecture" / "architecture-evolution.md").read_text(
        encoding="utf-8"
    )
    entries = EVOLUTION_ENTRY.findall(evolution)
    if not entries or entries != sorted(entries, key=lambda item: item[0]):
        raise AssertionError("architecture evolution entries must be chronological")
    versions = [version for _, version in entries]
    if len(versions) != len(set(versions)):
        raise AssertionError("architecture evolution versions must be unique")

    problem_log = (docs_root / "development" / "problem-log.md").read_text(encoding="utf-8")
    indexed = ISSUE_INDEX_ENTRY.findall(problem_log)
    sections = ISSUE_SECTION.findall(problem_log)
    if indexed != sections:
        raise AssertionError("problem log index and detail sections must match and keep order")
    return len(nav_paths)


def main() -> None:
    """Run all validators and print a compact evidence summary."""

    contracts = validate_json_contracts()
    agents, skills = validate_yaml_and_manifests()
    pages = validate_documentation()
    print(
        f"repository validation passed: {contracts} contracts, {agents} agents, "
        f"{skills} skills, {pages} documentation pages"
    )


if __name__ == "__main__":
    main()
