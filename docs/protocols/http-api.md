# HTTP API

## 规划模式目标契约

通用 Run 创建接口将把 `planning_mode` 作为显式输入，值为 `ai_dynamic` 或 `controlled_dynamic`。响应和查询投影需要返回 Intent 决策、计划版本、Planner/Prompt/Schema 版本、注册表快照、验证结果及规划 Token；策略强制改变模式时返回结构化原因。AI 提案未通过校验时不得创建可执行任务或产生 Tool 副作用。

完整目标契约尚未冻结到跨进程 v1 Schema；当前 `/v1/prd/runs` 仍执行 PRD 参考受控 Planner。独立实验接口如下，完整设计见 [ADR-0006](../adr/0006-ai-planned-task-graphs.md)。

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| GET | `/v1/planning/configuration` | 模型配置状态与文本执行策略 |
| POST | `/v1/planning/plans` | 请求 `request`、`planning_mode=ai_dynamic`、可选 `maximum_output_tokens`（默认 16000）、`supersedes`；最多两次模型调用，保存意图和冻结或拒绝的计划，不启动执行 |
| GET | `/v1/planning/plans/{id}` | 获取保存的计划、版本、摘要、能力绑定、模型提案、校验问题和规划用量 |
| POST | `/v1/planning/plans/{id}/revision` | `digest` + `proposal`；重新校验用户编辑的节点及 Agent/Skill，201 返回新冻结版本，不继承旧确认 |
| POST / GET | `/v1/planning/plans/{id}/confirmation` | POST 传入 `digest` 持久化确认但不执行；GET 获取确认记录，未确认返回 404 |
| POST | `/v1/planning/plans/{id}/run` | 传入 `digest` 显式执行已确认冻结文本计划；未确认返回 409；202 返回独立执行状态，同一计划重复提交复用执行记录 |
| GET | `/v1/planning/plans/{id}/run` | 节点状态、文本结果、模型调用记录和执行用量 |

计划状态为 `frozen`、`needs_clarification` 或 `rejected`；只有 `frozen` 且摘要、模型和能力目录一致才可执行。非法请求为 422，缺失记录为 404，过期或不可执行计划为 409。规划模型未配置为 503。执行状态为 queued/running/succeeded/failed/interrupted，成功只表示文本节点执行完成，不等于质量评审通过。接口面向单实例个人工作区，与 PRD 使用同一 SQLite 数据库；未接公网身份和租户授权。

`POST /v1/prd/documents/{id}/jobs` 新增可选字段 `planning_mode`，默认且目前仅允许 `controlled_dynamic`。PRD `ai_dynamic` 请求返回 422，不静默切换。

## `POST /v1/prd/runs`

创建一个 PRD 参考运行。第一版在请求周期内完成本地执行，后续切换到分布式 Runtime 时将保持返回字段并增加异步状态查询。

请求：

```json
{
  "request": "面向大学生的 AI 学习笔记产品"
}
```

响应包含 `run_id`、`status`、`review`、`usage`、`tasks` 和 `artifacts`。任务项公开 Agent 与 Skill 的选择结果，方便调试和评估。

成功响应同时作为稳定的运行详情投影写入读模型，并补充：

- `started_at`、`completed_at` 与 `duration_ms`；
- 任务标题、目标、依赖、Agent 与选中 Skill；
- Skill 候选得分和分项原因；
- 各任务上下文预算、实际消耗与裁剪数量；
- 产物媒体类型、字节大小和正文。

## `GET /v1/runs`

返回最新运行摘要，不携带大段产物正文。`limit` 默认 20，必须在 1～100 之间。

## `GET /v1/runs/{run_id}`

返回创建接口保存的完整投影；不存在时返回 404。

当前单机参考实现使用最多保留 100 条的进程内读模型。它只用于开发和 Studio 联调，进程重启会丢失；生产环境必须换成 PostgreSQL 投影，并保留相同响应契约。

## 错误

- `422`：请求体缺少非空 `request` 字段。
- `404`：指定的运行不存在或已超过开发模式保留上限。
- `500`：当前本地执行失败。生产阶段会映射为可查询的失败运行，并提供稳定错误码。
