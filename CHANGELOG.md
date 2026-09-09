# 变更记录

本文记录 NexusOS 面向使用者的版本变化，格式参考 Keep a Changelog，版本号遵循语义化版本。架构方案为什么变化见[架构方案与演进](docs/architecture/architecture-evolution.md)，实际问题的定位和解决过程见[问题与解决记录](docs/development/problem-log.md)。

## [0.1.0] - 2026-09-09

首个可重复验证的参考基线。该版本用于固定核心概念和跨语言契约，不表示系统已达到生产可用标准。

### 新增

- Contract-first 的 Goal、Task、TaskGraph 与 NexusState 核心模型；
- Planner、DAG Orchestrator、结构化 Replanner、质量门与 Nexus PRD 参考工作流；
- 版本化 Agent/Skill 清单、三级渐进加载、混合路由、Token 预算和可解释排序；
- 受租户、数据分类和有效期约束的 Memory，以及按错误类型和数据边界执行的模型降级；
- FastAPI 运行创建/查询接口、独立 Liveness/Readiness 和可执行 `nexus doctor` 诊断；
- Go Task Runtime、Go MCP Gateway、Rust Router 和 Next.js Studio 的核心源码；
- A2A 单调任务生命周期、稳定运行读模型和四类版本化 v1 JSON Schema；
- PostgreSQL RLS 迁移、Compose 拓扑、OpenTelemetry/Prometheus 配置和中文运维文档；
- 跨语言 CI 矩阵、仓库契约验证器、路由/规模/PRD 基准与 73 项 Python 测试。

### 修复

- 修复最小 Skill 清单、测试零收集、上下文硬分区和无界 Reflection 等实际开发问题；
- 防止远程任务重试重复副作用、A2A 乱序状态回退、跨租户 Memory 召回和不合规模型降级；
- 让 Studio 的样例回退始终可见，并让 CLI 在 Windows 上稳定输出 UTF-8 中文诊断；
- 补齐 API TestClient 传输依赖、Mypy 质量门和标准 Apache License 2.0 正文。

### 验证与限制

- Python 源码内容格式/Lint、类型检查、测试、真实 FastAPI 请求、严格文档构建和 Wheel 打包已在本地验证；Ruff 直接读取新文件仍受当前宿主机文件 I/O 环境影响，详见 NX-023；
- Go、Rust、TypeScript 和 Compose 因当前开发机缺少相应工具链，仍等待外部 CI 或目标环境验证；
- 未完成真实模型供应商、PostgreSQL 连接池、远程 MCP/A2A、持久恢复、OIDC 和 Kubernetes 集成，因此不得标记为生产可用。
