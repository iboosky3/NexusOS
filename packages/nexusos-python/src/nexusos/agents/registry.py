"""Manifest-backed agent discovery with capability-based assignment."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import yaml

from nexusos.core.models import Task


@dataclass(frozen=True, slots=True)
class AgentDescriptor:
    """Static policy and capabilities used to resolve an agent."""

    id: str
    version: str
    role: str
    capabilities: tuple[str, ...]
    allowed_domains: tuple[str, ...]
    allowed_tools: tuple[str, ...]
    maximum_skills_per_task: int = 3


class FileAgentRegistry:
    """Load versioned agent descriptors from YAML manifests."""

    def __init__(self, root: str | Path) -> None:
        self._agents: dict[str, AgentDescriptor] = {}
        for path in sorted(Path(root).glob("**/agent.yaml")):
            descriptor = self._load(path)
            if descriptor.id in self._agents:
                raise ValueError(f"duplicate agent id: {descriptor.id}")
            self._agents[descriptor.id] = descriptor

    def list(self) -> tuple[AgentDescriptor, ...]:
        return tuple(self._agents[key] for key in sorted(self._agents))

    def get(self, agent_id: str) -> AgentDescriptor:
        try:
            return self._agents[agent_id]
        except KeyError as exc:
            raise KeyError(f"unknown agent: {agent_id}") from exc

    @staticmethod
    def _load(path: Path) -> AgentDescriptor:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or raw.get("apiVersion") != "nexusos/v1":
            raise ValueError(f"unsupported agent manifest: {path}")
        if raw.get("kind") != "Agent":
            raise ValueError(f"manifest is not an agent: {path}")
        metadata = _mapping(raw, "metadata")
        spec = _mapping(raw, "spec")
        skill_policy = _mapping(spec, "skill_policy")
        tool_policy = _mapping(spec, "tool_policy")
        return AgentDescriptor(
            id=str(metadata["name"]),
            version=str(metadata["version"]),
            role=str(spec["role"]),
            capabilities=_strings(spec.get("capabilities", [])),
            allowed_domains=_strings(skill_policy.get("allowed_domains", [])),
            allowed_tools=_strings(tool_policy.get("allowed", [])),
            maximum_skills_per_task=int(skill_policy.get("maximum_skills_per_task", 3)),
        )


class AgentResolver:
    """Select the most compatible registered agent for one task."""

    def __init__(self, agents: tuple[AgentDescriptor, ...]) -> None:
        self._agents = agents

    def resolve(self, task: Task) -> AgentDescriptor:
        required = set(task.required_capabilities)
        task_domains = set(task.metadata.get("domains", ()))
        ranked: list[tuple[float, str, AgentDescriptor]] = []
        for agent in self._agents:
            capability_score = (
                len(required & set(agent.capabilities)) / len(required) if required else 0.5
            )
            domain_score = (
                len(task_domains & set(agent.allowed_domains)) / len(task_domains)
                if task_domains
                else 0.5
            )
            score = 0.75 * capability_score + 0.25 * domain_score
            if capability_score > 0:
                ranked.append((score, agent.id, agent))
        if not ranked:
            raise LookupError(f"no agent can satisfy task {task.id!r}")
        ranked.sort(key=lambda item: (-item[0], item[1]))
        return ranked[0][2]


def _mapping(value: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    item = value.get(key)
    if not isinstance(item, dict):
        raise ValueError(f"field {key!r} must be a mapping")
    return item


def _strings(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("agent list field must contain only strings")
    return tuple(value)
