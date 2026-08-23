"""Deterministic local implementation of the NexusOS hybrid router."""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Sequence

from nexusos.router.models import RouteCandidate, RouteRequest, RoutingPolicy
from nexusos.skills.models import SkillSummary

_LATIN_WORD = re.compile(r"[a-z0-9_]+")
_CJK_RUN = re.compile(r"[\u3400-\u9fff]+")
_COST_ORDER = {"low": 0, "medium": 1, "high": 2}
_RISK_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
_DOMAIN_HINTS = {
    "product": {"prd", "product", "requirement", "需求", "产品", "功能", "竞品"},
    "research": {"research", "market", "competitor", "调研", "市场", "竞品", "分析"},
    "design": {"design", "ux", "ui", "flow", "设计", "流程", "体验", "信息架构"},
    "ux": {"ux", "journey", "flow", "用户流程", "体验", "旅程"},
    "engineering": {"architecture", "api", "database", "技术", "架构", "接口", "数据"},
    "architecture": {"architecture", "system", "架构", "系统", "技术方案"},
    "writing": {"write", "document", "prd", "撰写", "文档", "输出"},
}


class HybridSkillRouter:
    """Fuse lexical, semantic-proxy, hierarchy, quality, and cost signals."""

    def __init__(self, skills: Sequence[SkillSummary]) -> None:
        self._skills = tuple(skills)

    def route(self, request: RouteRequest) -> tuple[RouteCandidate, ...]:
        """Rank candidates, enforce policy, and fit results into a token budget."""

        inferred_domains = self._infer_domains(request.query) | set(request.preferred_domains)
        scored: list[RouteCandidate] = []
        for skill in self._skills:
            if not self._allowed(skill, request.policy):
                continue
            reasons = self._score_signals(skill, request, inferred_domains)
            score = (
                0.30 * reasons["semantic"]
                + 0.15 * reasons["keyword"]
                + 0.15 * reasons["domain"]
                + 0.15 * reasons["success"]
                + 0.10 * reasons["capability"]
                + 0.10 * reasons["cost"]
                + 0.05 * reasons["latency"]
            )
            if score > 0.12:
                scored.append(RouteCandidate(skill, round(score, 6), reasons))

        scored.sort(key=lambda candidate: (-candidate.score, candidate.skill.id))
        selected: list[RouteCandidate] = []
        consumed_tokens = 0
        for candidate in scored:
            if len(selected) >= request.maximum_results:
                break
            next_total = consumed_tokens + candidate.skill.estimated_tokens
            if next_total > request.token_budget:
                continue
            selected.append(candidate)
            consumed_tokens = next_total
        return tuple(selected)

    @staticmethod
    def _score_signals(
        skill: SkillSummary, request: RouteRequest, inferred_domains: set[str]
    ) -> dict[str, float]:
        query_tokens = _tokens(request.query)
        description_tokens = _tokens(
            " ".join((skill.description, *skill.capabilities, *skill.keywords))
        )
        keyword_tokens = _tokens(" ".join(skill.keywords))
        capability_tokens = _tokens(" ".join(skill.capabilities))
        required_tokens = _tokens(" ".join(request.required_capabilities))
        semantic = _cosine(query_tokens, description_tokens)
        keyword = _coverage(query_tokens, keyword_tokens)
        domain = (
            len(inferred_domains & set(skill.domains)) / max(1, len(inferred_domains))
            if inferred_domains
            else 0.5
        )
        capability = _coverage(required_tokens, capability_tokens) if required_tokens else semantic
        cost = {"low": 1.0, "medium": 0.65, "high": 0.3}.get(skill.cost_level, 0.2)
        latency = max(0.0, 1.0 - skill.average_latency_ms / 5000)
        return {
            "semantic": round(semantic, 6),
            "keyword": round(keyword, 6),
            "domain": round(domain, 6),
            "success": skill.success_rate,
            "capability": round(capability, 6),
            "cost": cost,
            "latency": round(latency, 6),
        }

    @staticmethod
    def _allowed(skill: SkillSummary, policy: RoutingPolicy) -> bool:
        if policy.allowed_domains and not set(skill.domains) & set(policy.allowed_domains):
            return False
        if _COST_ORDER.get(skill.cost_level, 99) > _COST_ORDER.get(policy.maximum_cost_level, 2):
            return False
        if _RISK_ORDER.get(skill.risk_level, 99) > _RISK_ORDER.get(policy.maximum_risk_level, 1):
            return False
        return not skill.required_tools or set(skill.required_tools) <= set(policy.allowed_tools)

    @staticmethod
    def _infer_domains(query: str) -> set[str]:
        tokens = _tokens(query)
        normalized = query.casefold()
        return {
            domain
            for domain, hints in _DOMAIN_HINTS.items()
            if tokens & _tokens(" ".join(hints)) or any(hint in normalized for hint in hints)
        }


def _tokens(value: str) -> set[str]:
    normalized = value.casefold().replace("-", "_")
    tokens = set(_LATIN_WORD.findall(normalized))
    for run in _CJK_RUN.findall(normalized):
        tokens.update(run)
        tokens.update(run[index : index + 2] for index in range(max(0, len(run) - 1)))
    return {token for token in tokens if token}


def _coverage(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / min(len(left), len(right))


def _cosine(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    left_counts = Counter(left)
    right_counts = Counter(right)
    dot = sum(left_counts[token] * right_counts[token] for token in left_counts & right_counts)
    left_norm = math.sqrt(sum(value * value for value in left_counts.values()))
    right_norm = math.sqrt(sum(value * value for value in right_counts.values()))
    return dot / (left_norm * right_norm)
