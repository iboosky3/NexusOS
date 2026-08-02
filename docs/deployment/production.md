# 生产部署目标

生产阶段使用 Kubernetes 与 Helm，将 API、Orchestrator Worker、Go Runtime、Rust Router、MCP Gateway 和 Studio 独立部署。Temporal 管理跨服务长期工作流，NATS 用于轻量任务与事件；需要长保留和大规模回放时才引入 Kafka。

## 强制能力

- OIDC 身份、租户上下文和服务间工作负载身份。
- Policy-as-Code 与高风险人工审批。
- PostgreSQL Row Level Security、传输加密和静态加密。
- NetworkPolicy、只读文件系统、非 root 与最小 Linux capabilities。
- HPA、PodDisruptionBudget、反亲和与优雅终止。
- 备份、恢复演练、Schema 向前兼容和灾难恢复目标。
- OTel Trace、Prometheus 指标、结构化日志与成本告警。

生产目标不在当前单机里程碑内。Kubernetes 资源只有在远程服务通过契约、负载和故障测试后才标记可用。
