# 指标与成本

平台至少记录以下指标：

- Run 与 Task 的成功、失败、重试和取消数量。
- Agent、Skill、Tool 与模型选择分布。
- 输入 Token、输出 Token、估算成本。
- 端到端以及各节点的 p50、p95、p99 延迟。
- Router 的 Top-K Recall、MRR 与 NDCG。
- PRD 质量、证据覆盖和人工采纳率。

指标用于比较架构方案，不把“调用成功”误当成“任务成功”。Token 降低必须与任务质量和路由召回同时观察。
