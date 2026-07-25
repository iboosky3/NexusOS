# Trace 与事件

每个 NexusOS Run 对应一个 Trace，Task、Agent、Model、Skill 和 Tool 调用通过 `run_id` 与 `task_id` 关联。核心事件使用稳定名称：

- `nexus.run.started`
- `nexus.task.started`
- `nexus.task.succeeded`
- `nexus.task.failed`
- `nexus.run.succeeded`

本地适配器保存结构化事件和计数器，生产适配器映射到 OpenTelemetry。属性使用 `nexus.*` 命名空间；模型、Token 和工具字段优先映射到可用的 GenAI 语义约定。

遥测默认不记录完整提示词、Skill 指令、工具参数或产物正文。敏感键在适配器层脱敏，长字符串截断。需要内容级调试时必须显式开启受控采样，并遵守租户与数据分类策略。
