import type { StudioPlugin } from "@/lib/plugin-sdk/types";

export const prdPlugin: StudioPlugin = {
  schemaVersion: 1, hostApiVersion: "1", dependencies: [],
  commands: [{ id: "nexus.prd-writer.new", label: "新建PRD 编写", menu: "file", validate(args) { if (args !== undefined) throw new Error("此命令不接受参数"); } }],
  activate(context) {
    context.commands.register("nexus.prd-writer.new", async () => {
      const resource = await context.resources.create(prdPlugin.initialPayload());
      context.editors.open(resource);
    });
  },
  id: "nexus.prd-writer", name: "PRD 编写", resourceType: "nexus.prd", icon: "#",
  acceptsArtifacts: ["nexus.prototype.snapshot"],
  capabilities: [{ id: "draft", label: "编写草稿" }, { id: "revise", label: "修订文档" }, { id: "review", label: "评审" }, { id: "clarify", label: "澄清需求" }],
  initialPayload: () => ({ brief: { title: "未命名 PRD", description: "", audience: "", problem: "", scope: "", constraints: "", metrics: "", template: "", sources: [] }, content: "", provenance: [] }),
  title: (payload) => String((payload.brief as { title?: string })?.title || "未命名 PRD"),
  load: () => import("./resource-editor"),
};
