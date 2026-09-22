import { validateDesign, type Prototype } from "@/lib/prototype";
import type { StudioPlugin } from "@/lib/plugin-sdk/types";
import { componentInput } from "./capability-input";
import { prototypeAgentProfile } from "./agent-profile";

export const prototypePlugin: StudioPlugin = {
  schemaVersion: 1, hostApiVersion: "1", dependencies: [],
  views: [{ id: "nexus.prototype-designer.resources", label: "原型资源", icon: "▧", load: () => import("./resource-view") }],
  commands: [{ id: "nexus.prototype-designer.new", label: "新建原型设计", menu: "file", validate(args) { if (args !== undefined) throw new Error("此命令不接受参数"); } }],
  activate(context) {
    context.commands.register("nexus.prototype-designer.new", async () => {
      const resource = await context.resources.create(prototypePlugin.initialPayload());
      context.editors.open(resource);
    });
  },
  id: "nexus.prototype-designer", name: "原型设计", resourceType: "nexus.prototype", icon: "▧",
  agent: prototypeAgentProfile,
  capabilities: [{ id: "design", label: "设计原型" }, { id: "revise", label: "修改原型" }, { id: "review", label: "评审设计" }, { id: "component", label: "修改选中组件", prepareInput: componentInput }],
  validateDraft(payload) {
    if (typeof payload.title !== "string" || typeof payload.description !== "string") throw new Error("原型草稿字段损坏，请下载备份后检查");
    const prototype = payload.prototype as Prototype | null;
    if (prototype === null) return;
    if (!prototype || !Array.isArray(prototype.pages) || !prototype.pages.length) throw new Error("原型草稿页面损坏，请下载备份后检查");
    for (const page of prototype.pages) {
      if (!page || typeof page.id !== "string" || typeof page.title !== "string" || typeof page.description !== "string" || typeof page.screenshot !== "string" || !Array.isArray(page.elements)) throw new Error("原型草稿页面字段损坏");
      if (page.design) validateDesign(page.design);
    }
  },
  initialPayload: () => ({ title: "未命名原型", description: "", prototype: null }),
  title: (payload) => String(payload.title || "未命名原型"),
  load: () => import("./resource-editor"),
};
