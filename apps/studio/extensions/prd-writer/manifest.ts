import type { ComponentProps } from "react";
import type { MarkdownEditor } from "@/components/workbench/markdown-editor";
import type { WorkbenchExtension } from "@/lib/workbench-extensions";

export const prdWriter: WorkbenchExtension<ComponentProps<typeof MarkdownEditor>> = {
  manifest: {
    id: "nexus.prd-writer",
    contributions: {
      schemaVersion: 1, hostApiVersion: "1", dependencies: [],
      commands: ["new", "import", "export-md", "export-html", "brief", "edit", "split", "flow", "clarify", "generate", "review", "sources", "open-prd"].map((legacyCommand) => ({ id: `nexus.prd-writer.command.${legacyCommand}`, legacyCommand })),
      editors: [
        { id: "nexus.prd-writer.brief", legacyTab: "brief", label: "需求简报", icon: "▤" },
        { id: "nexus.prd-writer.document", legacyTab: "document", label: "PRD.md", icon: "#" },
        { id: "nexus.prd-writer.drawing", legacyTab: "drawing", label: "流程图", icon: "⌘" },
        { id: "nexus.prd-writer.assets", legacyTab: "assets", label: "参考材料", icon: "♧" },
      ],
      launcher: { id: "nexus.prd-writer.launch", label: "PRD", icon: "#", editorId: "nexus.prd-writer.document" },
    },
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
