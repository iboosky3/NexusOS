import type { AgentProfile } from "@/lib/plugin-sdk/agent";

export const prototypeAgentProfile: AgentProfile = {
  version: "1.0.0",
  launchCommand: "nexus.prototype-designer.new",
  summary: "围绕设计目标制作可交互页面，允许限定组件的 AI 建议；确认设计并生成截图后可交接给 PRD。",
  usage: [
    "打开或新建原型，填写目标与场景并编辑页面组件。",
    "选中组件后可请求限定范围的修改建议，检查后再应用。",
    "预览并确认设计，保存版本和截图，再选择 PRD 接收。",
  ],
  selection: "capability",
  stages: [
    { id: "goal", label: "设计目标", purpose: "明确页面、用户流程和交互约束。" },
    { id: "design", label: "页面设计", purpose: "生成或手工编辑结构化组件。", capability: "user_flow", participant: { id: "ux-designer", label: "用户体验设计师", description: "按用户流程能力参与；实际选择记录在运行追溯中。" } },
    { id: "component", label: "组件建议", purpose: "仅对选中组件提出限定字段的建议，由用户决定是否应用。" },
    { id: "confirm", label: "确认与截图", purpose: "检查交互、确认设计、保存截图和源版本。" },
    { id: "handoff", label: "版本化交接", purpose: "发布不可变快照，PRD 接收后记录来源和版本。" },
  ],
};
