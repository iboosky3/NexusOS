# 持续集成

NexusOS 是多语言 Monorepo。开发机可以只安装当前模块需要的工具链，但主分支必须通过统一 Linux CI 验证，避免把“本地缺少命令”与“代码不能构建”混为一谈。

## 验证矩阵

| Job | 工具链 | 核心证据 |
| --- | --- | --- |
| Python reference kernel | Python 3.12 | 仓库契约、格式、Lint、Mypy、单元/集成测试、字节码编译 |
| Go task runtime | Go 1.24 | `gofmt`、Race Detector、全部测试 |
| Go MCP gateway | Go 1.24 | `gofmt`、Race Detector、全部测试 |
| Rust routing kernel | Stable Rust | `rustfmt`、Clippy 零警告、全部测试 |
| TypeScript Studio | Node.js 22 | 严格类型检查、生产构建 |
| Documentation and Compose | Python 3.12 / Docker | MkDocs 严格构建、Compose 展开 |

## 仓库级验证器

`python scripts/validate_repository.py` 不依赖数据库、消息系统或远程模型，可以在提交前快速检查：

- JSON Schema 能否解析且 `$id` 唯一；
- 所有 YAML 能否解析；
- Agent 与 Skill ID 是否唯一，Skill 指令文件是否存在；
- MkDocs 导航目标是否存在；
- 架构演进日期和版本是否有序且唯一；
- 问题索引与问题正文是否一一对应。

Python Job 还会对核心包、基准和测试共同执行 Mypy。基准输出使用显式 `TypedDict`，避免测试和报告消费者在 `dict[str, object]` 上进行未经证明的索引；第三方 YAML 类型由 `types-PyYAML` 开发依赖提供。

## 证据边界

工作流文件合入不等于远程 Job 已经成功。首次 GitHub Actions 运行完成前，多语言和容器问题仍保持“已缓解”；只有日志可追踪且所有 Job 通过后，才能把对应问题改为“已解决”。
