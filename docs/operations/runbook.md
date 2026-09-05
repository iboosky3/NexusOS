# 运行手册

本文用于本地 VM 和未来预发布环境的日常排查。当前参考部署仍是单机 Compose，不代表已经满足生产可用性目标。

## 1. 先判断影响面

1. 确认是单次 Run、单个 Agent/Skill，还是所有请求失败；
2. 记录 `run_id`、首次发生时间、环境和最近变更；
3. 检查 `/livez` 与 `/readyz`，不要只看进程是否存在；
4. 保留错误码、结构化事件和相关指标，禁止把提示词、密钥或完整工具参数复制到工单。

## 2. 健康端点

| 端点 | 含义 | 失败时动作 |
| --- | --- | --- |
| `/livez` | Python 进程和 HTTP 事件循环仍能响应 | 重启实例并检查崩溃、死锁或资源耗尽 |
| `/readyz` | 所有关键依赖检查通过，可以接收新流量 | 从负载均衡摘除，但保留进程供排查 |
| `/healthz` | 兼容旧配置的 Liveness 别名，已弃用 | 迁移到上面两个端点 |

可选依赖失败时 Readiness 返回 `degraded` 但仍为 200；关键依赖失败时返回 `not_ready` 和 503。每项检查有独立超时，外部响应只显示异常类型，不返回可能含密钥的异常正文。

## 3. 常见排查路径

### Run 长时间没有完成

- 在 Studio 运行详情确认卡住的 Task 和 Agent；
- 按 `run_id`、`task_id` 查询 `nexus.task.started` 后是否存在成功或失败事件；
- 检查模型超时、MCP 工具超时、A2A `input_required` 和策略 `require_approval`；
- 达到 Reflection 最大轮次的 Run 应为 `blocked`，不能继续自动重试。

### Skill 选择异常

- 查看路由候选的分项得分和策略过滤结果；
- 确认 Agent 允许领域、Tool 白名单与 Token 预算；
- 使用版本化路由数据集复现，不要直接在生产目录调权重；
- 新权重需要同时比较 Recall@K、MRR、NDCG、延迟和指令 Token。

### 模型不可用或限流

- 区分超时、429/5xx 与鉴权/请求错误；
- 瞬时错误允许按策略切换目标，永久错误必须停止；
- 检查请求数据分类是否允许进入备用目标；
- 对超时后的备用调用核对供应商请求 ID，防止双份计费未被发现。

### Memory 结果不正确

- 确认可信租户上下文是否传入；
- 检查分类、过期时间、来源 Run 和相关度；
- 发现污染内容时先禁用对应 Memory ID，不要清空整个租户；
- 跨租户命中按安全事件处理，立即停止相关读路径并保留审计证据。

## 4. Compose 检查

```bash
docker compose ps
docker compose logs --since 15m api postgres redis qdrant nats
docker compose config --quiet
curl -i http://localhost:8000/livez
curl -i http://localhost:8000/readyz
```

示例凭据只能用于本地环境。恢复前先确认 `.env` 没有使用生产数据库或对象存储地址，避免排查命令作用于错误环境。

## 5. 升级与回滚

- 升级前备份 PostgreSQL 和对象存储，并保存当前镜像摘要；
- 数据迁移必须向前兼容至少一个应用版本；
- 先验证 Readiness、创建一条最小 PRD Run，再逐步恢复流量；
- 回滚应用不能回滚已经被新版本写入且不兼容的数据 Schema；
- 每次恢复完成后，把实际问题、根因、修复与验证追加到《问题与解决记录》。
