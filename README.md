# NexusOS · 纽带

> 面向可扩展自主智能的多智能体编排与 Skill 智能基础设施。

> **纽带系统核心思想：以用户任务为中心，由 AI 分析需求，按需组装已注册的能力与界面组件。只显示当前任务需要的组件，同一功能保留一个主要入口，不重复铺设、不硬占位。** 该原则约束所有现有及后续工具的设计；详见[设计约束与实现边界](docs/development/studio-workbench.md)。

核心演进方向是 **Intent-to-DAG**：面对任意已注册能力能够承接的任务，AI 识别意图并提出非模板化 Task DAG，NexusOS 在执行前完成无环、能力、权限、风险和预算校验，再冻结计划并调度。PRD 默认并长期保留“任务驱动的受控动态流程”。首页输入目标后进入 `/orchestrate`，自动识别意图、检索 Agent/Skill 并编排；用户调整并确认后进入 `/workspace`，使用筛选后的能力与通用软件式工作台执行文本 DAG；外部工具、审批和累计成本硬预算待实现，详见 [ADR-0006](docs/adr/0006-ai-planned-task-graphs.md) 与[实施设计](docs/development/ai-dag-planning.md#当前状态)。

当前版本：**v0.1.0 参考基线**。这是可重复验证的工程参考实现，不代表已经达到生产可用标准。

NexusOS 解决的不是“再做一个聊天机器人”，而是当系统拥有大量 Agent、Skill、模型和外部工具时，如何只选择当前真正需要的能力，在有限 Token 预算内规划、执行、评审并解释完整过程。

首个应用 **Nexus PRD** 已增加持久化写作工作区：输入需求和参考材料，通过真实模型完成需求、体验、技术、写作与独立评审，实时显示阶段输出并可切换思考过程，同时支持手动编辑、反馈修订、版本历史及 Markdown/HTML 导出。当前面向个人使用；真实模型写作质量仍需按实际服务验收。

从[写作工作区使用指南](docs/reference-apps/nexus-prd/authoring.md)开始，也可以导入[NexusOS 自身 PRD 草稿](docs/reference-apps/nexus-prd/product-prd.md)继续完善。原离线参考内核和基准保留用于回归。

首页点击 **编写 PRD** 在新标签页打开 `/prd-studio`，保留软件式菜单、工具栏、左侧管理、中间编辑、右侧 AI 与底部状态栏。通过收拢重复入口和分组折叠降低杂乱；流程图、版本、追溯等按需打开。首页不传入产品想法。旧版 `/prd` 保留并共享文档库。菜单、侧栏和底部面板都是可选组件，未选择时不占空间，详见[工作台组件与扩展说明](docs/development/studio-workbench.md)。

## 当前能力

| 模块 | 当前状态 | 已有证据 |
| --- | --- | --- |
| Python 参考内核 | 可运行 | 受控 PRD Planner、DAG 校验/执行、动态 Agent、Skill 路由、上下文预算、Memory、重规划和端到端测试；另有文本 AI Planner 实验入口 |
| HTTP API | 可运行 | FastAPI Liveness/Readiness、运行创建、列表和详情真实请求测试 |
| Skill Intelligence | 可运行参考实现 | 7 个版本化 Skill、可解释混合排序、路由回归与 10,000 Skill 合成规模工具 |
| Model Gateway | 可运行参考实现 | 统一用量、错误分类、受数据分类约束的有界降级 |
| MCP Gateway | Go 核心实现 | 授权、风险、幂等、超时和审计源码与测试；待外部 CI 编译证据 |
| A2A | 协议内核 | Agent Card、消息/产物、单调生命周期与乱序/重复事件测试 |
| Go Task Runtime | 核心实现 | 并发、超时、重试、幂等和 HTTP 边界源码与测试；待外部 CI 编译证据 |
| Rust Router | 排序内核 | 策略过滤、RRF、稳定排序和预算算法源码与测试；待外部 CI 编译证据 |
| NexusOS Studio | 已接 API | PRD 写作工作区、参考运行详情；当前环境已通过类型检查与生产构建 |
| Compose | 配置完成 | PostgreSQL、Redis、Qdrant、MinIO、NATS 与可选观测栈；当前开发机未实际启动 |
| Kubernetes / Temporal / OIDC | 目标架构 | 尚未达到启用条件，不宣称已经实现 |

完整边界见[项目实现状态](docs/project/status.md)。

## 快速开始

需要 Python 3.12：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev,api,runtime]"
nexus doctor --root .
python -m unittest discover -s tests -v
nexus prd "设计一个面向大学生的 AI 学习平台" --root . --output artifacts
```

Windows PowerShell 激活命令为 `.\.venv\Scripts\Activate.ps1`。在两个终端分别启动 HTTP API 与 Studio：

```bash
bash scripts/start-api.sh
bash scripts/start-studio.sh
```

Studio 默认使用 `http://127.0.0.1:8000` 作为 API 地址并监听所有网络接口的 `3000` 端口。首次启动前需在 `apps/studio` 执行 `npm ci`。本机打开 `http://127.0.0.1:3000/prd-studio`，API 文档位于 `http://127.0.0.1:8000/docs`。完整步骤见[快速开始](docs/getting-started/quick-start.md)。

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
python -m mypy packages/nexusos-python/src/nexusos benchmarks tests
python -m unittest discover -s tests -v
python -m mkdocs build --strict
```

多语言构建由 [CI 矩阵](docs/development/continuous-integration.md)统一验证。参与前请阅读[贡献规范](CONTRIBUTING.md)：说明文档使用中文，代码注释使用英文，Commit 使用详细的英文 Conventional Commits。

## 文档与许可

- [文档首页](docs/index.md)
- [v0.1.0 发布说明](docs/releases/0.1.0.md)
- [变更记录](CHANGELOG.md)
- [总体架构](docs/architecture/overview.md)
- [Nexus PRD 工作流](docs/reference-apps/nexus-prd/workflow.md)
- [运行手册](docs/operations/runbook.md)
- [项目路线图](docs/project/roadmap.md)

文档站规划域名为 [nexusos.net.cn](https://nexusos.net.cn)。项目采用 [Apache License 2.0](LICENSE)。


PRD Studio 支持“需求简报 → PRD”，并可选加入原型设计与确认：使用内置 Puck 插件拖拽设计页面，也可导入原型图或由 AI 生成线框；支持截图并嵌入 PRD、归档设计方案、保存后继续编辑。未确认的原型草稿不会阻止 PRD 生成。需求简报支持上传 Markdown / TXT / Word 模板。插件可在侧边栏管理，详见[插件与原型设计说明](docs/development/studio-extensions.md)。底部运行面板集中展示实时 Flow、节点输出和 trace；对话区保持简洁。详见 [Studio 工作台设计](docs/development/studio-workbench.md)与[写作指南](docs/reference-apps/nexus-prd/authoring.md)。
