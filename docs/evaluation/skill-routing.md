# Skill 路由基准

路由评估同时比较质量与成本，避免只用 Token 降低掩盖召回下降。

## 策略

- `all_skills`：把全部 Skill 当作候选上下文，作为高 Token 基线。
- `keyword`：只按词法重合排序。
- `nexus_hybrid`：领域、语义代理、关键词、能力、质量、成本、延迟和策略融合。

## 指标

Top-1 Accuracy、Recall@3、Recall@5、MRR、NDCG@5 与平均选中指令 Token。数据集、Skill Manifest 和运行代码全部版本化。

```bash
PYTHONPATH=packages/nexusos-python/src \
python -m benchmarks.router.run \
  --output artifacts/router-benchmark.json
```

仓库不提交手工编造的性能数字。任何公开结果必须记录代码提交、数据集版本、Skill 数、运行环境、随机种子和模型版本。
