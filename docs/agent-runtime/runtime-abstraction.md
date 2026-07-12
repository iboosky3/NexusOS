# Agent Runtime 抽象

`AgentRuntime` 只接收 Agent 标识、Task 与已经预算化的 `AgentContext`，返回统一 `AgentResult`。Planner、Router 和 API 不感知底层框架。

当前实现：

- Local Runtime：确定性离线实现，用于单元测试、集成测试和演示。
- LangGraph Runtime：默认智能体图适配器，通过 Model Gateway 调用模型。
- 后续对照 Runtime：Microsoft Agent Framework 与 OpenAI Agents SDK，可用于协作策略基准。

框架适配器不能把自己的状态类型写入 `NexusState`，必须在边界完成转换。
