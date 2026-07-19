# Nexus Skill Router（Rust）

该 crate 实现低延迟排序内核：接收上游召回候选与评分信号，先执行领域、工具、成本和风险硬约束，再融合评分并按 Token 预算选择结果。

同时提供 Reciprocal Rank Fusion，用于合并稠密与稀疏召回列表。它只处理 `SkillSummary` 等价元数据，禁止读取完整 Skill 指令。

## 本地验证

```bash
cargo test
```

当前 crate 不依赖网络框架。远程传输适配器将在契约稳定并完成性能基准后增加，避免排序内核绑定特定 RPC 技术。
