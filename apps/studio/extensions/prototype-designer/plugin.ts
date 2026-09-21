import type { StudioPlugin } from "@/lib/plugin-sdk/types";

export const prototypePlugin: StudioPlugin = {
  schemaVersion: 1, hostApiVersion: "1", dependencies: [],
  commands: [{ id: "nexus.prototype-designer.new", label: "新建原型设计", menu: "file", validate(args) { if (args !== undefined) throw new Error("此命令不接受参数"); } }],
  activate(context) {
    context.commands.register("nexus.prototype-designer.new", async () => {
      const resource = await context.resources.create(prototypePlugin.initialPayload());
      context.editors.open(resource);
    });
  },
  id: "nexus.prototype-designer", name: "原型设计", resourceType: "nexus.prototype", icon: "▧",
  capabilities: [{ id: "design", label: "设计原型" }, { id: "revise", label: "修改原型" }, { id: "review", label: "评审设计" }],
  initialPayload: () => ({ title: "未命名原型", description: "", prototype: null }),
  title: (payload) => String(payload.title || "未命名原型"),
  load: () => import("./resource-editor"),
};
