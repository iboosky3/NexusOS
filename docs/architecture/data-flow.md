# 核心数据流

## 1. PRD 运行

```mermaid
sequenceDiagram
    participant U as 用户
    participant A as API
    participant O as Orchestrator
    participant R as Agent Resolver
    participant S as Skill Router
    participant C as Context Builder
    participant X as Agent Runtime
    participant E as Evaluator
    U->>A: 产品构想
    A->>O: Principal + Request
    O->>O: Goal + Task DAG
    loop 每个拓扑层
        O->>R: Task capabilities
        R-->>O: Agent + Policy
        O->>S: Summary candidates + Budget
        S-->>O: Ranked skills + Reasons
        O->>C: Task + Skills + Memory + Evidence
        C-->>O: Budgeted AgentContext
        O->>X: Execute
        X-->>O: AgentResult
    end
    O->>E: PRD + Evidence
    E-->>O: ReviewResult
    O-->>A: Run + Artifact
    A-->>U: 状态、选择、用量与 PRD
```

## 2. Skill 路由

```text
Task -> Domain Hints -> Metadata Filter
     -> Dense Results + Sparse Results -> RRF
     -> Reranker -> Policy Filter -> Cost/Latency Score
     -> Token Budget -> 1~5 SkillSummary -> Load SkillPackage
```

未选中的 Skill 正文不读取。策略拒绝发生在最终执行上下文构建之前，拒绝原因进入路由记录。

## 3. Tool 调用

```text
AgentResult / Model Tool Call
 -> server-side Principal
 -> Agent Tool Policy
 -> Risk and Schema Validation
 -> Idempotency Reservation
 -> MCP Invocation
 -> Audit + Trace + Result
```

网络重试复用原幂等键。高风险动作需要 Human-in-the-loop 时，Gateway 返回等待审批状态，而不是自行降级授权。

## 4. 评审与重规划

```text
PRD -> Deterministic Rules -> Dimension Scores
    -> Blocking Issues + Revision Tasks
    -> pass: Artifact Delivery
    -> revise: Replanner -> Incremented Iteration -> Affected Tasks
```

当前参考运行完成确定性质量门。完整 Replanner 将复用未受影响结果，并限制最大迭代次数和累计 Token。
