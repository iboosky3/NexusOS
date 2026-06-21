"""Deterministic reference planner for the Nexus PRD application."""

from __future__ import annotations

from dataclasses import dataclass

from nexusos.core.models import Goal, Task, TaskGraph


@dataclass(frozen=True, slots=True)
class PrdPlan:
    """Normalized goal and its executable task graph."""

    goal: Goal
    graph: TaskGraph
    complexity: str


class ReferencePrdPlanner:
    """Build a capability-oriented DAG without binding tasks to agents."""

    _COMPLEXITY_HINTS = {
        "enterprise",
        "multi-tenant",
        "compliance",
        "企业",
        "多租户",
        "合规",
        "跨平台",
    }

    def plan(self, user_request: str) -> PrdPlan:
        if not user_request.strip():
            raise ValueError("user request cannot be empty")
        complex_request = len(user_request) > 180 or any(
            hint in user_request.casefold() for hint in self._COMPLEXITY_HINTS
        )
        complexity = "complex" if complex_request else "standard"
        goal = Goal(
            statement=f"为以下产品构想生成可评审的 PRD：{user_request.strip()}",
            constraints=("事实与假设分开", "关键结论关联证据", "输出使用 Markdown"),
            acceptance_criteria=(
                "包含目标用户、问题、范围和成功指标",
                "包含用户流程与技术可行性",
                "通过结构化质量评审",
            ),
        )
        tasks = [
            Task(
                "intake",
                "理解产品构想",
                user_request.strip(),
                required_capabilities=("intake", "requirement_analysis"),
                metadata={"domains": ("product",)},
            ),
            Task(
                "competitors",
                "分析市场与竞品",
                "识别主要竞品、定位、能力差异与市场机会",
                dependencies=("intake",),
                required_capabilities=("competitor_research",),
                metadata={"domains": ("research", "product")},
            ),
            Task(
                "requirements",
                "综合产品需求",
                "根据产品意图和研究结论形成可验证需求",
                dependencies=("intake", "competitors"),
                required_capabilities=("requirement_analysis", "prioritization"),
                metadata={"domains": ("product",)},
            ),
            Task(
                "ux",
                "设计用户流程",
                "给出主流程、异常路径与信息架构",
                dependencies=("requirements",),
                required_capabilities=("user_flow", "information_architecture"),
                metadata={"domains": ("design", "ux")},
            ),
            Task(
                "technical",
                "评估技术方案",
                "给出系统边界、数据模型、接口、风险与交付建议",
                dependencies=("requirements",),
                required_capabilities=("technical_design", "api_design"),
                metadata={"domains": ("engineering", "architecture")},
            ),
            Task(
                "write",
                "撰写 PRD",
                "把全部阶段结果汇总为结构化产品需求文档",
                dependencies=("requirements", "ux", "technical"),
                required_capabilities=("prd_generation", "structured_writing"),
                metadata={"domains": ("product", "writing")},
            ),
            Task(
                "review",
                "评审 PRD",
                "从清晰度、完整性、可行性、一致性和证据覆盖评审文档",
                dependencies=("write",),
                required_capabilities=("quality_review", "consistency_review"),
                metadata={"domains": ("product", "writing")},
            ),
        ]
        if complex_request:
            tasks.insert(
                2,
                Task(
                    "market",
                    "补充行业研究",
                    "分析行业结构、趋势、约束与进入风险",
                    dependencies=("intake",),
                    required_capabilities=("market_research", "evidence_synthesis"),
                    metadata={"domains": ("research",)},
                ),
            )
            requirements = next(task for task in tasks if task.id == "requirements")
            tasks[tasks.index(requirements)] = Task(
                requirements.id,
                requirements.title,
                requirements.objective,
                dependencies=("intake", "competitors", "market"),
                required_capabilities=requirements.required_capabilities,
                metadata=requirements.metadata,
            )
        return PrdPlan(goal=goal, graph=TaskGraph(tuple(tasks)), complexity=complexity)
