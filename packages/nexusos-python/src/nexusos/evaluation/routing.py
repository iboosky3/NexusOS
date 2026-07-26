"""Information retrieval metrics for skill routing benchmarks."""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import fmean
from typing import Sequence


@dataclass(frozen=True, slots=True)
class RoutingExample:
    """One task with a non-empty set of acceptable skills."""

    id: str
    query: str
    relevant_skill_ids: frozenset[str]

    def __post_init__(self) -> None:
        if not self.id or not self.query.strip() or not self.relevant_skill_ids:
            raise ValueError("routing examples require id, query, and relevant skills")


@dataclass(frozen=True, slots=True)
class RoutingMetrics:
    """Aggregate routing quality metrics over a benchmark dataset."""

    examples: int
    top1_accuracy: float
    recall_at_3: float
    recall_at_5: float
    mean_reciprocal_rank: float
    ndcg_at_5: float


def evaluate_rankings(
    examples: Sequence[RoutingExample], rankings: Sequence[Sequence[str]]
) -> RoutingMetrics:
    """Evaluate aligned rankings with binary relevance judgments."""

    if len(examples) != len(rankings) or not examples:
        raise ValueError("examples and rankings must be aligned and non-empty")
    return RoutingMetrics(
        examples=len(examples),
        top1_accuracy=fmean(
            float(bool(ranking) and ranking[0] in example.relevant_skill_ids)
            for example, ranking in zip(examples, rankings, strict=True)
        ),
        recall_at_3=fmean(
            _recall(ranking, example.relevant_skill_ids, 3)
            for example, ranking in zip(examples, rankings, strict=True)
        ),
        recall_at_5=fmean(
            _recall(ranking, example.relevant_skill_ids, 5)
            for example, ranking in zip(examples, rankings, strict=True)
        ),
        mean_reciprocal_rank=fmean(
            _reciprocal_rank(ranking, example.relevant_skill_ids)
            for example, ranking in zip(examples, rankings, strict=True)
        ),
        ndcg_at_5=fmean(
            _ndcg(ranking, example.relevant_skill_ids, 5)
            for example, ranking in zip(examples, rankings, strict=True)
        ),
    )


def _recall(ranking: Sequence[str], relevant: frozenset[str], limit: int) -> float:
    return len(set(ranking[:limit]) & relevant) / len(relevant)


def _reciprocal_rank(ranking: Sequence[str], relevant: frozenset[str]) -> float:
    for index, identifier in enumerate(ranking, start=1):
        if identifier in relevant:
            return 1.0 / index
    return 0.0


def _ndcg(ranking: Sequence[str], relevant: frozenset[str], limit: int) -> float:
    discounted_gain = sum(
        1.0 / math.log2(index + 2)
        for index, identifier in enumerate(ranking[:limit])
        if identifier in relevant
    )
    ideal_gain = sum(1.0 / math.log2(index + 2) for index in range(min(limit, len(relevant))))
    return discounted_gain / ideal_gain if ideal_gain else 0.0
