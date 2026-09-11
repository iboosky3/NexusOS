# Go Task Runtime

Go Runtime 是 Python Orchestrator 的可选远程执行服务，负责有界并发、超时、任务尝试和幂等去重。业务 DAG、Agent 选择和 Skill 内容仍由智能平面管理。无论 DAG 来自 `ai_dynamic` 还是 `controlled_dynamic`，Go Runtime 只接收已经校验、授权和冻结的计划任务；它不执行 AI 原始提案，也不允许任务在运行时扩大依赖或权限。

## 运行语义

- 相同幂等键最多调用一次 Handler；并发重复请求等待同一结果。
- `maximum_attempts` 为 0 时按一次执行，避免隐式无限重试。
- 每次尝试有独立超时，外层请求取消后停止重试。
- 结果记录开始时间、完成时间、尝试次数和稳定状态。

首版使用 HTTP/JSON v1，方便调试和契约验证。只有压测显示序列化或连接开销成为瓶颈时才升级 gRPC。
