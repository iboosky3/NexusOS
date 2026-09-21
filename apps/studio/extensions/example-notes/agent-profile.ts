import type { AgentProfile } from "@/lib/plugin-sdk/agent";

export const notesAgentProfile: AgentProfile = {
  version: "1.0.0",
  launchCommand: "nexus.example-notes.new",
  summary: "示例便签插件，展示第三个 Agent 插件无需修改工作台即可贡献资源与 AI 能力。",
  usage: ["启用插件并新建便签。", "输入整理要求，检查提案后确认应用。"],
  selection: "capability",
  stages: [
    { id: "input", label: "便签输入", purpose: "保存当前便签版本。" },
    { id: "revise", label: "整理提案", purpose: "按指令生成待批准内容。", capability: "structured_writing" },
    { id: "apply", label: "人工应用", purpose: "检查提案并确认写入。" },
  ],
};
