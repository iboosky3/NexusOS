"""Framework-neutral requests and results for skill routing."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from nexusos.skills.models import SkillSummary


@dataclass(frozen=True, slots=True)
class RoutingPolicy:
    """Hard constraints applied before candidates reach the selector."""

    allowed_domains: tuple[str, ...] = ()
    allowed_tools: tuple[str, ...] = ()
    maximum_cost_level: str = "high"
    maximum_risk_level: str = "medium"


@dataclass(frozen=True, slots=True)
class RouteRequest:
    """One budgeted capability discovery request."""

    query: str
    required_capabilities: tuple[str, ...] = ()
    preferred_domains: tuple[str, ...] = ()
    maximum_results: int = 3
    token_budget: int = 5000
    policy: RoutingPolicy = field(default_factory=RoutingPolicy)

    def __post_init__(self) -> None:
        if not self.query.strip():
            raise ValueError("routing query cannot be empty")
        if self.maximum_results < 1 or self.token_budget < 0:
            raise ValueError("routing limits must be positive")


@dataclass(frozen=True, slots=True)
class RouteCandidate:
    """An explainable ranked skill candidate."""

    skill: SkillSummary
    score: float
    reasons: Mapping[str, float]

    def __post_init__(self) -> None:
        object.__setattr__(self, "reasons", MappingProxyType(dict(self.reasons)))
