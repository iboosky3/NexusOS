"""Run offline routing baselines against the versioned benchmark dataset."""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Sequence
from pathlib import Path

from nexusos.evaluation import RoutingExample, evaluate_rankings
from nexusos.router import HybridSkillRouter, RouteRequest, RoutingPolicy
from nexusos.skills import FileSkillRepository

_TOKEN = re.compile(r"[a-z0-9_]+|[\u3400-\u9fff]{1,2}", re.IGNORECASE)


def load_examples(path: Path) -> tuple[RoutingExample, ...]:
    examples = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        value = json.loads(line)
        examples.append(
            RoutingExample(
                id=value["id"],
                query=value["query"],
                relevant_skill_ids=frozenset(value["relevant_skill_ids"]),
            )
        )
    return tuple(examples)


def run(dataset: Path, skills_root: Path) -> dict[str, object]:
    repository = FileSkillRepository(skills_root)
    summaries = repository.list_summaries()
    examples = load_examples(dataset)
    all_tools = tuple(sorted({tool for skill in summaries for tool in skill.required_tools}))
    all_ids = tuple(skill.id for skill in summaries)
    all_rankings = tuple(all_ids for _ in examples)
    keyword_rankings = tuple(_keyword_ranking(example.query, summaries) for example in examples)
    router = HybridSkillRouter(summaries)
    hybrid_rankings = tuple(
        tuple(
            item.skill.id
            for item in router.route(
                RouteRequest(
                    example.query,
                    maximum_results=5,
                    token_budget=20_000,
                    policy=RoutingPolicy(
                        allowed_tools=all_tools,
                        maximum_cost_level="high",
                        maximum_risk_level="high",
                    ),
                )
            )
        )
        for example in examples
    )
    return {
        "dataset": str(dataset),
        "skills": len(summaries),
        "examples": len(examples),
        "strategies": {
            "all_skills": _result(examples, all_rankings, summaries),
            "keyword": _result(examples, keyword_rankings, summaries),
            "nexus_hybrid": _result(examples, hybrid_rankings, summaries),
        },
    }


def _keyword_ranking(query: str, summaries: Sequence[object]) -> tuple[str, ...]:
    query_tokens = set(_TOKEN.findall(query.casefold()))
    scored = []
    for skill in summaries:
        text = " ".join((skill.description, *skill.keywords, *skill.capabilities)).casefold()
        score = len(query_tokens & set(_TOKEN.findall(text)))
        scored.append((score, skill.id))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return tuple(identifier for _, identifier in scored[:5])


def _result(examples, rankings, summaries) -> dict[str, object]:
    metrics = evaluate_rankings(examples, rankings)
    token_by_id = {skill.id: skill.estimated_tokens for skill in summaries}
    average_tokens = sum(
        sum(token_by_id.get(identifier, 0) for identifier in ranking) for ranking in rankings
    ) / len(rankings)
    return {
        "top1_accuracy": round(metrics.top1_accuracy, 6),
        "recall_at_3": round(metrics.recall_at_3, 6),
        "recall_at_5": round(metrics.recall_at_5, 6),
        "mrr": round(metrics.mean_reciprocal_rank, 6),
        "ndcg_at_5": round(metrics.ndcg_at_5, 6),
        "average_selected_instruction_tokens": round(average_tokens, 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the NexusOS skill routing benchmark")
    parser.add_argument("--dataset", type=Path, default=Path("benchmarks/router/dataset.jsonl"))
    parser.add_argument("--skills", type=Path, default=Path("skills"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = json.dumps(run(args.dataset, args.skills), ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
