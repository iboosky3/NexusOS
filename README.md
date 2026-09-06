# NexusOS · 纽带

> 面向可扩展自主智能的多智能体编排与 Skill 智能基础设施。

NexusOS 解决的不是“再做一个聊天机器人”，而是当系统拥有大量 Agent、Skill、模型和外部工具时，如何只选择当前真正需要的能力，在有限 Token 预算内规划、执行、评审并解释完整过程。

首个参考应用 **Nexus PRD** 可以把产品构想分解为需求理解、市场/竞品研究、体验设计、技术评估、PRD 写作和结构化评审任务，用它验证 NexusOS 的通用编排能力。

## 当前能力

| 模块 | 当前状态 | 已有证据 |
| --- | --- | --- |
| Python 参考内核 | 可运行 | Planner、DAG、动态 Agent、Skill 路由、上下文预算、Memory、重规划和 PRD 端到端测试 |
| HTTP API | 可运行 | FastAPI Liveness/Readiness、运行创建、列表和详情真实请求测试 |
| Skill Intelligence | 可运行参考实现 | 7 个版本化 Skill、可解释混合排序、路由回归与 10,000 Skill 合成规模工具 |
| Model Gateway | 可运行参考实现 | 统一用量、错误分类、受数据分类约束的有界降级 |
| MCP Gateway | Go 核心实现 | 授权、风险、幂等、超时和审计源码与测试；待外部 CI 编译证据 |
| A2A | 协议内核 | Agent Card、消息/产物、单调生命周期与乱序/重复事件测试 |
| Go Task Runtime | 核心实现 | 并发、超时、重试、幂等和 HTTP 边界源码与测试；待外部 CI 编译证据 |
| Rust Router | 排序内核 | 策略过滤、RRF、稳定排序和预算算法源码与测试；待外部 CI 编译证据 |
| NexusOS Studio | 已接 API | TypeScript/Next.js 总览与运行详情；当前开发机缺少 Node.js，待 CI 生产构建 |
| Compose | 配置完成 | PostgreSQL、Redis、Qdrant、MinIO、NATS 与可选观测栈；当前开发机未实际启动 |
| Kubernetes / Temporal / OIDC | 目标架构 | 尚未达到启用条件，不宣称已经实现 |

完整边界见[项目实现状态](docs/project/status.md)。

## 快速开始

需要 Python 3.12：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,api]"
nexus doctor --root .
python -m unittest discover -s tests -v
nexus prd "设计一个面向大学生的 AI 学习平台" --root . --output artifacts
```

Windows PowerShell 激活命令为 `.\.venv\Scripts\Activate.ps1`。启动 HTTP API：

```bash
python -m uvicorn nexusos.api:create_app --factory --host 0.0.0.0 --port 8000
```

打开 `http://localhost:8000/docs`，或检查 `http://localhost:8000/readyz`。完整步骤见[快速开始](docs/getting-started/quick-start.md)。

## 架构主线

```text
Client / Studio
       |
   Nexus API
       |
Planner -> Orchestrator -> Agent Runtime
                 |             |
          Skill Router     Model Gateway
                 |             |
              Memory       MCP / A2A
```

- Python 保留智能平面和规范实现；
- Go 承担高并发 Task Runtime 与 MCP Gateway；
- Rust 承担大候选集低延迟排序；
- TypeScript 构建可观察、可评估的 Studio；
- LangGraph 管理单 Agent 推理图；Temporal 只在长流程、跨服务恢复需求成立后启用。

架构不是一次写死的结论。所有方案修改按时间保留在[架构方案与演进](docs/architecture/architecture-evolution.md)，实际开发、部署和使用问题保留在[问题与解决记录](docs/development/problem-log.md)。

## 仓库结构

```text
agents/                     Agent Manifest
apps/api/                   HTTP 入口说明
apps/cli/                   本地 CLI
apps/studio/                Next.js 控制台
benchmarks/                 路由、规模与 PRD 评估
contracts/                  Runtime、Router、MCP、A2A JSON Schema
deploy/                     Compose、镜像与数据库迁移
docs/                       中文架构、协议、运维和开发记录
packages/nexusos-python/    Python 参考内核
services/runtime-go/        Go Task Runtime
services/mcp-gateway-go/    Go MCP Gateway
services/router-rs/         Rust Skill Router
skills/                     版本化渐进加载 Skill
tests/                      单元、集成与架构测试
```

## 开发与验证

```bash
python scripts/validate_repository.py
python -m ruff format --check .
python -m ruff check .
python -m unittest discover -s tests -v
```

多语言构建由 [CI 矩阵](docs/development/continuous-integration.md)统一验证。参与前请阅读[贡献规范](CONTRIBUTING.md)：说明文档使用中文，代码注释使用英文，Commit 使用详细的英文 Conventional Commits。

## 文档与许可

- [文档首页](docs/index.md)
- [总体架构](docs/architecture/overview.md)
- [Nexus PRD 工作流](docs/reference-apps/nexus-prd/workflow.md)
- [运行手册](docs/operations/runbook.md)
- [项目路线图](docs/project/roadmap.md)

文档站规划域名为 [nexusos.net.cn](https://nexusos.net.cn)。项目采用 [Apache License 2.0](LICENSE)。
