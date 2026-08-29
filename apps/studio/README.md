# NexusOS Studio

Studio 是 NexusOS 的运行控制台，不是通用聊天页面。首个界面用于观察 PRD 工作流的运行状态、任务执行链、Agent/Skill 选择、质量门、Token 用量和产物。

## 当前范围

- 总览页与最近运行列表；
- 单次运行详情、任务时间线和质量维度；
- Skill 候选得分、选择结果和可解释原因；
- 桌面与移动端响应式布局；
- 明确标记的演示快照数据。

页面优先从 `NEXUS_API_URL` 读取 `/v1/runs` 和运行详情。未配置 API 或请求在 2.5 秒内失败时，会降级到 `lib/sample-data.ts` 的类型化快照，并在界面显示黄色“演示快照”标记和失败原因，避免把样例指标解释成真实监控数据。

## 本地运行

需要 Node.js 22 和 npm：

```bash
cd apps/studio
copy .env.example .env.local
npm install
npm run dev
```

打开 `http://localhost:3000`。当前开发机缺少 Node.js，本提交只完成了源代码与类型边界检查；构建验证由后续 CI 补齐。
