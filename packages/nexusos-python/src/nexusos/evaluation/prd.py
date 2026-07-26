"""Deterministic PRD quality gate used before model-based evaluation."""

from __future__ import annotations

from statistics import fmean

from nexusos.core.models import ReviewResult

_REQUIRED_SECTIONS = ("需求与范围", "用户流程", "技术方案", "成功指标")


def evaluate_prd(content: str, *, evidence_count: int = 0) -> ReviewResult:
    """Score structural quality and return actionable revision tasks."""

    normalized = content.strip()
    if not normalized:
        return ReviewResult(
            overall_score=0,
            dimensions={
                "clarity": 0,
                "completeness": 0,
                "feasibility": 0,
                "consistency": 0,
                "evidence": 0,
            },
            blocking_issues=("PRD 内容为空",),
            revision_tasks=("生成完整 PRD 后重新评审",),
        )

    heading_count = sum(1 for line in normalized.splitlines() if line.startswith("#"))
    clarity = min(100.0, 50.0 + heading_count * 6 + min(len(normalized) / 40, 20))
    found_sections = sum(section in normalized for section in _REQUIRED_SECTIONS)
    completeness = 100.0 * found_sections / len(_REQUIRED_SECTIONS)
    feasibility_signals = ("MVP", "技术方案", "风险")
    feasibility = 55.0 + 15.0 * sum(signal in normalized for signal in feasibility_signals)
    contradiction_markers = normalized.count("待定") + normalized.count("TBD")
    consistency = max(40.0, 100.0 - contradiction_markers * 10)
    if evidence_count > 0:
        evidence = min(100.0, 75.0 + evidence_count * 5)
    elif "待验证" in normalized or "假设" in normalized:
        evidence = 85.0
    else:
        evidence = 45.0

    dimensions = {
        "clarity": round(clarity, 2),
        "completeness": round(completeness, 2),
        "feasibility": round(feasibility, 2),
        "consistency": round(consistency, 2),
        "evidence": round(evidence, 2),
    }
    revisions = []
    if completeness < 85:
        missing = [section for section in _REQUIRED_SECTIONS if section not in normalized]
        revisions.append(f"补充缺失章节：{'、'.join(missing)}")
    if feasibility < 85:
        revisions.append("补充 MVP、技术可行性和风险应对")
    if consistency < 85:
        revisions.append("消除待定项或为其指定负责人和截止时间")
    if evidence < 85:
        revisions.append("为关键市场和用户结论补充来源，或明确标记为假设")
    blocking = () if found_sections >= 3 else ("核心章节缺失超过一项",)
    return ReviewResult(
        overall_score=round(fmean(dimensions.values()), 2),
        dimensions=dimensions,
        blocking_issues=blocking,
        revision_tasks=tuple(revisions),
    )
