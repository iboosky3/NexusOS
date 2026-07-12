# ADR-0002：区分 LangGraph 与 Temporal 的运行职责

- 日期：2026-07-12
- 状态：已接受

## 背景

LangGraph 和 Temporal 都具备持久化、恢复或重试能力，直接把两者用于同一层级会导致双重状态源、重复重试和难以判断的所有权。

## 决策

LangGraph 负责单个 Agent 任务内部的模型推理图、节点状态、流式输出、反思和 Human-in-the-loop。Temporal 负责跨服务、长时间运行的业务流程、Worker 调度、活动重试和跨天人工等待。

```text
Temporal Workflow
  -> Nexus Task Activity
  -> LangGraph Agent Graph
  -> Model / Tool calls
```

第一版只启用进程内 Orchestrator 与 LangGraph 适配器，Temporal 等远程 Worker 边界稳定后再接入。

## 后果

- 一个任务的模型节点失败由 LangGraph 策略处理。
- 跨服务 Activity 失败由 Temporal 策略处理。
- 幂等键、超时与重试归属必须在跨层契约中显式声明。
- 不允许 LangGraph Checkpoint 与 Temporal Workflow 同时作为同一业务状态的主数据源。
