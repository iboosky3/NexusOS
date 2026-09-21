# NexusOS · 纽带

NexusOS 是一个面向复杂任务的多智能体协作基础设施。“纽带”代表系统对 Agent、Skill、Tool、Memory、Knowledge 与人的连接。

它关注的核心问题不是“如何再写一个聊天机器人”，而是当能力规模持续增长时，系统如何发现少量相关能力、组织合适的 Agent 团队，并在可观测、可评估的约束下可靠交付结果。

核心产品方向是 **Intent-to-DAG**：AI 识别任意已支持任务的意图并提出非模板化任务图，NexusOS 校验能力、依赖、权限、风险和预算后才执行。PRD 等领域应用继续保留“任务驱动的受控动态流程”。当前首页目标输入已接入意图识别与能力编排页，确认后进入仅展示选中能力的通用工作台，PRD 内 AI 模式尚未开放；外部工具、审批和完整预算仍待实现，边界见[实施设计当前状态](development/ai-dag-planning.md#当前状态)与 [ADR-0006](adr/0006-ai-planned-task-graphs.md)。

当前发布版本为 **v0.1.0 参考基线**。详细能力、验证证据和限制见[v0.1.0 发布说明](releases/0.1.0.md)。

## 当前验证场景

首个参考应用是 PRD 生成：输入一个产品想法，系统完成需求理解、调研、功能拆解、体验设计、技术评估、评审和文档汇总。

## 文档原则

可组合工作区的新设计见 [Agent 插件工作台架构方案](architecture/agent-plugin-workbench.md)与[实施说明](development/agent-plugin-workbench-implementation.md)：以“以后增加插件，应主要写插件自己的代码”为原则，覆盖注册、生命周期、Agent、独立资源与版本化交接。当前为设计基线，不代表目标能力已经实现。

架构文档与代码同仓维护。产品功能和交互变更先在[需求与产品出发点日志](development/requirements-log.md)中保留原始动机、范围和验收标准；任何影响系统边界、核心抽象或技术职责的调整，还必须在[架构方案与演进](architecture/architecture-evolution.md)中记录日期、内容、原因和影响。

查看[项目实现状态](project/status.md)可以逐项确认本地验证、外部 CI 和生产可用之间的边界；实际开发、部署和使用问题统一保留在[问题与解决记录](development/problem-log.md)。
