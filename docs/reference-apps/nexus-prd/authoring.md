# Nexus PRD 写作工作区使用指南

## 当前可用范围

工作区用于单用户或受保护的个人虚拟机：需求简报、Markdown/TXT 材料、真实模型生成、结构化评审、手动编辑、反馈修订、SQLite 持久化、版本恢复以及 Markdown/HTML 导出。当前没有用户认证和租户隔离，请勿将此工作区作为多用户公共服务部署。

首次使用先阅读 [NexusOS 自身 PRD 草稿](product-prd.md)。它是依据原始需求和代码整理的产品文档，可导入工作区继续修订；不代表已经完成真实模型质量验收。

## 启动

在仓库根目录执行：

```bash
source .venv/bin/activate
pip install -e '.[dev,api,runtime]'

# 按实际服务设置，密钥仅在 API 服务配置。
export NEXUS_MODEL_NAME='你的模型名称'
export NEXUS_MODEL_BASE_URL='你的兼容模型服务地址/v1'
export NEXUS_MODEL_API_KEY='你的模型密钥'

# 可选：按模型实际限制设置总上下文与最大输出。
export NEXUS_PRD_CONTEXT_TOKENS=64000
export NEXUS_PRD_OUTPUT_TOKENS=14000
export NEXUS_PRD_DATABASE='./data/prd.sqlite3'

python -m uvicorn nexusos.api:create_app --factory --host 127.0.0.1 --port 8000
```

在另一个终端：

```bash
cd apps/studio
npm ci
NEXUS_API_URL=http://127.0.0.1:8000 npm run dev -- --hostname 127.0.0.1
```

打开 `http://127.0.0.1:3000/prd`。Studio 通过同源 `/api/prd/*` 转发请求，模型密钥不会进入浏览器。

环境变量也可以通过进程管理器设置。仅创建根目录 `.env` 不会自动加载到直接启动的 Python 进程；Docker Compose 的 `env_file` 才会读取它。Studio 的 `.env.local` 可保存 `NEXUS_API_URL`，不要在其中放模型密钥。

不配置模型仍然可以导入、编辑、保存和导出。点击生成会得到明确配置提示，不会退回固定模板。当前适配器调用兼容的 Chat Completions 服务，发送 `temperature` 和 `max_tokens`；服务必须支持这些参数。各供应商特定的推理参数、独立 Responses 协议、非兼容 Anthropic 接口仍需独立适配。

`NEXUS_MODEL_NAME` 只表示选定模型，并不证明服务已经可达。连接失败、限流、认证错误、非法响应或输出截断会在任务记录中显示失败。可以通过改变输出限制、简化材料或调整服务配置再试。

## 写作流程

1. 从工作台描述产品，或打开新文档。空白工作区提供“为 NexusOS 自己写 PRD”预填简报。
2. 填写用户、问题、首版范围、约束和验收期待。侧栏提示缺失字段，可跳转补充。
3. 添加资料。支持 `.md`、`.txt`、`.markdown` 或粘贴原文；每份提供来源名称。仅有 URL 不会自动抓取网页。
4. 保存后点击生成。需求、体验、技术、写作、评审阶段实际运行并记录所选 Agent 和 Skill。
5. 阅读 PRD 与问题清单，特别检查“建议”“假设”和“待确认”。没有问题也只代表等待人工评审。
6. 在正文中直接编辑，或填写修改要求后修订。修订会先保存当前人工修改，再生成一个新版本。
7. 需要时只重新评审，避免重复写作。修改正文或简报后，旧评审不再作为当前评审显示。
8. 导出当前正文为 Markdown 或 HTML。HTML 可离线阅读；导出不等同于服务器保存。

导入已有 PRD：选择“PRD 正文”→“导入已有 PRD”。已有正文时请新建文档导入，或自行在编辑模式合并，避免无提示覆盖。

## 保存、冲突与恢复

“浏览器草稿”表示只保存在当前浏览器；“已保存”表示服务端保存成功。没有变化的重复保存不会额外创建版本。

文档 URL 中包含文档 ID，可直接收藏。文档库按更新时间显示已保存文档。点击历史版本预览，载入编辑区后再次保存，会形成新版本，不删除历史。

两页编辑同一份文档时，旧修订不能覆盖新修订；冲突会显示明确错误。本地编辑仍可导出或作为草稿恢复，再与服务器版本合并。

模型生成/评审期间锁定同一文档的写入。可以关闭页面再回来，任务继续运行。停止任务不会取消供应商已经接受的计算，也不保证免除费用，但会阻止后续阶段和迟到结果覆盖文档。

正文生成后立即保存；后续评审失败不丢失正文。服务重启将未完成任务标记为中断，释放文档锁，不自动重放付费模型调用。

## 数据与部署边界

SQLite 默认位于 `data/prd.sqlite3`，文档、版本和任务输出都包含原始材料。使用一个 API 进程（不要配置多个 Uvicorn workers 或多个实例共享该数据库）。当前任务调度器在进程内运行，启动恢复依赖这个单实例边界。

备份建议停服务后备份 `data` 目录，或使用 SQLite 在线备份 API；运行时不要只复制主数据库而漏掉 WAL。浏览器草稿是辅助恢复，不可替代数据库备份。

Docker 镜像安装 runtime 依赖，Compose 为 `/app/data` 配置 `prd-data` 持久卷；容器其余部分保持只读。当前改动未在本机执行 Docker 构建与 Compose 启动。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/v1/prd/configuration` | 查看模型是否配置；不会返回密钥 |
| POST / GET | `/v1/prd/documents` | 创建简报 / 列出文档 |
| GET / PUT | `/v1/prd/documents/{id}` | 读取 / 保存；PUT 必须包含 expected_revision |
| GET | `/v1/prd/documents/{id}/versions` | 历史快照 |
| POST | `/v1/prd/documents/{id}/jobs` | 发起 generate / revise / review，返回 202 |
| GET | `/v1/prd/jobs/{id}` | 轮询实际任务进度与阶段输出 |
| POST | `/v1/prd/jobs/{id}/cancel` | 停止任务 |

`/v1/prd/runs` 仍是原有离线参考内核 API，供基线回归使用；新工作区不调用它。不要把其固定输出与参考质量分数当成真实写作结果。

## 验证方式与限制

```bash
python -m unittest discover -s tests -v
python -m ruff check .
python -m mypy packages/nexusos-python/src/nexusos benchmarks tests
python -m mkdocs build --strict
cd apps/studio
npm run typecheck
npm run build
```

受控模型测试验证上下文传递、路由、持久化、修订、失败和恢复，不评价真实模型写作质量。实际使用前，用 NexusOS 和另一个主题各生成一份文档，由作者对照简报逐项验收。

当前不提供联网事实核验、DOCX/PDF、自动版本差异或完整语义正确性保证。模型可能遗漏和误改内容，需要利用来源、版本和评审清单检查。用量为成功取得并经 Runtime 校验的响应统计；失败、截断和停止后的供应商计费以供应商记录为准。

## 全程追溯

保存文档后打开“全程追溯”页签，选择任意历史任务，可检查本次输入快照、Agent/Skill 版本及选型依据、实际模型 messages、参数、响应、终止原因、Token、耗时，以及正文版本来源。展开事件可查看 trace_id/span_id 和内容哈希。

“文档时间线”也记录创建、人工编辑和版本恢复来源；任务与事件均支持分页。点击“导出追溯 JSON”可保存本次任务的证据包。导出包含原始材料与模型对话，应按原文的敏感程度保管。

失败/停止任务可以“基于当前文档重新执行”，新任务关联旧任务并保留独立 Trace。它使用当前保存版本，不是自动重试或断点恢复。旧任务没有记录的输入/调用会明确显示缺失，不补造历史。

详见[全程追溯问题与技术方案](../../development/runtime-issues/001-end-to-end-tracing.md)；后续长任务、限流、调度与记忆按[问题台账](../../development/critical-runtime-backlog.md)迭代。
