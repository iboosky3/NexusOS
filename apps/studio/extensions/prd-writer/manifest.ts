import type { ComponentProps } from "react";
import type { MarkdownEditor } from "@/components/workbench/markdown-editor";
import type { WorkbenchExtension } from "@/lib/workbench-extensions";

export const prdWriter: WorkbenchExtension<ComponentProps<typeof MarkdownEditor>> = {
  manifest: {
    id: "nexus.prd-writer",
    name: "PRD 编写",
    version: "1.0.0",
    description: "编写和预览 PRD，接收已确认原型，由现有 Agent 工作流生成、修订和评审。",
    license: "项目内置",
    homepage: "/prd-studio",
    capabilities: ["prd.edit", "prd.generate", "prd.revise", "prd.review", "prototype.receive"],
    agentActions: ["generate", "revise", "review"],
  },
  load: () => import("@/components/workbench/markdown-editor").then(
    ({ MarkdownEditor }) => ({ default: MarkdownEditor }),
  ),
};
