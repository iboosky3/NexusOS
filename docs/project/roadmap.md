# 项目路线图

路线图使用“证据门”而不是只按日期推进。后续阶段只有在前一阶段留下可重复结果后才启用更复杂的基础设施。

运行可靠性专题按[关键运行问题台账](../development/critical-runtime-backlog.md)逐项实施，覆盖长任务、记忆、恢复、重试、追溯、并发、异步、限流、任务池、调度和优先级。当前优先项 RT-001 已实现个人 PRD 工作区的全程追溯；其余以台账验收条件为准。

## M0 · 参考内核（已完成）

- Contract-first 核心模型与端口；
- Agent/Skill 文件 Registry；
- PRD Planner、DAG、Local Runtime 和结构化质量门；
- CLI、基础 API、中文文档和测试骨架。

## M1 · Skill Intelligence（已完成参考实现）

- 元数据与正文渐进加载；
- 策略过滤、混合排序与 Token 预算；
- 路由基准、解释结果与合成规模测试；
- Rust 排序内核源码。

## M2 · 可恢复运行与互操作（进行中）

- Go Runtime 并发、超时、重试和幂等；
- LangGraph 适配边界；
- MCP Gateway 核心策略；
- A2A 生命周期；
- 运行投影、Studio 与统一遥测。

完成门：首次多语言 CI 全绿、Python 到 Go 远程任务契约测试、真实 MCP/A2A 互操作、进程重启后的 Run 恢复。

## M3 · 单机 VM 集成（待验证）

- 启动 PostgreSQL、Redis、Qdrant、MinIO、NATS 与观测栈；
- 持久化 Run、Task、Memory、审计和幂等记录；
- 实际执行 RLS 隔离、备份恢复与服务故障演练；
- Studio 使用真实投影并加入审批入口。

完成门：可重复的一键部署与 Smoke Test、24 小时稳定运行、备份恢复演练、问题记录无未处理高风险项。

## M4 · 生产候选（未开始）

- OIDC、工作负载身份和 Policy-as-Code；
- Kubernetes、HPA、PDB、NetworkPolicy 和密钥管理；
- 供应商模型与工具的限流、成本和审计；
- SLO、告警、容量模型、升级和回滚演练。

只有出现跨服务小时级流程、人工长时间暂停或需要持久定时器时才引入 Temporal。只有 NATS 的吞吐、保留或消费模型经测量不足时才引入 Kafka。
