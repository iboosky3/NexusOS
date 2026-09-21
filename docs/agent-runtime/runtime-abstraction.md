# Agent Runtime 抽象

`AgentRuntime` 只接收 Agent 标识、Task 与已经预算化的 `AgentContext`，返回统一 `AgentResult`。Planner、Router 和 API 不感知底层框架。

无论 Task 来自 AI 自主规划还是领域受控 Planner，Runtime 都只执行已经由服务端校验并冻结的 `PlanVersion`。Runtime 不解释自然语言意图、不接受原始 `PlanProposal`，也不能自行增加节点、依赖、Skill 或 Tool 权限。动态 Replan 必须先生成并验证新计划版本，再由 Orchestrator 调度；这保证“AI 可以自由提出图结构”不等于“模型可以自由执行动作”。

当前实现：

- Local Runtime：确定性离线实现，用于单元测试、集成测试和演示。
- LangGraph Runtime：默认智能体图适配器，通过 Model Gateway 调用模型。
- 后续对照 Runtime：Microsoft Agent Framework 与 OpenAI Agents SDK，可用于协作策略基准。

框架适配器不能把自己的状态类型写入 `NexusState`，必须在边界完成转换。
