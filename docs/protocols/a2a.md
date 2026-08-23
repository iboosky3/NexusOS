# A2A 智能体互操作

A2A 用于 NexusOS 与外部 Agent 系统之间的能力发现、任务委派和状态交换，与 MCP 的工具调用职责不同。

```text
MCP：Agent -> Tool / Resource
A2A：Agent System <-> Agent System
```

当前实现提供协议无关的本地规范内核，负责：

- 校验外部 Agent Card 的名称、HTTPS 地址、协议版本和唯一能力；
- 使用 `task_id`、`context_id`、`tenant_id` 和 `correlation_id` 关联外部委派；
- 保存用户与 Agent 消息以及带媒体类型的产物；
- 强制单调状态迁移，并把重复状态事件作为幂等事件处理；
- 阻止终态回退、非完成态携带产物和无错误码的失败状态。

## 生命周期

```text
submitted -> working -> input_required -> working -> completed
    |           |             |             |
    +---------> auth_required +-----------> failed / canceled
    +---------> rejected
```

`completed`、`failed`、`canceled` 和 `rejected` 是终态。终态之后收到的旧事件必须拒绝，不能让已完成的 Nexus Task 回退为运行中。

## 安全与所有权

- 外部非回环 Agent Card 必须使用 HTTPS；
- 租户和主体来自可信调用上下文，不能接受模型生成值；
- A2A Task ID 不能替代 MCP 幂等键；
- 外部状态先进入 A2A Gateway，再映射为 Nexus Task 状态；
- 每次委派、消息、授权、取消和终态都需要保留关联 ID 和审计事件。

当前尚未实现远程 HTTP Client/Server、流式推送和 Agent Card 信任缓存。它们必须复用 `contracts/a2a/v1/task.schema.json` 的规范投影，并在连接真实外部 Agent 后增加乱序、断线重连与取消竞态测试。
