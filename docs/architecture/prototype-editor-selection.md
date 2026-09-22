# 原型编辑器选型：GrapesJS、Puck、Penpot

更新：2026-09-22。比较对象分别是 **GrapesJS 开源内核及 Webpage Demo 组合**、**Puck 开源 React 编辑器**、**Penpot 开源设计平台**；Grapes Studio SDK 是另一款有许可证和会话额度的产品，不混入开源版本比较。[GrapesJS 官方 Demo](https://grapesjs.com/demo)、[Webpage Preset 源码](https://github.com/GrapesJS/preset-webpage)、[Studio SDK 免费档](https://grapesjs.com/sdk/pricing)。

## 对 NexusOS 的结论

目前维持 **GrapesJS 自由原型插件 + Puck 结构化原型插件** 两条路径，统一通过版本化 `nexus.prototype.snapshot` 交给 PRD。若目标是网页形态、丰富组件和灵活排版，优先 GrapesJS；若目标是 Agent 精确修改已知组件并稳定重放，优先 Puck。Penpot 适合高保真设计系统和设计师协作，作为未来独立设计服务评估，暂不取代应用内编辑器。这个判断依据下表与现有集成成本，是 NexusOS 的选型推论，不是产品厂商的承诺。

| 维度 | GrapesJS 开源版 | Puck 开源版 | Penpot 开源版 |
| --- | --- | --- | --- |
| 核心定位 | 网页／HTML 模板可视化编辑框架；官方 Webpage Demo 由 preset 和多个插件组合。 | 将应用自己的 React 组件配置为拖放编辑器，内容保存为组件类型及 props。 | 完整设计平台，画布、图层、组件、交互原型、评论与交付检查能力齐全。 |
| 画布自由度 | HTML/CSS 布局、尺寸、样式与定位灵活；更接近可运行网页。 | 自由度受预先注册的 React 组件及插槽限制；结构更可控。 | 无限画布和自由图形编辑最强；与网页运行时不是同一模型。 |
| 组件生态 | 内核模块和可选插件较多；官方演示含基础块、表单、导出等扩展。每个插件需单独核验兼容与安全。 | 直接复用 NexusOS 的 React 组件，需自己建设字段、插槽、样式与组件目录。 | 设计系统可复用主组件、实例和覆盖；不是直接复用 React 组件。 |
| Agent 改动粒度 | 可操作项目 JSON、组件树与样式；自由结构使校验、合并和安全边界更难。 | 组件类型与 props 的约束天然适合精确建议、差异比较和版本化审核。 | 可用 Penpot 插件 API 操作设计对象，但需要单独建立 Agent 适配、授权与产物同步。 |
| 与 PRD 交接 | NexusOS 已有独立资源、多页截图与版本化快照；最多 4 页受现有产物契约限制。 | NexusOS 已有独立原型资源、截图与版本化快照。 | 尚未接入 NexusOS；需设计文件／版本映射、截图、权限和双向同步。 |
| 集成／部署 | npm 嵌入当前 React 工作台，项目 JSON 由 NexusOS 保存；开源核心 BSD-3-Clause。 | React 组件直接嵌入 Next.js，数据由 NexusOS 保存；MIT。 | 独立前后端与数据库，通常通过 Docker／Kubernetes 自托管；MPL-2.0。 |
| 主要代价 | 官方 Demo 不等于单个 npm 包；多插件和任意 HTML/CSS 会扩大攻击面，需约束脚本、外链和媒体。 | 丰富度由自建组件库决定；不能直接得到 Penpot 式图形画布。 | 运维、账号和协作权限、跨系统资源同步成本最高；不能当作单个 React 编辑组件直接替换。 |

事实依据：[GrapesJS 文档](https://grapesjs.com/docs/)、[GrapesJS Demo 源码](https://github.com/GrapesJS/grapesjs/blob/gh-pages/demo.html)、[GrapesJS 许可证](https://github.com/GrapesJS/grapesjs/blob/dev/packages/core/LICENSE)；[Puck 文档](https://puckeditor.com/docs)、[组件配置](https://puckeditor.com/docs/integrating-puck/component-configuration)、[Puck 许可证](https://github.com/puckeditor/puck/blob/main/LICENSE)；[Penpot 界面](https://help.penpot.app/user-guide/first-steps/the-interface/)、[可复用组件](https://help.penpot.app/user-guide/design-systems/components/)、[插件 API](https://doc.plugins.penpot.app/)、[自托管](https://help.penpot.app/technical-guide/getting-started/)、[系统架构](https://help.penpot.app/technical-guide/developer/architecture/)、[Penpot 许可证](https://github.com/penpot/penpot/blob/develop/LICENSE)。

## 采用条件与下一次决策点

1. **保留数据边界**：每个编辑器持有自己的原始工程格式，NexusOS 只要求其输出版本化截图和页面说明；不要把 GrapesJS JSON、Puck 组件树或 Penpot 文件格式写死到 PRD 正文。这样以后换内核时，历史产物仍可追溯。
2. **验证真实任务**：用同一份 PRD 做列表／详情／表单、响应式布局、组件级 Agent 修改、冲突重试和版本回滚，记录完成时间、失败次数与人工修正量。当前没有这样的并排用户测试，不能宣称某编辑器总体最优。
3. **GrapesJS 的边界**：已提交的版本以 GrapesJS 开源内核为基础；Webpage Preset 和多个开源扩展目前仅在未提交工作树中，尚未完成回归。为保护 NexusOS 同源工作台，原始 HTML 导入、用户脚本、外部媒体和依赖脚本的演示组件暂不开放。若这些能力成为必须项，先设计独立源隔离与媒体服务，再扩展资源协议。进度见[当日开发日志](../development/2026-09-22-grapesjs.md)。
4. **Penpot 的触发条件**：需要完整的高保真设计系统、跨团队设计协作或专业矢量工具，且能承担独立部署和身份／版本／交接适配时，启动单独 PoC。
