# Agent 插件工作台实施说明

版本：设计稿 v1.0 · 2026-09-21。关联 REQ-006；架构基线为 `44ad03b`。

本文是[架构方案](../architecture/agent-plugin-workbench.md)的实施计划，目录、API、数据表除下述实施记录外均为**拟议契约**，不是现有能力清单。设计基线先于代码交付；每阶段记录验证证据和剩余边界。

### 当前实施记录 · 2026-09-21

M1 第一批已接入 `extensions/builtin.ts` 与无 React/领域依赖的 `lib/extension-host/registry.ts`。两个内置插件声明编辑器、快捷入口、命令归属与现有 Agent 动作；注册校验命名空间、重复绑定、入口目标、API 版本和依赖循环，注册快照不可变。工作台读取声明构造标签、快捷栏、插件列表和空态入口，禁用插件的领域命令不可执行；重启/恢复任务不再绕过前端启用检查。PRD 简报、材料和流程图在插件禁用后停止编辑。

这是迁移适配，不是完整 M1：`legacyTab`、`legacyCommand` 明确承接现有宿主；菜单位置、命令实现和编辑器 React 渲染尚未全部迁出。第三个插件测试只证明注册与解析，不证明任意第三插件已有完整 UI。生命周期、服务端授权统一、独立资源和产物协议尚未实现。未修改旧数据和持久化格式。

验证入口：`cd apps/studio && npm run test:extensions`（Node 22.6+，9 项注册表测试）、`npm run typecheck`、`npm run build`。本批不将这些检查视为浏览器交互、真实模型或迁移验收；后续必须继续补齐。

## 1. 实施原则

**以后增加插件，应主要写插件自己的代码。** 因此不以移动文件、增加 manifest 或改名为验收，而以第三个插件能否独立接入为验收。

保留现有 NexusOS 编排内核、PRD 受控流程和追溯能力。先建立适配层，再替换业务调用；新旧实现不同时写两份权威数据。各阶段保持旧入口可用，不一次性重写整个 Studio。

## 2. 分阶段交付与依赖

| 阶段 | 主要交付 | 进入下一阶段的门槛 |
| --- | --- | --- |
| M0 设计基线（本轮） | 架构、接口方向、迁移与验收说明、原始需求 | 文档构建通过；目标与已实现明确分开 |
| M1 注册与宿主边界 | 版本化 manifest、贡献注册表、命令服务、编辑器解析、集中装配入口；迁出固定业务分支 | 空插件工作台可启动；第三个示例插件仅改插件目录和装配声明；重复 ID、缺失依赖有诊断 |
| M2 生命周期与工作区 | activate/dispose、启停状态、Workspace 身份、布局、DocumentSession 与草稿恢复 | 插件停用可释放订阅；关闭标签不丢草稿；两个工作区互不污染 |
| M3 统一 Agent 调用 | Invocation 服务、能力注册、上下文快照、事件、取消、重试、审批；旧 PRD job 适配 | 普通生成、澄清、组件建议、重启与恢复全部经过同一校验入口；禁用插件不能绕过 |
| M4 独立资源 | Resource/Revision/Blob 存储、原型与 PRD 分离、旧数据迁移、兼容投影 | 原型不依赖 PRD 即可工作；旧版本/截图/任务可查；双窗口冲突不会覆盖 |
| M5 版本化交接 | 原型快照发布、消费协议、交接预览、原子写入与回执 | 固定版本可追溯；重复请求不重复嵌入；冲突后可重新审阅 |
| M6 整体验收与切换 | 真实交互回归、布局恢复、可访问性、旧路由适配、文档更新 | 两插件独立和组合场景均通过；迁移与回退演练有证据 |

依赖为 `M0 → M1 → M2 → M3 → M4 → M5 → M6`。M3 暂通过 LegacyResourceAdapter 解析旧文档和 revision，明确标记 legacy 引用；M4 切换到独立资源，不提前宣称原型已解耦。每阶段可以有多个小提交，不把未通过验收的阶段标为完成。

## 3. 目标目录与迁移映射

以下目录是建议命名，实施时可微调，但职责边界不变。

```text
apps/studio/
  components/workbench/        # 通用外壳：标签、面板、布局、任务状态
  lib/plugin-sdk/              # 插件公共类型和受限 HostContext
  lib/extension-host/          # 注册、依赖、激活、释放、贡献解析
  lib/workspace/               # Workspace、DocumentSession、草稿、布局
  extensions/
    builtin.ts                # 唯一内置插件装配清单
    prototype-designer/        # manifest、编辑器、命令、Agent 客户端适配
    prd-writer/                # manifest、简报/正文、交接消费界面
packages/nexusos-python/src/nexusos/
  workspaces/                 # 工作区、配置、插件启用状态
  resources/                  # 资源封装、版本、CAS、媒体引用
  invocations/                # 通用任务、校验、事件、权限与追溯
  artifacts/                  # 发布、交接、回执与幂等
  plugins/
    registry.py               # 受信任服务端实现的显式注册
    prototype/                # 原型 schema、生成/组件建议、快照生产
    prd/                      # PRD schema、受控流程适配、产物消费
contracts/plugin-workbench/   # 版本化 JSON Schema、跨语言样例与错误契约
```

| 现有位置 | 调整方向 | 保留什么 |
| --- | --- | --- |
| `lib/workbench-extensions.ts` | 拆出 manifest、注册表、装配与兼容适配 | 内置插件 ID、懒加载入口 |
| `components/prd-studio/studio-workspace.tsx` | 外壳只组合贡献，领域动作回到对应插件 | 现有路由、操作语义与焦点行为 |
| `lib/use-prd-studio.tsx` | PRD 领域状态留在 PRD 插件；资源保存、会话、任务订阅抽公共服务 | 文档版本校验与历史任务 |
| `components/prd-studio/assistant.tsx` | 通用会话视图 + 当前插件能力；移除直接业务请求 | 组件建议预览、人工应用 |
| `extensions/prototype-designer` | 持有独立设计输入、资源与组件修改逻辑 | Puck 设计数据、已有属性/代码编辑 |
| `nexusos/prd/api.py`、`store.py`、`workflow.py` | API 兼容适配；存储逐步转资源服务；工作流由领域 handler 调用 | 受控编排、检查点、Trace、旧 ID |

依赖约束：Shell 可以依赖 SDK、Host 和通用资源描述，不能导入 PRD/原型内部组件。插件可以依赖 SDK 与领域代码，不能访问另一个插件的 React 状态、私有表或 store。装配文件是允许同时引用内置插件的唯一组合位置。

## 4. 注册和生命周期落地

前后端共享能力 ID 和 schema，但不从客户端上传或动态导入服务端处理器。服务端只装配仓库中的受信任 handler；manifest 里的 handler 标识仅用于查表。

插件入口伪代码（用于表达契约，不是已存在的 API）：

```typescript
async function activate(context: PluginContext): Promise<Disposable> {
  const registrations = new DisposableStore();
  registrations.add(context.commands.register("nexus.prototype-designer.preview", preview));
  registrations.add(context.editors.register("nexus.prototype-designer.canvas", createEditor));
  registrations.add(context.agents.bind("nexus.prototype-designer.suggest-component", suggest));
  return registrations; // Host 统一逆序释放；重复 dispose 无副作用
}
```

manifest 先声明允许的贡献，activate 再绑定实现；绑定未声明 ID、跨插件占用 ID、API 主版本不兼容一律拒绝。激活用共享 Promise 合并并发请求，失败释放已注册资源并可重试，避免重复命令。

停用流程：阻止新命令和新任务 → 提示未保存内容与运行任务 → 保存草稿或允许用户取消停用 → 卸载编辑器和订阅 → 标记 disabled。服务端同步工作区启用状态，不能只隐藏按钮。已运行任务可完成为待审提案，但应用提案、发布产物时重新检查授权和启用状态。任务记录属于平台，插件停用后仍可查看。

前端的 AbortController 只取消前端等待；必须调用服务端取消接口才表示提出任务取消请求。不能把组件卸载当作模型或后台任务已停止。

## 5. 拟议 HTTP 契约

统一响应提供 requestId；错误至少有 `code`、`message`、`retryable` 和可公开的冲突信息。客户端传 workspaceId 不代表已获得访问授权，服务端逐项核验资源归属。

| 接口 | 核心输入/输出与约束 |
| --- | --- |
| `POST /v1/workspaces` | 创建工作区；clientRequestId 幂等 |
| `GET/PATCH /v1/workspaces/{id}/configuration` | 启用插件及配置 revision；PATCH 必须带 expectedRevision |
| `POST /v1/workspaces/{id}/resources` | resourceType、schemaVersion、payload、clientRequestId；服务端验证类型与插件能力 |
| `GET /v1/workspaces/{id}/resources/{resourceId}` | 当前资源封装与 revision |
| `PATCH /v1/workspaces/{id}/resources/{resourceId}` | expectedRevision + 校验后的领域 payload；成功返回新 revision |
| `GET /v1/workspaces/{id}/resources/{resourceId}/versions/{revision}` | 不可变版本；不存在明确返回 404，不降级到当前版本 |
| `POST /v1/workspaces/{id}/invocations` | 架构方案中的 Invocation 请求；返回 invocationId 和状态 |
| `GET /v1/workspaces/{id}/invocations/{invocationId}/events?after={sequence}` | 可重连事件流；客户端按 sequence 去重，断档重新加载任务快照 |
| `POST /v1/workspaces/{id}/invocations/{invocationId}/cancel` | 幂等提出取消；终态返回真实状态，晚到结果不自动应用 |
| `POST /v1/workspaces/{id}/invocations/{invocationId}/retry` | 新 requestId、新任务 ID、retryOf；资源变化需要重新取上下文并确认 |
| `POST /v1/workspaces/{id}/artifacts` | 固定源 revision、完整媒体引用、确认信息；验证后发布不可变产物 |
| `POST /v1/workspaces/{id}/handoffs` | artifactId、目标资源或创建意图、消费能力、clientRequestId；先生成可审阅交接 |
| `POST /v1/workspaces/{id}/handoffs/{handoffId}/apply` | 绑定 proposalDigest、artifactDigest、expectedTargetRevision 的确认；原子写入与回执 |

契约错误码至少包括 `PLUGIN_DISABLED`、`CAPABILITY_DENIED`（403）、`RESOURCE_NOT_FOUND`（404）、`REVISION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`APPROVAL_STALE`（409）、`SCHEMA_INCOMPATIBLE`、`INVALID_CONTEXT`（422）。临时基础设施故障可重试；权限/校验失败不能自动反复重试。共享样例必须验证 TypeScript 与 Python 对同一输入接受/拒绝一致。

Agent 改动先产出 proposal，应用时绑定源版本、修改范围和权限；模型输出不能直接调用任意资源写入。生成、评审、澄清、组件建议、旧 job 重试和检查点恢复都纳入入口审计。恢复与重试不是一回事：仅声明支持且检查点匹配的 handler 允许恢复；其余返回明确不支持。

首版保留本地单用户假设，不把能力白名单包装为完整多租户安全。外部部署前必须补齐身份认证、工作区 ACL、审计和威胁模型验收。浏览器内受信任插件没有真正代码沙箱。

## 6. 数据表与一致性约束

首版沿用 SQLite 和事务能力，不为插件单独部署数据库。业务 schema 归插件，公共版本/引用/任务元数据归平台。

| 拟议表 | 关键约束 |
| --- | --- |
| workspaces / workspace_plugins | 工作区身份；插件 ID、启用状态、配置 revision 与权限版本 |
| workspace_layouts | workspaceId + clientProfile 唯一；界面布局不混入资源正文 |
| resources / resource_versions | 资源当前指针；resourceId + revision 唯一；版本不可变；CAS 更新指针 |
| blobs | 内容摘要、类型、大小、存储引用；先暂存后引用，未引用对象延迟清理 |
| artifacts | 不可变 envelope 和 digest；源资源/版本、截图引用均可追溯 |
| handoffs / handoff_receipts | 幂等键绑定请求摘要；目标新 revision 与回执同事务提交 |
| invocations / invocation_events | clientRequestId 作用域唯一；invocationId + sequence 唯一；保存权限与输入快照 |
| legacy_resource_mappings | 旧 documentId/version 与新资源 ID/revision 映射；重复迁移不可重复生成 |

所有幂等键按工作区、操作和调用者作用域隔离；同键不同输入返回冲突。任务状态推进需要比较旧状态，取消与完成竞争不得把终态回退。长时间模型调用、截图与媒体上传不占用数据库写事务。

草稿是客户端会话数据，可以包含尚不合法的 JSON；服务端正式资源必须校验通过。草稿记录 resourceId、baseRevision 和客户端身份，恢复发现服务端版本变化时提供对比，不自动覆盖。截图确认绑定正式 revision，不能用未应用代码草稿的截图冒充已保存版本。

## 7. 旧数据迁移与回退

### 7.1 迁移前检查

1. 备份实际 SQLite、媒体文件及配置，生成计数和摘要清单；在备份副本演练，确认能够恢复。
2. 盘点 PRD 文档、历史 versions、内嵌原型、截图、jobs、检查点、Trace、归档和删除状态。旧 `version` 与保存 `revision` 不等价，不能直接互换。
3. 建立迁移映射与失败报告；缺失图片、未知 schema 或无来源版本的历史记录标记不可完整迁移，保留原始内容，不让 AI 补造历史。

### 7.2 增量切换流程

```text
备份和只读盘点
      ↓
建立新表与兼容读适配（旧模型仍是唯一写入源）
      ↓
逐文档锁定迁移 → 拆分 PRD / 原型 → 校验计数、内容、引用
      ↓  单事务提交映射与迁移标记
该文档改由新资源服务唯一写入；旧 API 读写通过兼容适配
      ↓
验证旧入口 / 新入口 / 历史版本 / 任务恢复 → 分批扩大范围
```

迁移单位内禁止并发旧写入：获取迁移锁或事务后重读 revision，变化则重试，不能用过期快照完成迁移。映射稳定且带 migrationVersion；中断重跑不会重复创建资源。运行中的旧任务在切换前排空或保持旧适配到终态，不能切换一半丢失输出。

每个旧文档默认关联一个迁移工作区和一份 PRD 资源；有原型时创建独立原型资源。新资源 ID 由持久化映射固定。历史版本逐项映射，缺失的历史内容显式标记，不把当前原型回填到过去。原确认只有在能证明来源与截图一致时才能转换为已确认快照，否则保留旧确认记录并要求重新确认。

兼容 API 对新资源做投影，不再维护第二份 Brief 原型作为权威数据。旧接口无法表达多原型、版本化交接等新能力时明确拒绝有损写入并提示新入口；不能静默丢弃字段。历史 job 和 Trace 保持原 ID，通过映射补关联，不重写历史事件。

### 7.3 回退边界

- 新资源尚无用户写入：关闭新路径，使用旧权威数据；保留迁移诊断和备份。
- 新资源已有写入：优先修复新服务或回退兼容 UI，继续由新存储写入。不能恢复旧备份而丢掉迁移后的工作。
- 必须回旧存储：先停止写入，导出增量，验证旧模型可表达；不能表达的资源保留只读并人工处理。完成反向迁移验收后才切换，不能承诺一键无损回退。

回退开关不能绕过资源写入源标记。只有全部活跃文档和旧客户端兼容完成、备份恢复演练通过后，才另行规划删除旧字段/表；本方案不授权直接删旧数据。

## 8. 版本化交接实施细节

由原型插件生产 `nexus.prototype.snapshot@1`，PRD 插件声明消费该版本。平台只验证封装、权限、引用和交接状态，不负责拼 PRD 正文。

先保存源 revision，再截取该版本，媒体完整后发布。若截取期间源已变化，只能显式发布旧版本或重新截取；不可把旧图标成新版本。产物 digest 采用共享规范化规则，配跨语言黄金样例，排除临时 URL 等不稳定字段。

交接 UI 先展示目标文档、源版本、页面数、截图状态和更新摘要。“嵌入已确认设计”是确定性消费，“请 Agent 根据设计编写需求”会产生待审提案，不能合成一个含糊的按钮。

应用事务中校验批准摘要、当前权限、插件状态、目标 revision；写新正文版本和交接回执一起成功。并发冲突保留提案并显示差异，用户重新确认，不静默重跑模型。源更新后显示“有新版本可交接”，不覆盖已采用的旧版本；按 sourceResourceId + artifactId 可以回溯和更新来源区块，不能仅按正文标题查找。

## 9. 人类友好与操作效率验收

| 场景 | 预期体验 |
| --- | --- |
| 关闭标签 | 明确不删除资源；可恢复关闭标签，焦点回相邻编辑器；纯关闭不取消后台任务 |
| 关闭全部标签 | 安静的空工作区与重新打开入口；不继续发送隐含 PRD 请求 |
| 隐藏面板/全屏 | 视图菜单和快捷键均可恢复；退出专注恢复之前布局；键盘焦点可见 |
| 原型编辑 | 中央以画布为主；页面说明在属性栏；次要操作进入菜单；增加适应画布与缩放 |
| 选择组件后询问 AI | 显示将使用的组件/版本范围；回复绑定原选择，切换选择不偷换应用目标 |
| 切换资源 | 草稿、已保存、冲突、待应用建议状态有区别；旧任务回复不写入当前新资源 |
| 命令查找 | 仅显示当前上下文相关命令，并可搜索全部；无权限命令解释原因而非无反馈 |
| 插件停用 | 先解释草稿和运行任务影响，可取消；数据不随插件移除而删除 |
| 交接 PRD | 预览变更与来源，明确确认；出错保留现场，并提供重试/查看冲突入口 |

这些建议分配到 M2/M5/M6 验收，不在本轮直接改变界面。恢复关闭标签、草稿状态和交接预览优先；自定义快捷键和更多布局模板后置，避免阻碍基础边界完成。

## 10. 测试矩阵与证据

| 层级 | 必测项 |
| --- | --- |
| 契约 | schema 版本、未知字段策略、重复贡献、兼容性、跨语言 digest 一致 |
| Host 单测 | 并发激活一次、失败回滚、重复 dispose、依赖停用、取消停用、无插件启动 |
| 会话单测 | 多资源身份、标签邻近选择、关闭恢复、非法 JSON 草稿、刷新恢复、跨工作区隔离 |
| API 集成 | 所有 Agent 入口同权校验、伪造资源归属、过期批准、断线续读、取消竞争、重试幂等 |
| 存储集成 | CAS 双窗口、事务失败不留下半条回执、重复迁移、旧 version/revision 映射、软删除引用 |
| 交接集成 | 媒体缺失、截图期间源修改、目标冲突、不兼容 schema、重复提交、权限撤回 |
| 浏览器 | 原型单插件、PRD 单插件、组合交接、全部关闭、停用再启用、分屏/焦点/全屏恢复 |
| 架构回归 | 示例第三插件只改自身和装配；静态依赖检查 Shell 不引用领域模块 |
| 迁移演练 | 副本迁移前后清单对比、失败重跑、备份恢复、发生新写入后的回退方案 |

模拟模型用于确定性测试；另做真实模型冒烟，分别报告，不将模拟 API 测试写成真实模型成功。文档构建、类型检查和编译不能替代浏览器交互或迁移验收。

每阶段验收记录至少包含提交、运行命令、结果、覆盖范围、未测项和可复现数据。新增测试放入仓库而非只留一次性终端脚本。

## 11. 发布与完成清单

按工作区持久化功能开关，先内部试用；存储迁移标记独立于 UI 开关。失败时可停用新任务和新交接，不影响读取既有产物。监测激活失败、调用失败/取消延迟、保存冲突、迁移失败和交接重试，阈值由实测基线决定。

- [x] M0 文档作为可审阅基线交付；设计交付时状态为“已规划”，M1 首批开始后改为“实现中”。`mkdocs build --strict` 与 `git diff --check` 通过。
- [ ] M1–M6 各自有独立提交与测试证据，并更新 REQ-006 实现轨迹。
- [ ] 第三个插件不修改 Shell、PRD 或原型业务逻辑即可使用。
- [ ] PRD/原型可独立创建与保存；没有业务插件时工作台仍可使用。
- [ ] Agent 入口统一，权限、快照、取消、重试和恢复边界均验证。
- [ ] 交接来源/版本/截图可追溯，不覆盖未确认或并发修改的数据。
- [ ] 旧入口、旧数据、旧任务可访问，迁移/回退演练通过。

下一代码阶段从 M1 开始：先补注册契约和测试，再迁出固定贡献。不要同时启动数据库拆分和全量 UI 重写；完成注册边界后再推进生命周期与资源模型。
