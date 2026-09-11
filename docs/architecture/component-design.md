# 组件设计

> **首要设计原则：由 AI 分析用户任务，按需组装已注册能力与界面组件。只显示当前任务所需组件，功能入口不重复，不为无关功能占位。** 所有组件设计与接入遵循[架构总览中的核心思想](overview.md)和[工作台设计验收约束](../development/studio-workbench.md)。

## 1. Nexus Core

核心包定义 Goal、Task、TaskGraph、AgentContext、AgentResult、ReviewResult、Artifact、Evidence 与 TokenUsage。核心不引用 HTTP、数据库、模型或 Agent 框架类型。

TaskGraph 在构造时验证唯一 ID、依赖存在和无环，并提供稳定拓扑层，为不同 Runtime 提供相同调度语义。

## 2. Orchestrator

- Intent Service：识别目标领域、缺失信息和候选工作台；置信度不足时先澄清。
- Planning Mode Selector：在 `ai_dynamic` 与 `controlled_dynamic` 之间应用用户选择和策略强制结果。
- AI Planner：基于能力摘要提出非模板化 `PlanProposal`，不直接执行任务。
- Controlled Planner：从领域阶段库按 action、复杂度和现有产物选择能力导向的 Task DAG；PRD 默认并保留此模式。
- Plan Validator：验证 Schema、无环、能力覆盖、权限、风险、预算和完成条件，成功后冻结 `PlanVersion`。
- Agent Resolver：从 Registry 选择覆盖能力与领域的 Agent。
- Skill Router：在 Agent 策略、风险、工具和预算约束下选择 Skill。
- Context Builder：组合任务、依赖结果、Skill、Memory 和证据。
- Replanner：根据结构化评审生成修订任务，当前只完成契约规划。

Orchestrator 拥有业务运行状态和计划版本，不负责远程执行租约或工具连接池。Runtime 只接收已经校验并冻结的 DAG；模型不能借规划或重规划绕过能力与 Tool Policy。完整边界见 [ADR-0006](../adr/0006-ai-planned-task-graphs.md)。

## 3. Agent Runtime

Local Runtime 用确定性输出验证端到端链路；LangGraph Runtime 管理单个 Agent 推理图并通过 Model Gateway 调用模型；Go Runtime 管理远程任务并发、超时、尝试和幂等。

Runtime 不能自行扩大 Agent 的 Skill 或 Tool 权限，也不能把框架 Checkpoint 当作业务 Run 的唯一记录。

## 4. Skill Intelligence

Registry 扫描 Manifest 形成 `SkillSummary`，Router 只使用轻量元数据。命中后 Loader 读取 `SkillPackage` 的指令、Schema、示例和引用。Python 提供规范实现，Rust 处理高吞吐排序热点。

召回、排序和选择是三个不同阶段：Qdrant 适配器负责稠密/稀疏召回，RRF 与 Reranker 融合候选，Policy 与 Token Budget 决定最终可执行集合。

## 5. Model Gateway

统一模型请求、响应、Token 和结束原因。上层模型路由负责供应商允许列表、数据分类、价格预算与 fallback；适配器处理鉴权、HTTP、流式和厂商错误。

## 6. Memory 与 Knowledge

Working Memory 保存当前 Run 状态，Episodic Memory 保存历史运行经验，Semantic Memory 提供知识检索。检索返回的是 Context 候选，不是授权结果，仍需租户过滤、相关度排序和 Token 预算。

## 7. MCP 与 A2A

MCP Gateway 管理 Tool/Resource，A2A Gateway 管理外部 Agent 任务。两者共享 Principal、Policy、Audit 与 Trace 设施，但保持消息、幂等和生命周期独立。

## 8. Evaluation 与 Observability

Evaluation 使用版本化 Dataset 与 Rubric 判断能力质量；Observability 记录发生了什么。两者分离，避免“调用没有报错”被误计为任务成功。

## 9. 依赖方向

```text
Transport / Framework / Storage Adapters
                  ↓
Application Services and Policies
                  ↓
Domain Models and Ports
```

反向依赖通过端口注入。架构测试用于阻止供应商 SDK 进入 Core。


### PRD 原型与可视化运行

PRD 的必需组合为需求简报、原型设计、正文编辑及 AI 对话；运行面板随任务按需出现。原型复用声明式画布，导入图片与 AI 生成页面共用确认和截图管线。Flow 组件仅消费计划与真实状态，业务面板负责订阅 SSE、增量 trace、节点详情和恢复动作。不得用模拟计时推动节点，也不在对话区重复放编辑对象与运行输出。具体契约见 [Studio 工作台](../development/studio-workbench.md)。
