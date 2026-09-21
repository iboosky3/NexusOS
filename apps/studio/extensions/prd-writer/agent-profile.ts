import type { AgentProfile } from "@/lib/plugin-sdk/agent";

/** This graph describes the existing controlled PRD workflow; a run records actual selections. */
export const prdAgentProfile: AgentProfile = {
  version: "1.0.0",
  launchCommand: "nexus.prd-writer.new",
  summary: "从需求简报出发，经过需求分析、流程与技术检查、分段编写和质量评审，形成可人工确认的 PRD。",
  usage: [
    "打开或新建 PRD，填写需求简报与参考材料。",
    "在 Agent 能力中选择编写、修订或评审；发送后从任务记录打开工作流，检查阶段与评审意见。",
    "需要原型时先确认设计，再将版本化设计产物交给 PRD。",
  ],
  selection: "capability",
  stages: [
    { id: "intake", label: "需求输入", purpose: "简报、参考材料与已确认约束；用户负责确认。" },
    { id: "requirements", label: "需求与范围", purpose: "梳理功能、边界和待决策问题。", capability: "requirement_analysis", participant: { id: "product-manager", label: "产品经理", description: "按需求分析能力参与，运行时由能力解析器选择。" } },
    { id: "ux", label: "流程与交互", purpose: "检查主路径、异常分支与页面要求。", capability: "user_flow", participant: { id: "ux-designer", label: "用户体验设计师", description: "按用户流程能力参与；原型 Agent 也可使用这一能力。" } },
    { id: "technical", label: "技术与风险", purpose: "评估数据、权限、接口和可行性。", capability: "technical_design", participant: { id: "architect", label: "系统架构师", description: "按技术设计能力参与，不直接修改资源。" } },
    { id: "writing", label: "分段编写", purpose: "分段生成并校验 PRD 结构与追溯。", capability: "prd_generation", participant: { id: "writer", label: "文档撰写智能体", description: "按 PRD 编写能力参与，输出仍需评审。" } },
    { id: "review", label: "质量评审", purpose: "检查验收标准、一致性和待确认事项。", capability: "quality_review", participant: { id: "reviewer", label: "质量评审智能体", description: "提供辅助评审，不能代替人工验收。" } },
    { id: "output", label: "保存版本", purpose: "人工检查后保存资源版本，必要时交接原型来源。" },
  ],
};
