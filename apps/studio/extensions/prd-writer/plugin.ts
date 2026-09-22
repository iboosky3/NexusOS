import type { StudioPlugin } from "@/lib/plugin-sdk/types";
import { prdAgentProfile } from "./agent-profile";

export const prdPlugin: StudioPlugin = {
  schemaVersion: 1, hostApiVersion: "1", dependencies: [],
  views: [{ id: "nexus.prd-writer.resources", label: "需求文档", icon: "#", load: () => import("./resource-view") }],
  commands: [{ id: "nexus.prd-writer.new", label: "新建PRD 编写", menu: "file", validate(args) { if (args !== undefined) throw new Error("此命令不接受参数"); } }],
  activate(context) {
    context.commands.register("nexus.prd-writer.new", async () => {
      const resource = await context.resources.create(prdPlugin.initialPayload());
      context.editors.open(resource);
    });
  },
  id: "nexus.prd-writer", name: "PRD 编写", resourceType: "nexus.prd", icon: "#",
  agent: prdAgentProfile,
  acceptsArtifacts: ["nexus.prototype.snapshot"],
  capabilities: [{ id: "draft", label: "编写草稿" }, { id: "revise", label: "修订文档" }, { id: "review", label: "评审" }, { id: "clarify", label: "澄清需求" }],
  validateDraft(payload) {
    const brief = payload.brief as Record<string, unknown> | null;
    if (!brief || ["title", "description", "audience", "problem", "scope", "constraints", "metrics", "template"].some((key) => typeof brief[key] !== "string") ||
        !Array.isArray(brief.sources) || brief.sources.some((item) => !item || typeof item.name !== "string" || typeof item.content !== "string") ||
        typeof payload.content !== "string" || !Array.isArray(payload.provenance)) throw new Error("PRD 草稿字段损坏，请下载备份后检查");
  },
  initialPayload: () => ({ brief: { title: "未命名 PRD", description: "", audience: "", problem: "", scope: "", constraints: "", metrics: "", template: "", sources: [] }, content: "", provenance: [] }),
  title: (payload) => String((payload.brief as { title?: string })?.title || "未命名 PRD"),
  load: () => import("./resource-editor"),
};
