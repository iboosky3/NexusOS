# Nexus Task Runtime（Go）

该服务承担有界并发、任务超时、尝试重试和幂等去重。它只拥有执行租约与尝试结果，不拥有业务目标、任务 DAG 或 Agent 推理状态。

## 接口

- `GET /healthz`
- `POST /v1/tasks:execute`

请求必须包含任务 ID、运行 ID 和幂等键。相同幂等键只执行一次，并向并发调用者返回同一结果。

## 本地验证

```bash
go test ./...
go run ./cmd/server
```
