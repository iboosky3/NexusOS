# Nexus CLI

Nexus CLI 用于在没有 HTTP 服务的情况下运行参考工作流。安装项目后执行：

```bash
nexus prd "面向大学生的 AI 学习笔记产品" --output artifacts
```

每次运行创建独立目录，写入 `PRD.md` 和可机读的 `run.json`。使用 `--json` 可同时把完整运行摘要输出到标准输出。
