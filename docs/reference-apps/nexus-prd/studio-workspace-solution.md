# Nexus PRD Studio 工作区改造方案

## 1. 目标

Nexus PRD Studio 将现有“提交产品构想并查看编排结果”的参考应用，扩展为可持续编辑的产品需求工作台。工作台需要把需求、PRD、可运行原型、截图、AI 对话和评审结果放在同一个项目上下文中，并保证每次关键操作可定位、可解释、可回退。

首期交付聚焦一条完整链路：

1. 在项目工作区中直接编辑 PRD。
2. 使用自然语言或代码生成 HTML 原型。
3. 在隔离的内嵌沙盒中实时运行原型。
4. 选中原型组件，修改常见布局和尺寸属性。
5. 将当前原型状态作为截图引用插入 PRD。
6. 在头脑风暴和专业模式之间切换。
7. 记录文档、原型、截图和 AI 操作的追溯事件。

## 2. 现有能力与改造边界

现有 NexusOS 已具备 Agent、Skill、模型网关、任务编排、质量门和运行产物能力。它们继续负责复杂的专业 PRD 生成与评审，不进入前端编辑器内部。

Studio 当前是运行控制台。改造后保留总览和运行详情，并新增独立工作区路由：

```text
/projects/{projectId}/workspace
```

工作区中的高频操作不触发完整多智能体编排：

- 文本编辑、拖拽、属性修改和代码预览在本地即时完成；
- 局部 AI 修改使用直接模型调用；
- 首次完整生成、专业评审和一致性检查使用现有编排链路。

## 3. 交互架构

工作区采用三栏布局：

| 区域 | 内容 |
|---|---|
| 左侧资源栏 | PRD 章节、原型页面、截图和版本入口 |
| 中央工作区 | PRD、设计、运行、代码和分屏视图 |
| 右侧检查器 | AI 助手、组件属性、交互配置和事件记录 |

顶部提供模式、保存状态、撤销重做、运行预览和截图入口。

### 3.1 统一原型模型

原型不能长期只保存一段 HTML。系统以结构化 `PrototypeNode` 树作为可视化编辑的数据源，同时保存编译后的 HTML：

```text
组件面板 ─┐
画布拖拽 ─┼──> PrototypeNode ──> HTML/CSS 编译 ──> iframe
属性面板 ─┘
```

首期允许直接编辑完整 HTML，以验证生成和运行链路；后续逐步让代码修改经过 AST 转换回结构化模型。无法安全转换的代码标记为“代码托管模式”，继续支持运行，但暂停画布级修改。

### 3.2 运行沙盒

生成内容使用带 `sandbox="allow-scripts"` 的 iframe 运行，不使用 `dangerouslySetInnerHTML` 注入 Studio 宿主页面。宿主与原型通过 `postMessage` 交换选中组件和交互事件。

原型元素使用稳定 ID：

```html
<button data-prototype-node-id="submit-order">提交订单</button>
```

稳定 ID 同时用于属性修改、操作记录、截图引用和 PRD 反向定位。

## 4. AI 模式

### 4.1 头脑风暴模式

- 使用直接模型调用；
- 较高随机性和较短输出；
- 优先快速给出多个方案；
- 允许基于显式假设继续生成；
- 不自动执行完整质量门。

### 4.2 专业模式

- 使用现有 PRD Planner 和多智能体工作流；
- 加载项目 PRD、原型摘要和历史决策；
- 执行需求、用户流程、技术方案及质量评审；
- 输出阻断问题、变更影响和验收标准；
- 保留运行 ID，并与产生的文档版本关联。

## 5. 数据模型

新增以下聚合：

### ProjectWorkspace

- `project_id`
- `title`
- `ai_mode`
- `active_document_id`
- `active_prototype_id`
- `updated_at`

### PrdDocument

- `id`
- `project_id`
- `blocks`
- `version`
- `source_run_id`
- `created_at`
- `updated_at`

### PrototypeDocument

- `id`
- `project_id`
- `node_tree`
- `compiled_html`
- `version`
- `source_run_id`
- `created_at`
- `updated_at`

### ScreenshotReference

- `id`
- `project_id`
- `prototype_id`
- `prototype_version`
- `node_id`
- `object_key` 或 `data_url`
- `purpose`
- `precondition`
- `expected_result`
- `prd_block_id`

截图保存原型版本。原型版本变大后，系统可以确定性地提示截图可能过期。

## 6. 日志与过程追溯

业务追溯不能依赖普通文本日志。系统新增只追加的 `WorkspaceEvent`，并继续保留现有运行遥测。

每个事件至少包含：

- `event_id`：全局唯一标识；
- `project_id`：所属项目；
- `sequence`：项目内严格递增序号；
- `occurred_at`：服务端时间；
- `actor_type` 与 `actor_id`：用户、Agent 或系统；
- `action`：规范化动作名称；
- `resource_kind`、`resource_id`、`resource_version`；
- `correlation_id`：一次用户意图形成的操作链；
- `causation_id`：直接触发该事件的上游事件；
- `run_id`：关联 NexusOS 编排运行；
- `summary`：适合人阅读的说明；
- `metadata`：结构化差异、组件 ID、模式和客户端信息。

首期动作集合：

```text
workspace.created
workspace.mode_changed
prd.updated
prototype.created
prototype.updated
prototype.previewed
prototype.component_selected
screenshot.captured
screenshot.inserted
assistant.requested
assistant.responded
assistant.failed
review.requested
review.completed
```

### 6.1 追溯链示例

```text
assistant.requested
  correlation_id = edit-42
        ↓ causation_id
assistant.responded
        ↓
prototype.updated (version 7)
        ↓
screenshot.captured (prototype version 7)
        ↓
screenshot.inserted (PRD version 12)
```

使用该链路可以回答：谁提出了什么意图、模型使用了哪种模式、修改了哪个版本、哪张截图来自哪个原型状态、最终插入了哪个 PRD 版本。

### 6.2 内容差异与隐私

- 事件默认保存摘要和字段级 diff，不重复存储完整文档；
- 完整内容由版本存储负责；
- Prompt、模型响应和截图遵循项目数据分级；
- 密钥、Cookie 和授权头禁止写入事件 metadata；
- 服务端日志输出 `event_id`、`correlation_id` 和 `run_id`，实现业务事件与技术日志关联。

## 7. API 设计

```http
POST /v1/workspaces
GET  /v1/workspaces/{project_id}
PUT  /v1/workspaces/{project_id}/mode

PUT  /v1/workspaces/{project_id}/prd
POST /v1/workspaces/{project_id}/prototypes
PUT  /v1/workspaces/{project_id}/prototypes/{prototype_id}

POST /v1/workspaces/{project_id}/screenshots
POST /v1/workspaces/{project_id}/assistant
GET  /v1/workspaces/{project_id}/events
```

所有写接口接收可选的 `X-Correlation-ID`。客户端未提供时由服务端生成。响应返回更新后的资源版本和事件 ID。

版本更新使用乐观锁：客户端提交 `expected_version`；版本不一致时返回 `409 Conflict`，避免后台 AI 更新覆盖用户刚完成的编辑。

## 8. 安全要求

- iframe 默认只允许脚本，不允许同源访问、表单提交、弹窗和顶层导航；
- AI 生成内容在保存前做 schema 校验；
- 预览 HTML 设置内容安全策略，默认禁止网络请求；
- 上传截图限制媒体类型和大小；
- 所有工作区查询必须受租户与项目权限过滤；
- 审计事件只追加，不提供普通更新和删除接口。

## 9. 分阶段交付

### 阶段一：可运行闭环

- 工作区三栏页面；
- PRD 直接编辑；
- HTML 代码实时预览；
- 基础组件插入；
- 常用属性修改；
- 模式切换；
- 截图引用插入 PRD；
- 内存工作区接口与事件时间线；
- 单元及接口测试。

### 阶段二：结构化设计器

- 完整 `PrototypeNode` 树；
- 拖拽排序、嵌套和约束布局；
- 属性、代码、画布三向同步；
- 对象存储截图；
- PostgreSQL 持久化和版本表；
- 截图过期检测。

### 阶段三：专业交付

- 操作录制生成 PRD 流程；
- PRD/原型/验收标准覆盖地图；
- 一致性评审和影响分析；
- 多人评论、权限与版本对比；
- 设计系统和业务组件库。

## 10. 验收标准

1. 用户可以在一个页面内编辑 PRD 和 HTML 原型。
2. HTML 修改后无需打开外部浏览器即可看到结果。
3. 用户可以插入基础组件并修改宽度、内边距和对齐方式。
4. 用户可以切换头脑风暴与专业模式，模式变更有事件记录。
5. 用户可以创建截图引用并插入 PRD 指定位置。
6. 每次保存产生新版本，并可以通过事件列表确定操作者、资源和因果关系。
7. 原有 PRD 运行创建、列表和详情接口继续通过测试。
