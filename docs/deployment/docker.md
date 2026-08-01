# Docker Compose 服务

基础配置包含 Nexus API、PostgreSQL、Redis、Qdrant、MinIO 与 NATS JetStream。OpenTelemetry Collector、Prometheus 与 Grafana 位于 `observability` profile。

| 服务 | 本地端口 | 角色 |
| --- | --- | --- |
| API | 8000 | 参考 HTTP 入口 |
| PostgreSQL | 5432 | 运行、版本与审计元数据 |
| Redis | 6379 | Working Memory、租约与缓存 |
| Qdrant | 6333/6334 | Skill 与知识向量检索 |
| MinIO | 9000/9001 | PRD 等产物对象存储 |
| NATS | 4222/8222 | 任务与领域事件 |
| OTel Collector | 4317/4318 | 遥测接收 |
| Prometheus | 9090 | 指标查询 |
| Grafana | 3000 | 可视化 |

API 镜像使用多阶段构建、非 root 用户、只读根文件系统和临时 `/tmp`。Compose 是单机学习与集成环境，不代表高可用生产拓扑。
