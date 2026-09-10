# Studio 通用工作台与工具接入

## 页面边界

首页负责选择工具，“编写 PRD”使用带 `target="_blank"` 和 `rel="noopener noreferrer"` 的链接打开 `/prd-studio`。首页不采集、预填或通过 URL 传递产品想法；文字入口仅按 PRD 相关关键词匹配已开放工具，不是模型意图识别服务。

`/prd-studio` 是新版工具页面，`/prd` 保留。两者使用同一套文档、任务、版本和追溯 API；新版浏览器草稿有独立的 `sessionStorage` 命名空间。旧版只提供基础 Markdown 展示，不承诺解析新流程图格式。`AppShell` 根据路径让 Studio 使用自己的全屏布局，避免旧导航在覆盖层下仍能获得键盘焦点。

## 组件分层

| 层 | 文件（相对 `apps/studio`） | 责任 |
| --- | --- | --- |
| 通用容器 | `components/workbench/workbench.tsx` | 菜单、命令搜索、活动栏、可收起侧栏、编辑区、对话区、底部面板、状态栏 |
| 通用页签与标题 | 同文件的 `EditorTabs`、`PanelHeading` | 受控页签与面板标题，不读取业务状态 |
| 能力清单 | `components/workbench/capability-browser.tsx` | 接收注册数据，搜索、展开版本与能力信息、标记已选用项 |
| 图文展示 | `components/workbench/document-renderer.tsx` | 安全 Markdown/GFM、图片、声明式流程图、浏览器图片压缩 |
| 通用文本编辑器 | `components/workbench/markdown-editor.tsx` | 受控 Markdown 编辑、预览、分屏、选区格式化；业务按钮与空态通过插槽传入 |
| PRD 状态 | `lib/use-prd-studio.tsx` | 简报、保存、草稿、导入导出、任务 SSE、版本、恢复和错误处理 |
| PRD 模块 | `components/prd-studio/` | 分组简报编辑器、澄清与修订对话、业务样式 |
| PRD 页面 | `app/prd-studio/page.tsx` | 组合通用容器与业务模块，定义 PRD 菜单、命令、工具栏和素材页 |

通用容器不依赖 `/api/prd`、PRD 字段、数据库或模型供应商。所有业务内容通过 `ReactNode` 插槽传入：`toolbar`、`sidebar`、`children`、`assistant`、`bottom`、`status`、`statusRight`。容器仅持有布局和命令搜索状态；折叠对话区保持组件挂载，避免丢失未完成请求和待应用建议。

命令使用 `{ id, label, run, disabled }`；菜单与命令搜索共享命令定义，调用方负责权限、并发锁和错误显示。视图使用 `{ id, label, icon }`，通过 `activeView` 与 `onView` 控制业务面板。`EditorTabs` 使用 `value` / `onChange` 控制标签。侧栏支持浏览器原生宽度调整；窄屏可折叠面板并横向滚动工作区，完整菜单操作仍可通过命令搜索访问。

## 接入第二种工具

1. 新建路由，例如 `app/research-studio/page.tsx`，在 `AppShell` 中声明该工具使用独立工作台布局，再添加首页链接。
2. 新建该工具自己的状态 hook 和 API 边界，不复制 PRD 的字段、任务动作或存储键。
3. 导入 `Workbench`，传入工具名称、菜单和命令，将资料列表、编辑器、助手和执行进度分别填入插槽。
4. 复用 `EditorTabs`、`PanelHeading`、`MarkdownEditor` 与 `DocumentRenderer`；能力注册信息结构相同才复用 `CapabilityBrowser`。
5. 用真实接口控制禁用状态和进度；未实现的外部服务明确说明，不渲染会假装成功的按钮。

容器不预设“所有工具都生成 Markdown”。表格、画布、代码编辑器都可放在中间插槽。当前顺序流程图只是可复用的轻量组件；接入专业绘图服务时应由业务模块负责请求、权限、产物与任务追溯，容器保持不变。

## 澄清与生成

`POST /v1/prd/assistant` 接收可为空的简报、当前消息、最多 8 条历史消息和思考开关。服务端验证结构、字段名和合并后的字段长度；返回回答及建议，不写入文档。前端展示建议并在应用前检测字段冲突。模型连接失败、截断或返回非法结构时提示重试，不用固定回复冒充模型成功。

澄清使用一次有超时的模型调用，完成后显示回答；正式生成、修订、评审沿用持久任务与 SSE，保留失败、停止、检查点恢复和版本追溯。DeepSeek 思考参数按下一次请求生效，运行期间开关仅改变已返回内容的显示。服务端密钥不进入浏览器。

## 媒体与保存

图片在浏览器压缩后以受限的 `data:image` URL 写入 Markdown。Python `prd/media.py` 在模型调用前将图片编码替换成稳定哈希引用，发布前恢复原始图像，并保留模型遗漏的原文图片。流程图使用 `nexus-flow` 代码块和声明式 SVG，预览禁用原始 HTML；不执行上传的 SVG 或任意脚本。文本模型并未读取图片像素。

正文及媒体总计最多 200,000 字符，超限不发布；图片原文件最多 8 MB，压缩最长边 960 像素。更大的素材库、对象存储、图像理解和生成式绘图是后续扩展。Markdown 导出保留源格式，HTML 导出可直接显示图片和流程图。

详细操作与部署边界见[写作工作区指南](../reference-apps/nexus-prd/authoring.md)。接口回归位于 `tests/integration/test_prd_studio.py`，覆盖空白简报、建议校验、历史限制、思考参数、错误脱敏和图文修订。
