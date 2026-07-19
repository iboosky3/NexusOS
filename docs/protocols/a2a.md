# A2A 智能体互操作

A2A 用于 NexusOS 与外部 Agent 系统之间的能力发现、任务委派和状态交换，与 MCP 的工具调用职责不同。

```text
MCP：Agent -> Tool / Resource
A2A：Agent System <-> Agent System
```

第一阶段只冻结边界，不实现远程 A2A Server。后续接入必须支持能力卡版本、任务关联 ID、身份与租户传播、超时、取消、状态映射和结果来源审计。
