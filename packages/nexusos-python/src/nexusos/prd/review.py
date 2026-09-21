"""Deterministic checks for objectively inspectable authoring defects."""

import re

from nexusos.prd.schemas import Brief, ReviewIssue


def inspect_traceability(content: str, brief: Brief) -> list[ReviewIssue]:
    """Flag missing identifiers and unknown citations without assigning quality scores."""
    issues = []
    if not re.search(r"\bFR-\d{3,}\b", content):
        issues.append(
            ReviewIssue(
                severity="major",
                section="功能需求",
                problem="未发现可追踪的 FR 需求编号。",
                suggestion="给首版功能分配稳定的 FR 编号，并在验收条件中引用。",
            )
        )
    if not re.search(r"\bAC-\d{3,}\b", content):
        issues.append(
            ReviewIssue(
                severity="major",
                section="验收条件",
                problem="未发现 AC 验收条件编号。",
                suggestion="为核心需求补充可观察的验收条件，使用 AC 编号对应 FR 需求。",
            )
        )
    references = set(re.findall(r"\[(S\d+)\]", content))
    known = {f"S{i}" for i in range(1, len(brief.sources) + 1)}
    for reference in sorted(references - known):
        issues.append(
            ReviewIssue(
                severity="blocker",
                section="来源引用",
                problem=f"引用 [{reference}] 不存在于当前简报的参考材料中。",
                suggestion="补充对应来源材料或移除无依据引用，并把相关结论标为待确认。",
            )
        )
    return issues
