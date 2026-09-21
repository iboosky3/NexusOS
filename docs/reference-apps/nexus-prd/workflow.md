# Nexus PRD 工作流

本文记录原参考内核工作流。实际编写文档请使用[PRD 写作工作区](authoring.md)，它接入真实模型并支持保存、版本和修订。

Nexus PRD 是验证 NexusOS 通用能力的参考应用。输入产品构想后，系统执行产品意图理解、竞品与市场研究、需求综合、用户流程、技术评估、文档撰写和结构化评审。

PRD 默认采用并永久保留 `controlled_dynamic`（任务驱动的受控动态流程）：领域阶段库固定关键质量门，系统依据 action、需求复杂度、原型状态和已有产物选择实际节点、并行关系、Agent 与 Skill。通用 `ai_dynamic` 上线后，PRD 可以提供显式实验选择，但不得删除受控模式、静默迁移旧文档或允许模型绕过独立评审。规划模式和阶段库版本必须进入任务输入与 Trace。

参考应用只组合核心契约，不把 PRD 特有章节或角色写入 NexusOS 领域内核。未来的 Nexus Dev、Nexus Research 和 Nexus Data 可以使用自己的 Planner 与 Agent Manifest 复用同一运行底座。

评审分数低于 85 或出现阻断问题时，运行进入 Replanner；修订任务必须指向具体失败维度，不能只用一句自由文本要求“继续优化”。

NexusOS 通用 Intent-to-DAG 与 PRD 受控模式的共同校验和执行边界见 [ADR-0006](../../adr/0006-ai-planned-task-graphs.md)；当前通用 AI Planner 尚未交付，不能把现有关键词识别或 PRD 条件分支标成 AI 自主规划。
