# NexusOS Studio

当前工具入口是 `/studio` 插件工作区：独立原型/PRD/示例便签资源、Markdown 编辑、版本保存、Agent 提案批准与快照交接。旧工具入口仅导航，不迁移旧数据；多阶段 PRD 质量流程和组件级修改尚待接入。

完整配置见[写作工作区使用指南](../../docs/reference-apps/nexus-prd/authoring.md)。模型密钥只配置在 Python API 服务中；Studio 只需要 API 地址。

## 本地运行

建议 Node.js 22 和 npm：

```bash
cd apps/studio
npm ci
cd ../..
bash scripts/start-studio.sh
```

打开 `http://127.0.0.1:3000/studio`。脚本默认监听 `0.0.0.0:3000` 并连接 `http://127.0.0.1:8000`，可使用 `NEXUS_API_URL`、`NEXUS_STUDIO_HOST` 和 `NEXUS_STUDIO_PORT` 覆盖默认配置：

```bash
NEXUS_API_URL=http://localhost:8000 NEXUS_STUDIO_HOST=0.0.0.0 NEXUS_STUDIO_PORT=3001 bash scripts/start-studio.sh
```

```bash
npm run typecheck
npm run build
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static
HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js
```

当前环境已通过类型检查与生产构建。PRD 页面通过 `/api/prd/*` 同源代理读取实际服务；接口失败不会使用样例内容。

原 `/runs/[runId]` 页面保留参考内核运行详情与标明来源的演示快照，不作为正式 PRD 编辑入口。新工作区的任务记录在文档侧栏中查看。
