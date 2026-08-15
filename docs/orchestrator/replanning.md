# 结构化重规划

评审未通过时，Revision Planner 根据失败维度只生成必要修订任务：证据不足补研究，可行性不足补技术与风险，完整性不足补需求；随后重新撰写和使用同一 Rubric 评审。

```text
ReviewResult
  -> evidence < 85      -> Research
  -> feasibility < 85   -> Technical
  -> completeness < 85  -> Requirements
  -> Write -> Review
```

迭代有明确上限，默认两次。达到上限仍未通过时 Run 进入 `blocked`，保留每一轮任务、Token、产物和评审结果，由人决定继续、修改输入或停止。该机制避免无界 Reflection 循环消耗 Token。
