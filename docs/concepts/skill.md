# Skill 模型与渐进加载

## 1. 定义

Skill 是可复用的认知能力，包含可检索元数据、执行指令、输入输出 Schema、示例、参考资料与工具要求。Skill 不是 Agent：Agent 持有角色、目标和状态，Skill 只描述如何完成一类能力。

## 2. 两阶段读取

发现阶段只读取 `skill.yaml` 中的名称、说明、领域、能力、关键词、成本、风险和历史质量。路由确定候选后，执行阶段才读取 `instructions.md`、示例和参考资料。

```text
仓库扫描 -> SkillSummary -> 检索与排序 -> 选中 Skill
                                      -> SkillPackage -> 执行上下文
```

这条边界可以避免成千上万个 Skill 的正文进入同一次模型上下文。

## 3. 包结构

```text
skill-name/
├── skill.yaml
├── instructions.md
├── examples/
└── references/
```

Manifest 使用 `apiVersion: nexusos/v1` 与 `kind: Skill`。同一注册表内的 Skill 名称必须唯一，版本采用语义化版本。

## 4. 质量约束

- 指令不得为空。
- 元数据列表必须包含字符串。
- 估算 Token 与延迟不能为负数。
- 历史成功率必须位于 0 到 1 之间。
- 外部工具依赖必须显式声明，不能由提示词隐式授权。
