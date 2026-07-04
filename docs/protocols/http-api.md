# HTTP API

## `POST /v1/prd/runs`

创建一个 PRD 参考运行。第一版在请求周期内完成本地执行，后续切换到分布式 Runtime 时将保持返回字段并增加异步状态查询。

请求：

```json
{
  "request": "面向大学生的 AI 学习笔记产品"
}
```

响应包含 `run_id`、`status`、`review`、`usage`、`tasks` 和 `artifacts`。任务项公开 Agent 与 Skill 的选择结果，方便调试和评估。

## 错误

- `422`：请求体缺少非空 `request` 字段。
- `500`：当前本地执行失败。生产阶段会映射为可查询的失败运行，并提供稳定错误码。
