"""Translate structured review failures into a bounded revision graph."""

from __future__ import annotations

from nexusos.core.models import ReviewResult, Task, TaskGraph


class RevisionPlanner:
    """Create only the tasks needed to address failed review dimensions."""

    def plan(self, review: ReviewResult, iteration: int) -> TaskGraph:
        if review.passed:
            raise ValueError("a passing review does not require replanning")
        if iteration < 1:
            raise ValueError("revision iteration must be positive")
        prefix = f"revision-{iteration}"
        source_tasks: list[Task] = []
        if review.dimensions.get("evidence", 0) < 85:
            source_tasks.append(
                Task(
                    f"{prefix}-research",
                    "补充证据",
                    "为缺少来源的市场、用户和竞品结论补充证据或假设标记",
                    required_capabilities=("market_research", "evidence_synthesis"),
                    metadata={"domains": ("research",), "handler": "market"},
                )
            )
        if review.dimensions.get("feasibility", 0) < 85:
            source_tasks.append(
                Task(
                    f"{prefix}-technical",
                    "修订技术可行性",
                    "补充 MVP 技术边界、主要风险和应对方案",
                    required_capabilities=("technical_design", "risk_analysis"),
                    metadata={"domains": ("engineering", "architecture"), "handler": "technical"},
                )
            )
        if review.dimensions.get("completeness", 0) < 85:
            source_tasks.append(
                Task(
                    f"{prefix}-requirements",
                    "补充缺失需求",
                    "根据评审修订任务补充缺失章节与验收标准",
                    required_capabilities=("requirement_analysis", "prioritization"),
                    metadata={"domains": ("product",), "handler": "requirements"},
                )
            )
        write_id = f"{prefix}-write"
        write = Task(
            write_id,
            "修订 PRD",
            "合并原文与修订结果，生成完整且一致的新版本 PRD",
            dependencies=tuple(task.id for task in source_tasks),
            required_capabilities=("prd_generation", "structured_writing"),
            metadata={"domains": ("product", "writing"), "handler": "write"},
        )
        review_task = Task(
            f"{prefix}-review",
            "重新评审 PRD",
            "使用同一版本 Rubric 检查修订后的 PRD",
            dependencies=(write_id,),
            required_capabilities=("quality_review", "consistency_review"),
            metadata={"domains": ("product", "writing"), "handler": "review"},
        )
        return TaskGraph((*source_tasks, write, review_task))
