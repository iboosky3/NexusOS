# 规模基准

规模基准将真实回归 Skill 与确定性无关候选组合为 100、1,000、10,000 或更多 Skill 的目录，测量路由质量、p50/p95 延迟、峰值 Python 内存、全量指令 Token 与实际选中指令 Token。

```bash
PYTHONPATH=packages/nexusos-python/src \
python -m benchmarks.scale.run \
  --catalog-size 10000 \
  --output artifacts/scale-10000.json
```

合成候选用于隔离目录规模影响，不等同于真实世界的困难负样本。正式报告需要增加语义相近、跨领域与权限冲突样本，并分别运行 Python 与 Rust 实现。

报告写入 Python、操作系统、目录大小、查询数、重复次数和固定生成器版本。延迟结果不得跨不同硬件直接比较。
