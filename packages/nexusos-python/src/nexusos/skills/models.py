"""Models for lightweight skill discovery and full package execution."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class SkillSummary:
    """Routing metadata that is safe to keep in the discovery index."""

    id: str
    version: str
    description: str
    domains: tuple[str, ...]
    capabilities: tuple[str, ...]
    keywords: tuple[str, ...]
    required_tools: tuple[str, ...] = ()
    cost_level: str = "medium"
    risk_level: str = "low"
    estimated_tokens: int = 0
    success_rate: float = 0.5
    average_latency_ms: int = 1000

    def __post_init__(self) -> None:
        if not self.id or not self.version or not self.description:
            raise ValueError("skill id, version, and description are required")
        if not 0 <= self.success_rate <= 1:
            raise ValueError("skill success rate must be between 0 and 1")
        if self.estimated_tokens < 0 or self.average_latency_ms < 0:
            raise ValueError("skill estimates cannot be negative")


@dataclass(frozen=True, slots=True)
class SkillPackage:
    """Complete skill payload loaded only after routing selects it."""

    summary: SkillSummary
    instructions: str
    input_schema: Mapping[str, Any]
    output_schema: Mapping[str, Any]
    examples: tuple[str, ...] = ()
    references: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.instructions.strip():
            raise ValueError(f"skill {self.summary.id!r} has empty instructions")
        object.__setattr__(self, "input_schema", MappingProxyType(dict(self.input_schema)))
        object.__setattr__(self, "output_schema", MappingProxyType(dict(self.output_schema)))
