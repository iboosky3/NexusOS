# MCP 工具协议

MCP 负责 Agent 与 Tool/Resource 之间的能力发现和调用。NexusOS 在标准协议外增加平台级安全边界：租户与主体身份、Agent 工具白名单、风险级别、参数校验、超时、幂等与审计。

```text
Agent 请求 -> 身份上下文 -> Tool 白名单 -> 风险策略
          -> Schema 校验 -> MCP 调用 -> 审计事件
```

Gateway 按无状态请求设计，连接与会话细节不能成为授权依据。生产环境中的幂等缓存和限流状态放入共享存储，以支持水平扩展。

模型输出只是一组候选参数。真正的执行授权必须由 Gateway 基于服务端 Principal 与 Policy 独立判断。
