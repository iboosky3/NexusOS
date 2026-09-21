# 参与贡献

感谢参与 NexusOS。项目仍处于架构孵化阶段，代码、契约、文档和验证证据必须一起演进。

## 语言约定

- 面向使用者和维护者的说明文档使用中文；
- 源代码中的注释和 Docstring 使用英文；
- Git Commit 信息使用英文，并遵循 Conventional Commits；
- 协议字段、API 名称和不可翻译的技术标识保持英文。

## 变更要求

1. 产品功能、交互或信息架构变更必须关联 `docs/development/requirements-log.md` 中的需求编号；没有对应条目时，先记录原始出发点、目标和验收标准，再开始实现，并在交付时追加实现轨迹。
2. 代码变更需要覆盖成功、失败和关键边界路径。
3. 修改系统边界、数据所有权、执行语义或技术选型时，同步在 `docs/architecture/architecture-evolution.md` 追加日期、修改内容、修改原因、影响与取舍。
4. 开发、集成、部署或实际运行中确认的问题，同步在 `docs/development/problem-log.md` 记录现象、根因、解决方案、验证方式和遗留风险。
5. 不把静态检查写成编译通过，不把合成基准写成生产效果，不把目标架构写成当前能力。
6. 新增跨语言服务时，同时提供版本化契约、降级路径和对应构建验证。

## Commit 规范

推荐格式：

```text
<type>(<scope>): <imperative summary>

Describe what changed and why it was needed. Include relevant behavior,
compatibility, migration, verification, or risk notes when applicable.
```

常用类型包括 `feat`、`fix`、`docs`、`test`、`perf`、`refactor`、`build`、`ci` 和 `chore`。标题使用祈使语气，正文重点说明“为什么”，避免只罗列文件名。

## 提交前验证

至少执行与变更直接相关的测试。若本机缺少某语言或基础设施运行时，需要在问题记录和交付说明中明确未验证部分，并由 CI 或集成环境补齐，不能用推测代替结果。
