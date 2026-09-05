# Nexus CLI

Nexus CLI 用于在没有 HTTP 服务的情况下运行参考工作流。安装项目后执行：

```bash
nexus doctor --root .
nexus prd "面向大学生的 AI 学习笔记产品" --root . --output artifacts
```

每次运行创建独立目录，写入 `PRD.md` 和可机读的 `run.json`。使用 `--json` 可同时把完整运行摘要输出到标准输出。

当前 Agent 和 Skill 清单保存在仓库而不是 Python Wheel 中，因此从其他工作目录运行时必须用 `--root` 指向 NexusOS 仓库。`doctor` 会在真正执行工作流前报告错误根目录、无效生产配置以及可选 API、Runtime、Studio 和 Compose 工具链状态。
