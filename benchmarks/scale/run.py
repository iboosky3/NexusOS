"""Measure routing behavior as the in-memory skill catalog grows."""

from __future__ import annotations

import argparse
import json
import platform
import time
import tracemalloc
from pathlib import Path

from nexusos.evaluation import evaluate_rankings
from nexusos.router import HybridSkillRouter, RouteRequest, RoutingPolicy
from nexusos.skills import FileSkillRepository, SkillSummary

from benchmarks.router.run import load_examples

_DOMAINS = ("finance", "healthcare", "operations", "legal", "sales", "support")


def generate_catalog(real_skills: tuple[SkillSummary, ...], size: int) -> tuple[SkillSummary, ...]:
    """Create a deterministic catalog with unrelated decoys for scale tests."""

    if size < len(real_skills):
        raise ValueError("catalog size cannot be smaller than the real skill set")
    generated = list(real_skills)
    for index in range(size - len(real_skills)):
        domain = _DOMAINS[index % len(_DOMAINS)]
        generated.append(
            SkillSummary(
                id=f"synthetic-{domain}-{index:06d}",
                version="1.0.0",
                description=f"Synthetic {domain} capability number {index} for scale testing",
                domains=(domain,),
                capabilities=(f"{domain}_operation_{index % 50}",),
                keywords=(domain, f"operation-{index % 50}"),
                estimated_tokens=800 + index % 400,
                success_rate=0.5 + (index % 40) / 100,
                average_latency_ms=500 + index % 2500,
            )
        )
    return tuple(generated)


def run(catalog_size: int, repeats: int = 1) -> dict[str, object]:
    repository = FileSkillRepository("skills")
    examples = load_examples(Path("benchmarks/router/dataset.jsonl"))
    catalog = generate_catalog(repository.list_summaries(), catalog_size)
    router = HybridSkillRouter(catalog)
    latencies = []
    rankings = []
    selected_tokens = []
    tracemalloc.start()
    for _ in range(repeats):
        for example in examples:
            started = time.perf_counter()
            selected = router.route(
                RouteRequest(
                    example.query,
                    maximum_results=5,
                    token_budget=20_000,
                    policy=RoutingPolicy(
                        allowed_tools=("web.search", "knowledge.query", "file.write"),
                        maximum_risk_level="high",
                    ),
                )
            )
            latencies.append((time.perf_counter() - started) * 1000)
            if len(rankings) < len(examples):
                rankings.append(tuple(candidate.skill.id for candidate in selected))
                selected_tokens.append(sum(item.skill.estimated_tokens for item in selected))
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    metrics = evaluate_rankings(examples, rankings)
    return {
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
        },
        "catalog_size": catalog_size,
        "queries": len(latencies),
        "repeats": repeats,
        "seed": "deterministic-v1",
        "quality": {
            "top1_accuracy": round(metrics.top1_accuracy, 6),
            "recall_at_5": round(metrics.recall_at_5, 6),
            "mrr": round(metrics.mean_reciprocal_rank, 6),
        },
        "latency_ms": {
            "p50": round(_percentile(latencies, 0.50), 3),
            "p95": round(_percentile(latencies, 0.95), 3),
        },
        "tokens": {
            "all_skill_instructions": sum(skill.estimated_tokens for skill in catalog),
            "average_selected_instructions": round(sum(selected_tokens) / len(selected_tokens), 2),
        },
        "peak_traced_memory_bytes": peak_bytes,
    }


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int((len(ordered) - 1) * fraction + 0.5)))
    return ordered[index]


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark NexusOS at synthetic catalog scale")
    parser.add_argument("--catalog-size", type=int, default=10_000)
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = json.dumps(run(args.catalog_size, args.repeats), ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
