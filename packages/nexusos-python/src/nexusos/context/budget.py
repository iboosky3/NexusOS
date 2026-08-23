"""Deterministic context budgeting independent of a model tokenizer."""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType

from nexusos.core.models import AgentContext, Goal, Task

_CJK_CHARACTER = re.compile(r"[\u3400-\u9fff]")


@dataclass(frozen=True, slots=True)
class ContextFragment:
    """One independently rankable piece of context."""

    section: str
    content: str
    priority: int = 50
    relevance: float = 0.5
    required: bool = False

    def __post_init__(self) -> None:
        if not self.section or not self.content.strip():
            raise ValueError("context section and content are required")
        if not 0 <= self.priority <= 100 or not 0 <= self.relevance <= 1:
            raise ValueError("context priority and relevance are out of range")


@dataclass(frozen=True, slots=True)
class BudgetReport:
    """Explain what was admitted, omitted, and reserved for generation."""

    maximum_tokens: int
    consumed_tokens: int
    reserved_tokens: int
    section_tokens: Mapping[str, int]
    omitted_fragments: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "section_tokens", MappingProxyType(dict(self.section_tokens)))


class ContextBudgetManager:
    """Build bounded context with per-section limits and deterministic ordering."""

    DEFAULT_SHARES = {
        "system": 0.08,
        "task": 0.08,
        "skills": 0.18,
        "memory": 0.10,
        "retrieval": 0.26,
        "tools": 0.08,
    }

    def __init__(self, reserve_share: float = 0.22) -> None:
        if not 0 < reserve_share < 1:
            raise ValueError("reserve share must be between zero and one")
        self._reserve_share = reserve_share

    def build(
        self,
        *,
        run_id: str,
        goal: Goal,
        task: Task,
        fragments: Sequence[ContextFragment],
        maximum_tokens: int,
    ) -> tuple[AgentContext, BudgetReport]:
        """Select fragments without exceeding global or section budgets."""

        if maximum_tokens <= 0:
            raise ValueError("maximum context tokens must be positive")
        reserve = math.ceil(maximum_tokens * self._reserve_share)
        input_budget = maximum_tokens - reserve
        section_limits = {
            section: math.floor(maximum_tokens * share)
            for section, share in self.DEFAULT_SHARES.items()
        }
        selected: dict[str, list[str]] = {}
        section_tokens: dict[str, int] = {}
        consumed = 0
        omitted = 0

        ranked = sorted(
            fragments,
            key=lambda item: (-int(item.required), -item.priority, -item.relevance, item.content),
        )
        for fragment in ranked:
            cost = estimate_tokens(fragment.content)
            current_section = section_tokens.get(fragment.section, 0)
            section_limit = section_limits.get(fragment.section, input_budget)
            fits = consumed + cost <= input_budget and current_section + cost <= section_limit
            if not fits and not fragment.required:
                omitted += 1
                continue
            if not fits:
                raise ValueError(f"required context does not fit budget: {fragment.section}")
            selected.setdefault(fragment.section, []).append(fragment.content)
            section_tokens[fragment.section] = current_section + cost
            consumed += cost

        context = AgentContext(
            run_id=run_id,
            goal=goal,
            task=task,
            sections={key: tuple(values) for key, values in selected.items()},
            token_budget=input_budget,
        )
        report = BudgetReport(
            maximum_tokens=maximum_tokens,
            consumed_tokens=consumed,
            reserved_tokens=reserve,
            section_tokens=section_tokens,
            omitted_fragments=omitted,
        )
        return context, report


def estimate_tokens(value: str) -> int:
    """Estimate mixed-language tokens conservatively without a provider tokenizer."""

    cjk_count = len(_CJK_CHARACTER.findall(value))
    non_cjk_count = max(0, len(value) - cjk_count)
    return max(1, cjk_count + math.ceil(non_cjk_count / 4))
