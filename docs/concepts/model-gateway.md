# Model Gateway

NexusOS 不让 Agent 或工作流直接依赖某个模型 SDK。所有模型调用统一为消息、模型标识、采样参数、最大输出 Token 和审计元数据，并返回内容、实际模型、结束原因和标准化 Token 用量。

## 适配器

- `DeterministicModelGateway`：离线测试，响应稳定且不需要凭据。
- `OpenAICompatibleGateway`：通过标准 HTTP 接入兼容 Chat Completions 的云端或本地模型服务。
- 后续供应商适配器：可以支持不同鉴权、工具调用和流式协议，但必须映射回统一结果。

模型路由、降级与预算策略位于 Gateway 之上，Agent 不能通过提示词绕过允许模型、成本上限或数据分类要求。
