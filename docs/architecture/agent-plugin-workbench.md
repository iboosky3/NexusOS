# Agent 插件工作台架构方案

版本：设计稿 v1.0 · 2026-09-21  
关联需求：REQ-004、REQ-005、REQ-006  
基线：`44ad03b` 及之前的工作台实现。本文描述**目标架构**，不表示其中接口和服务已经实现。实施顺序、迁移、测试与回退见[实施说明](../development/agent-plugin-workbench-implementation.md)。

## 1. 核心思想与交付目标

> **以后增加插件，应主要写插件自己的代码。**

NexusOS 提供基础工作台和 Agent 执行基础设施。用户通过组合插件形成自己的工作区。PRD 编写与原型设计是第一对业务插件，不应成为基础工作台不可移除的业务前提。

这句话具体约束工程实现：新增领域插件允许增加插件目录、资源 schema、服务端领域处理器、测试和一条装配注册；不应为了打开新工具而修改宿主里的 `if (pluginId === ...)`、新增固定标签、复制 AI 对话框或增加一个全局业务状态。只有多个插件确实需要且无法由现有扩展点表达的能力，才提升为平台接口。

借鉴 VS Code 的编辑器、命令、扩展注册与工作区概念，不承诺兼容 VS Code API、`.vsix` 或任意第三方代码。首版采用**随应用部署的受信任插件 + 明确的服务端能力边界**。远程插件市场与不可信脚本隔离单独设计。

### 可判断是否成功的三个场景

1. 仅启用原型插件：创建原型资源、手工编辑、让 Agent 提出组件修改、保存和预览；不要求先创建 PRD 文档。
2. 再启用 PRD 插件：接收某个已确认原型版本，生成或更新 PRD，能查到所用原型、截图与任务版本。卸载 PRD 插件不影响原型数据。
3. 添加第三个示例插件：通过声明和注册即可贡献命令、编辑器、资源视图与 Agent 操作，基础 Shell 不增加第三种业务的判断分支。

## 2. 现状与差距

以下是基于当前代码的观察，不是对目标实现的推测。

| 当前位置 | 已有能力 | 需要调整的原因 |
| --- | --- | --- |
| `apps/studio/components/workbench/workbench.tsx` | 菜单、活动栏、分屏、命令搜索、全屏 | 可作为 Shell 起点，但贡献项仍由业务页面一次性传入 |
| `components/workbench/use-editor-tabs.ts` | 打开、关闭、激活标签 | 只有业务字符串 ID，尚无资源身份、视图状态与统一草稿恢复 |
| `components/prd-studio/studio-workspace.tsx` | PRD／原型组合界面和显式交接 | 硬编码标签、插件清单、菜单、Agent 分发和跨插件保存 |
| `lib/workbench-extensions.ts` | manifest、惰性组件加载、启用及固定快捷栏 | 没有正式生命周期；偏好不是按工作区隔离；`agentActions` 只列四种领域动作 |
| `extensions/prd-writer/manifest.ts` | Markdown 编辑插件与动作声明 | 需求澄清、保存、评审等多数仍由宿主管理 |
| `extensions/prototype-designer` | Puck 设计、属性、代码、预览和截图 | 页面管理、AI 建议和交接仍依赖 PRD 宿主 |
| `lib/use-prd-studio.tsx` | 文档、任务、草稿恢复和版本校验 | 原型与 PRD 共享 Brief 和单个文档生命周期 |
| `nexusos/prd/api.py` | 文档／任务接口、澄清、组件建议 | 部分模型请求在路由中完成，未统一为插件 Agent Invocation |
| `nexusos/prd/store.py` | SQLite 事务、revision、历史版本、任务和追溯 | 表与资源身份仍以 PRD 为中心 |
| `nexusos/prd/workflow.py` | AgentResolver、Skill、Model Gateway、受控工作流和追溯 | 应通过适配器复用，不应另造浏览器端执行内核 |

`/prototype-studio` 已提供独立编辑入口，但目前复用 `StudioWorkspace` 和 `usePrdStudio`，所以它是独立视图，尚不是独立资源应用。当前“确认并交给 PRD”是由宿主截图、保存并导航的业务动作，尚不是通用的插件交接协议。

## 3. 总体结构框图与依赖方向

下图使用文本结构图，仓库预览和文档站均可直接阅读。所有框是**目标逻辑模块**；首版可以处于同一前端包与 Python 服务中，不要求拆分部署。

```text
                              用户
                               │
                  命令 / 编辑 / 对话 / 工作区预设
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Workbench Shell                                             │
│ 菜单与快捷栏 │ 编辑器组 │ 资源树 │ 对话容器 │ 任务与状态栏   │
└──────────────────────────────┬──────────────────────────────┘
                               │ 消费声明与受控服务
┌──────────────────────────────▼──────────────────────────────┐
│ Extension Host + Contribution Registry                      │
│ 装配 / 生命周期 / 命令解析 / 编辑器匹配 / 订阅释放           │
├──────────────────────────────┬──────────────────────────────┤
│ 原型插件                     │ PRD 插件                     │
│ Puck / 页面 / 预览 / 截图     │ 简报 / Markdown / 评审       │
│ 原型 Agent 能力              │ PRD Agent 能力               │
│ 发布 prototype.snapshot      │ 消费 prototype.snapshot      │
└──────────────────────────────┴──────────────────────────────┘
              │                Host SDK                │
              ▼                                        ▼
┌─────────────────────────────────────────────────────────────┐
│ 平台 API：工作区 / 资源与版本 / Invocation / 产物与交接       │
│ 认证主体与授权 / 输入校验 / CAS / 幂等 / 事件和追溯           │
└──────────────┬────────────────────────┬─────────────────────┘
               │                        │
┌──────────────▼───────────────┐  ┌───────▼────────────────────┐
│ 服务端插件处理器注册表       │  │ 通用存储端口               │
│ 领域校验 / Agent 任务定义    │  │ 工作区 / 资源版本 / 产物    │
│ 消费产物 / 生成变更提案      │  │ 交接 / Invocation / 事件   │
└──────────────┬───────────────┘  └────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────────┐
│ 现有 NexusOS 编排内核                                       │
│ Planner / AgentResolver / Skill / Context / Runtime / Model │
└─────────────────────────────────────────────────────────────┘
```

前端插件只能依赖 SDK、公共契约及自身组件。Shell 不导入 PRD 或 Puck 类型。前后端插件通过版本化协议协作，不通过读取另一个插件的 React state 协作。注册表是装配点，允许引用插件实现；业务分支不能继续散落到 Shell。

## 4. 职责分配与设计理由

| 层 | 拥有的职责 | 不应承担的职责 | 理由 |
| --- | --- | --- | --- |
| Shell | 布局、焦点、标签、命令搜索、通用反馈 | PRD 目录、Puck 节点、原型确认规则 | 业务增加不影响基础操作 |
| Extension Host | 插件发现、激活、上下文与订阅管理 | 模型推理、解释业务产物 | 限定扩展机制的复杂度 |
| 平台服务 | 工作区身份、版本读写、任务状态、权限与审计 | 直接编写文档、决定原型画面 | 一致性和执行边界统一 |
| 原型插件 | 页面模型、编辑与渲染、交互校验、原型 Agent | 直接改 PRD 正文或其私有数据 | 原型可以独立使用 |
| PRD 插件 | 简报、正文、评审、消费原型产物、PRD Agent | 控制 Puck 编辑状态 | 只依赖稳定的产物契约 |
| NexusOS 内核 | 已有规划、能力选择、执行、模型与追溯 | UI 标签与浏览器局部状态 | 保留原有编排投资和边界 |

前端插件停用是工作区能力选择，不是安全沙箱。首版插件运行在同源受信任进程，理论上可以访问浏览器 API；必须依靠代码审查及服务端授权约束访问。不得宣称 manifest 中一个 `permissions` 数组能隔离恶意插件。

## 5. 插件注册入口

### 5.1 声明与执行分离

静态 manifest 负责描述“提供什么”，运行入口负责注册“如何执行”。Shell 只读取规范化后的贡献项。首版 manifest 扫描限于构建时登记的内置包，不接受工作区上传的 JavaScript。

建议契约示意，字段名称将在 M1 的 schema 中冻结：

```ts
interface PluginManifestV1 {
  schemaVersion: 1;
  id: string;                     // 例如 nexus.prototype-designer
  version: string;                // 插件实现版本
  hostApiVersion: "1";            // 与产物 schemaVersion 不同
  dependencies: { id: string; versionRange: string }[];
  activationEvents: string[];     // onCommand / onResourceType / onAgentCapability
  contributes: {
    commands: CommandContribution[];
    editors: EditorContribution[];
    views: ViewContribution[];
    menus: MenuContribution[];
    resourceTypes: ResourceTypeContribution[];
    agentCapabilities: AgentCapabilityContribution[];
    artifactConsumers: ArtifactConsumerContribution[];
  };
  requestedCapabilities: string[];
}
```

所有 ID 使用插件命名空间，如 `nexus.prototype-designer.preview`。注册时拒绝重复 ID、未知编辑器引用、未知菜单位置、不支持的 Host API 主版本和循环依赖。菜单位置由平台提供有限枚举，如 `file`、`view`、`editor.toolbar`、`resource.context`；插件不能随意覆盖全局布局。

`when` 条件只能使用受限条件树，例如资源类型、当前编辑器、插件启用、任务空闲等，不执行字符串 JavaScript。它决定可见性；`enabledWhen` 决定可执行性。执行命令仍要检查真实状态，服务端再次检查权限和资源版本，不能依赖按钮是否置灰。

### 5.2 编辑器和命令的通用身份

`EditorInstance` 至少包含 `instanceId`、`editorType`、`workspaceId`、`resourceId`、`viewState`、`dirtyState`、`draftId`。同一资源可以有多个视图，但共享 Document Session，避免两个标签各自持有冲突正文。

`open(resourceRef, preferredEditor?)` 通过资源类型匹配已启用插件。没有匹配项时显示只读元信息和“启用相关插件”，数据不消失。关闭最后一个标签允许空工作区；关闭标签、隐藏面板、停用插件、删除资源是四种不同操作。

命令注册返回 `Disposable`，参数经 schema 校验。执行来源记录为菜单、快捷键、对话或 Agent，全部进入同一命令处理器。平台只提供通用 `saveActive`、`closeEditor`、`toggleSidebar` 等命令，其具体保存调用当前资源提供者。

### 5.3 两个插件应贡献什么

| 贡献项 | 原型插件 | PRD 插件 |
| --- | --- | --- |
| 编辑器 | 设计、结构化代码、交互预览 | 简报、正文、评审 |
| 资源类型 | `nexus.prototype` | `nexus.prd` |
| 常用命令 | 新建、预览、确认快照、发布产物 | 新建、编写、修订、评审、接收产物 |
| 侧栏 | 页面／图层、原型资源 | 文档／大纲、参考材料 |
| Agent 能力 | 生成原型、建议组件修改、说明交互 | 澄清、生成正文、修订、评审 |
| 交换产物 | 发布 `nexus.prototype.snapshot@1` | 消费 `nexus.prototype.snapshot@1` |

需求简报归 PRD 插件，但原型插件拥有自己的设计目标和场景输入；基础 Shell 不要求任何业务简报。原型与 PRD 插件互相是可选协作方，不形成硬依赖环。

## 6. 生命周期与工作区恢复

### 6.1 生命周期

```text
发现 manifest → 校验版本与依赖 → registered
                                  │ 触发需要的命令或编辑器
                                  ▼
                             activating
                              │      │
                          成功│      │失败：撤销本轮注册
                              ▼      ▼
                            active  failed → 用户重试
                              │
                    停用请求 → draining
                              │ 保存草稿、解绑视图、停止新增调用
                              ▼
                           disabled
```

`activate(context): Promise<Disposable>` 接收工作区隔离的服务端口；Host 保存注册产生的 disposable 集合。激活失败按逆序释放已注册资源。`deactivate` 应幂等，超时后 Host 仍移除该插件的 UI 贡献和事件监听，并报告残留任务，不谎报后台运行已停止。

Host API v1 至少提供 `commands`、`editors`、`resources`、`agents`、`artifacts`、`workspaceState`、`drafts`、`notifications`、`subscriptions` 和 `activationSignal`。插件不应获得整个宿主状态对象或数据库连接。

### 6.2 停用与运行任务

- 关闭编辑器：解绑显示，Document Session 与草稿保留，服务端任务继续。
- 隐藏侧栏：只影响布局，不触发生命周期释放。
- 停用插件：先在服务端将工作区插件标为不接收新 Invocation，然后等待本地草稿落盘并释放 UI 注册。保留通用任务面板用于查看或取消既有任务。
- 运行中的写任务：任务提案可以完成并保留，但提交阶段再次检查插件启用与资源授权；条件不再满足时进入等待／拒绝状态，不自动落入资源。不能承诺靠中止前端请求撤销已发生的模型调用。
- 卸载代码包：第一版仅部署时移除；有活动运行绑定旧版本时应阻止升级替换或保留兼容处理器，不允许新实现偷偷接管旧任务。

### 6.3 工作区与本地状态

`Workspace` 是用户组合工具的身份，不等于 PRD 文档 ID。保存启用插件及版本、固定快捷入口、资源集合、工作区设置 revision。布局、打开编辑器和视图状态按 `workspaceId + clientProfileId` 保存，以免手机布局覆盖桌面布局；本地缓存以用户主体再分区。

文档资源是服务器事实源；未保存草稿是带 `baseRevision` 的本地覆盖层；光标、缩放和面板尺寸是视图状态。首次恢复时先验证插件兼容和资源存在，再合并草稿提示。离线可以继续编辑已加载资源，但不能宣称已保存服务器。

JSON 输入即使尚未通过原型 schema，也应作为草稿保存；它不能进入正式资源版本或交接产物。标签可以关闭而不丢输入；显式放弃草稿才删除该覆盖层。刷新恢复不继续依赖隐藏一个 React 组件维持状态。

## 7. 统一 Agent 接口

### 7.1 为什么不能只保留 agentActions

现在四种动作的联合类型把 PRD 业务写进插件基础契约，不能表达第三个插件的能力，也无法统一澄清请求、组件修改和任务恢复。目标是**能力 ID + schema + 运行生命周期**，复用 NexusOS 的 AgentResolver 和 Runtime。

插件声明任务所需能力、允许的输入／产物、上下文提供器和默认交互方式。服务端处理器把能力请求转成既有任务，Resolver 选择可承接的 Agent。插件声明不是新的模型凭据配置，也不意味着每个插件启动一个 Agent 进程。

```ts
interface AgentInvocationRequestV1 {
  schemaVersion: 1;
  workspaceId: string;
  pluginId: string;
  capabilityId: string;
  clientRequestId: string;
  inputs: Record<string, unknown>;   // 由该能力的 inputSchema 验证
  resources: { resourceId: string; revision: number; scope: string[] }[];
  artifacts: { artifactId: string; digest: string }[];
  executionMode: "proposal" | "run";
}
```

服务端从已部署注册表解析实际插件／Agent 版本、主体、策略和预算；不能相信客户端提交的能力列表、角色、模型名或资源所属工作区。输入大纲可选，具体字段集合必须由版本化 schema 严格限制。

### 7.2 执行与输出

处理顺序：验证主体和工作区 → 检查插件启用与能力 → 固定输入资源版本 → 裁剪授权上下文 → schema 校验 → 绑定 Agent／Skill／运行策略 → 创建 Invocation → 执行 → 验证结果 → 形成产物或修改提案。

进度统一成事件 `{invocationId, sequence, type, timestamp, payload}`。sequence 在单次 Invocation 内递增；支持断线按游标补取，终态以持久化查询为准。Token 流只作显示，不作为可以逐段保存的业务数据。

状态统一为 `queued/running/waiting_confirmation/succeeded/failed/cancel_requested/cancelled/interrupted`。请求取消是状态转换，直到 Runtime 确认才为 `cancelled`。已有外部效果不能因取消而视为从未发生。

`retry` 创建新的 Invocation 并记录 `retryOf`，使用新的请求幂等键；`resume` 只有在适配器声明支持且检查点、输入版本与执行绑定仍兼容时才允许。首版不支持的恢复必须返回明确错误，不退化成隐藏的完整重跑。

结果为消息、诊断、不可变产物引用或 `ResourceChangeProposal`。提案绑定资源与 `baseRevision`，用户应用时平台进行 CAS 保存。节点 ID、允许字段和布局约束由原型处理器校验；Markdown 章节与交接标记由 PRD 处理器校验。Agent 不直接持有全局 `setBrief` 或数据库写句柄。

### 7.3 权限与上下文

授权求交：用户／工作区授权 ∩ 已部署插件声明 ∩ 能力允许范围 ∩ 此次明确的资源范围。选择一个组件时上下文默认限于该组件、页面元信息和明确关联的需求，不把所有打开文档、截图字节和聊天历史一起发送。

所有路径，包括菜单、快捷键、聊天、重启、恢复和插件协作，都调用同一 Invocation 入口。服务端策略是最终边界；界面的 enable/disable 是提示与交互约束。首版单用户部署应显式记录本地主体，不应声称已具有多租户认证；公网多人部署前另行完成身份与授权接入。

现有 `controlled_dynamic` PRD 流程通过适配器继续使用。`ai_dynamic` 只可规划已注册能力，并沿用原有计划验证／确认，不因插件化自动开放外部工具或跳过计划冻结。

## 8. 独立资源模型

### 8.1 分离资源、版本、草稿与产物

| 对象 | 身份与事实源 | 语义 |
| --- | --- | --- |
| Workspace | workspaceId，服务器 | 工具组合与资源集合 |
| Resource | resourceId + type + ownerPluginId，服务器 | 业务对象及当前 revision 指针 |
| ResourceVersion | resourceId + revision，不可变 | 一次有效保存的完整内容／摘要 |
| Draft | workspaceId + resourceId + clientId，本地优先 | 含 baseRevision 的未提交输入，可暂时不合法 |
| Artifact | artifactId + type + schemaVersion + digest，不可变 | 可交付、被验证的输入或结果 |
| Handoff | handoffId，服务器 | 某产物向某消费者和目标资源的交接状态 |

```text
Workspace ──包含── Resource ──拥有── ResourceVersion
    │                  ▲                 │
    ├──启用插件         │                 ├──确认／生成── Artifact
    └──客户端布局       │                 │                  │
                        │                 │                  ▼
Draft ──基于某revision─┘                 │               Handoff
                                          │                  │
                          PRD 新版本 ◀──应用结果── PRD 消费处理器
```

资源 envelope 保存通用字段；payload schema 属于插件。原型资源保存页面、设计目标和 Puck 结构；PRD 资源保存简报、正文、评审与产物引用。媒体不长期内嵌到每一版本的 JSON，迁移后采用内容摘要标识的 blob 引用。

### 8.2 并发与版本

保存携带 `expectedRevision`。服务端原子比较并追加新版本；不匹配返回 `409 revision_conflict`，包含当前 revision 及可取回差异的引用。禁止按“最后写入者胜出”覆盖另一个浏览器的修改。

新资源的创建有请求幂等键，防止重试生成两个资源。发布产物固定一个已有 ResourceVersion，而非“当前最新”；有未保存编辑时先保存有效版本，或明确选择上一个版本。确认需要记录 design revision、相关需求引用及其 digest、截图 digest；任一输入更新都不会篡改旧产物，只将新版本标为待确认。

`revision` 是新资源的一致性序号；旧 PRD 的 `version` 保留为历史显示信息，两者通过迁移映射关联，不能假设数值相等。

### 8.3 删除与引用

初期逻辑删除资源，不级联删除已被 PRD 引用的产物、历史版本或媒体。物理回收必须检查引用与保留策略。插件停用不删除数据。未知资源类型可显示通用身份、版本及导出能力，直到恢复兼容插件。

## 9. 版本化交接协议

### 9.1 协议核心

原型插件发布 `nexus.prototype.snapshot@1`；PRD 插件声明消费该类型。双方不 import 对方的实现。平台只校验 envelope、权限与引用完整性，业务内容校验由生产者／消费者处理器完成。

最小产物 envelope：`artifactId/type/schemaVersion/producerPluginId/producerPluginVersion/workspaceId/sourceResourceId/sourceRevision/createdAt/digest/payloadRef`。原型 payload 至少包含页面顺序、稳定页面与组件 ID、页面说明、交互摘要、截图引用与摘要、设计 schema 版本、确认时间和确认主体；可带已授权需求版本引用。

digest 对规范化序列化内容及引用媒体的内容摘要计算，排除存储地址等易变字段。数字格式、字段排序、空值处理与编码需要共享测试向量；不能让浏览器与 Python 各自随意 `JSON.stringify` 后假定摘要一致。

### 9.2 交接与确认过程

```text
用户           原型插件          平台资源／产物服务           PRD 插件／Agent
 │                 │                       │                         │
 ├─交给 PRD───────▶│                       │                         │
 │                 ├─校验并保存 r12───────▶│ CAS                      │
 │                 ├─按 r12 渲染截图──────▶│ 媒体暂存                 │
 │                 ├─确认发布快照─────────▶│ 校验引用并发布 a7        │
 │◀────展示页面数、版本、目标文档───────────┤                         │
 ├─确认交接───────────────────────────────▶│ 创建 Handoff h3          │
 │                 │                       ├─a7 + 目标版本 r5────────▶│
 │                 │                       │◀─正文／引用变更提案──────┤
 │◀──────────────────预览差异──────────────┤                         │
 ├─应用──────────────────────────────────▶│ CAS 写目标 r6            │
 │                 │                       │ 同事务记 receipt         │
 │◀──────────────────完成与来源链接────────┤                         │
```

复制既有原型章节可使用确定性处理器，不强制调用模型；生成完整 PRD 或重写章节才调用 PRD Agent。接收截图、更新引用和生成正文是可区分的动作，不能因用户点“交接”而隐藏启动高成本重写。

首版交接状态为 `pending/validating/waiting_confirmation/applying/succeeded/failed/cancelled`。审批绑定源 artifact digest、目标 revision 和变更提案 digest；任何一项变化都要重新校验和展示。

### 9.3 原子性与重复执行

用户操作提供 `clientRequestId`，服务端以工作区、消费者、目标资源及该请求 ID 做幂等约束。同一请求重试返回同一 Handoff，不能二次插入章节；同一 ID 携带不同请求体返回冲突。新的显式更新操作使用新的 ID。

应用目标资源变更和保存 receipt 在同一存储事务内完成，receipt 记录源版本、产物摘要、目标前后 revision、消费者版本、Invocation 及确认主体。`succeeded` 之后崩溃重试直接返回 receipt。消息可能重复投递，消费者依赖幂等记录获得一致效果，不声称消息传输“恰好一次”。

模型和截图生成在事务外执行。多页截图部分失败时保持暂存，不发布完整 Artifact；未引用媒体按保留策略回收。原型在截图期间变化时，仅允许发布明确绑定旧 revision 的快照，并在界面标注已非当前版本，不把它标记为最新已确认。

### 9.4 必须解释的失败

| 情况 | 行为 |
| --- | --- |
| PRD 插件未启用／消费版本不兼容 | 保留产物，提示启用或兼容升级，不创建半份文档 |
| 原型草稿未确认或缺少截图 | 列出待完成项，允许回编辑；不可用于正式 PRD 交接 |
| 源版本更新 | 旧快照仍可追溯；选择继续引用旧版或重新发布 |
| 目标被另一标签修改 | CAS 冲突，保留提案，重新对比后应用 |
| Agent 失败／取消 | 保留源产物和目标原版，失败任务可检查和显式重试 |
| 权限在运行期间被撤回 | 应用前复核拒绝；不向未授权用户泄露产物正文 |

## 10. 人类友好与效率原则

1. 启用插件后，命令只在相关资源和上下文中出现；完整命令仍可搜索，禁用项说明原因。
2. 工具打开当前工作区已有资源，不因点快捷栏重复创建文档。支持最近资源和恢复关闭标签。
3. Agent 对话明确显示当前资源、选中范围及写入方式。切换标签不迁移未确认提案的目标，不把旧回复应用到新资源。
4. 保存状态区分本地草稿、服务器已保存、冲突与离线；关闭视图不等于放弃草稿。
5. 交接前展示“源版本、页面数、截图状态、目标文档、将修改的范围”，正常路径一次确认；重复重试不重复确认已成功操作。
6. 专注模式保留退出按钮和键盘路径，退出恢复布局；隐藏窗口不会取消服务端任务。
7. 原型支持适应宽度与缩放，避免为看全画布反复关闭面板；缩放不改变设计尺寸或截图尺寸。

## 11. 关键取舍及未采用方案

| 选择 | 理由 | 成本或边界 |
| --- | --- | --- |
| 先做进程内 Host 与部署期插件注册 | 利用现有 React／Python，验证契约后再扩张 | 第三方不可信插件暂不支持 |
| 命令注册 + 类型化产物，非全局任意事件 | 调用来源、参数和变更可校验，减少隐式耦合 | 前期需要明确 schema 与消费者 |
| 复用 NexusOS Runtime | 统一预算、模型、事件与执行语义 | 需要把现有直接路由调用包进适配器 |
| 资源独立，旧 PRD 接口作兼容适配 | 原型能真正独立使用，保留历史链接 | 数据迁移比仅换页面成本高 |
| 草稿和正式版本分层 | 允许暂时无效代码而不污染交接产物 | 需要恢复、配额和冲突处理 |
| 原型／PRD 通过版本快照协作 | 可复现、可审计，不随源编辑静默变化 | 更新关联需要显式交接 |

不直接把现有整页复制成两个应用；这会继续复制保存与任务逻辑。不把所有状态塞入一个全局事件总线；这会隐藏依赖与写入顺序。不为每个插件启动独立微服务；现阶段没有证据支持其运维成本。

## 12. 架构完成门槛

- 关闭全部业务插件仍能启动空工作台、查看资源元信息和任务记录。
- 新增第三个测试插件只改自己的包及集中装配声明，Shell 和 PRD／原型实现无须修改。
- 所有 Agent 调用路径经过同一个服务端权限、版本、任务与追溯入口。
- 原型可以在没有 PRD 资源时创建、保存与运行 Agent；PRD 可在没有原型时编写。
- 两插件通过兼容 schema 的产物协作，重复交接不重复写入，冲突可恢复。
- 旧文档、截图、版本、历史任务和入口迁移可校验与回退；完成证据按阶段记录，不以 manifest 存在替代验收。
