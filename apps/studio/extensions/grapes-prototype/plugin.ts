import type { StudioPlugin } from "@/lib/plugin-sdk/types";

/** An opt-in, manually operated editor; its data and lifecycle are independent of Puck. */
export const grapesPrototypePlugin: StudioPlugin = {
  id: "nexus.grapes-prototype", name: "自由原型试验", resourceType: "nexus.grapes-prototype", icon: "▦",
  schemaVersion: 1, hostApiVersion: "1", dependencies: [],
  commands: [{ id: "nexus.grapes-prototype.new", label: "新建自由原型（试验）", menu: "file",
    validate(value) { if (value !== undefined) throw new Error("此命令不接受参数"); } }],
  views: [{ id: "nexus.grapes-prototype.resources", label: "自由原型", icon: "▦", load: () => import("./view") }],
  capabilities: [],
  validateDraft(payload) {
    if (typeof payload.title !== "string" || typeof payload.description !== "string" ||
        typeof payload.projectJson !== "string" || typeof payload.screenshot !== "string" ||
        typeof payload.screenshotProjectDigest !== "string" || typeof payload.confirmed !== "boolean") {
      throw new Error("自由原型草稿字段损坏，请下载备份后检查");
    }
  },
  initialPayload: () => ({ title: "未命名自由原型", description: "", projectJson: "{}", screenshot: "", screenshotProjectDigest: "", confirmed: false }),
  title: (payload) => String(payload.title || "未命名自由原型"),
  load: () => import("./editor"),
  activate(context) {
    context.commands.register("nexus.grapes-prototype.new", async () => {
      context.editors.open(await context.resources.create(grapesPrototypePlugin.initialPayload()));
    });
  },
};
