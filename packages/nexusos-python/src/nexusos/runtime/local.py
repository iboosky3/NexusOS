"""Deterministic offline runtime used by the reference application and tests."""

from __future__ import annotations

from nexusos.context.budget import estimate_tokens
from nexusos.core.models import AgentContext, AgentResult, Artifact, Task, TokenUsage


class LocalAgentRuntime:
    """Produce inspectable reference outputs without calling an external model."""

    async def execute(self, agent_id: str, task: Task, context: AgentContext) -> AgentResult:
        handler = getattr(self, f"_execute_{task.id}", self._execute_generic)
        content = handler(task, context)
        artifacts: tuple[Artifact, ...] = ()
        if task.id == "write":
            artifacts = (Artifact("PRD.md", "text/markdown", content),)
        input_tokens = sum(
            estimate_tokens(value)
            for values in context.sections.values()
            for value in values
        )
        return AgentResult(
            task_id=task.id,
            agent_id=agent_id,
            content=content,
            artifacts=artifacts,
            token_usage=TokenUsage(input_tokens, estimate_tokens(content)),
        )

    @staticmethod
    def _execute_intake(task: Task, context: AgentContext) -> str:
        return (
            "## 产品意图\n\n"
            f"- 产品构想：{task.objective}\n"
            "- 核心目标：用可验证的用户价值解决明确问题\n"
            "- 当前假设：目标用户、使用频率与付费意愿需要后续研究验证\n"
        )

    @staticmethod
    def _execute_competitors(task: Task, context: AgentContext) -> str:
        return (
            "## 竞品与市场\n\n"
            "- 对比维度：定位、目标用户、核心流程、协作能力与商业模式\n"
            "- 差异化机会：把可解释的智能辅助嵌入用户主流程\n"
            "- 证据状态：本地模式未调用搜索工具，所有结论标记为待验证假设\n"
        )

    @staticmethod
    def _execute_market(task: Task, context: AgentContext) -> str:
        return (
            "## 行业研究\n\n"
            "- 行业结构、合规要求与采购链路需要独立验证\n"
            "- 企业场景优先评估身份、租户隔离、审计与数据驻留\n"
        )

    @staticmethod
    def _execute_requirements(task: Task, context: AgentContext) -> str:
        return (
            "## 需求与范围\n\n"
            "### MVP\n\n"
            "1. 完成核心任务的端到端闭环。\n"
            "2. 对关键智能输出提供来源、状态和人工修订入口。\n"
            "3. 记录任务成功率、延迟与成本。\n\n"
            "### 暂不纳入\n\n- 未经验证的自动化扩展与非核心渠道。\n"
        )

    @staticmethod
    def _execute_ux(task: Task, context: AgentContext) -> str:
        return (
            "## 用户流程\n\n"
            "入口 -> 描述目标 -> 系统规划 -> 用户确认关键假设 -> 执行 -> 结果评审 -> 导出\n\n"
            "异常路径包括证据不足、工具失败、预算超限与人工拒绝。\n"
        )

    @staticmethod
    def _execute_technical(task: Task, context: AgentContext) -> str:
        return (
            "## 技术方案\n\n"
            "- API 层接收请求并返回运行标识。\n"
            "- 编排层管理 DAG、状态与能力选择。\n"
            "- Runtime 通过稳定契约执行 Agent。\n"
            "- 外部模型、工具与存储由适配器接入。\n"
        )

    @staticmethod
    def _execute_write(task: Task, context: AgentContext) -> str:
        source_sections = context.sections.get("retrieval", ())
        body = "\n".join(source_sections)
        return (
            "# 产品需求文档\n\n"
            "> 状态：参考运行生成，外部事实仍需人工验证。\n\n"
            f"{body}\n\n"
            "## 成功指标\n\n"
            "- 核心任务完成率\n- 结果采纳率\n- p95 延迟与单任务成本\n\n"
            "## 风险与待确认事项\n\n"
            "- 用户价值、市场规模与付费意愿仍是待验证假设。\n"
            "- 高风险自动化动作必须保留人工确认和审计。\n"
        )

    @staticmethod
    def _execute_review(task: Task, context: AgentContext) -> str:
        return (
            "## 评审结果\n\n"
            "清晰度、完整性、可行性、一致性与证据覆盖均已检查。"
            "参考运行无阻断问题，外部事实验证保留为交付前任务。\n"
        )

    @staticmethod
    def _execute_generic(task: Task, context: AgentContext) -> str:
        return f"## {task.title}\n\n{task.objective}\n"
