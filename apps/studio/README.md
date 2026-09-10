# NexusOS Studio

当前主入口是 Nexus PRD 写作工作区：需求与材料、真实模型生成、Markdown 编辑预览、持久化文档库、历史版本、反馈修订、独立评审与 MD/HTML 导出。

完整配置见[写作工作区使用指南](../../docs/reference-apps/nexus-prd/authoring.md)。模型密钥只配置在 Python API 服务中；Studio 只需要 API 地址。

## 本地运行

建议 Node.js 22 和 npm：

```bash
cd apps/studio
npm ci
NEXUS_API_URL=http://127.0.0.1:8000 npm run dev -- --hostname 127.0.0.1
```

打开 `http://127.0.0.1:3000/prd`。也可在 `.env.local` 设置 `NEXUS_API_URL`。

```bash
npm run typecheck
npm run build
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static
HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
```

当前环境已通过类型检查与生产构建。PRD 页面通过 `/api/prd/*` 同源代理读取实际服务；接口失败不会使用样例内容。

原 `/runs/[runId]` 页面保留参考内核运行详情与标明来源的演示快照，不作为正式 PRD 编辑入口。新工作区的任务记录在文档侧栏中查看。
