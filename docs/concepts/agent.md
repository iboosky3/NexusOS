# Agent 模型与动态发现

## 1. Agent 的边界

Agent 是角色、目标、状态和执行策略的组合。它不永久携带全部 Skill，也不直接获得任意 Tool 权限。每次任务由 Agent Resolver 根据能力与领域动态选择 Agent，再由 Skill Router 在该 Agent 的策略范围内选择能力。

## 2. 声明式注册

Agent 通过 `agent.yaml` 注册，记录版本、角色、能力、允许的 Skill 领域、单任务最大 Skill 数和工具白名单。业务工作流引用能力而不是写死 Agent 名称。

```text
Task.required_capabilities -> Agent Resolver -> AgentDescriptor
                                           -> Skill Policy
                                           -> Tool Policy
```

## 3. 动态团队

简单任务可以只选择三类 Agent，复杂任务可以扩展为更多研究、设计与技术角色。团队规模由任务图决定，而不是由固定链条决定。
