import type { StudioPlugin } from "@/lib/plugin-sdk/types";

/** Example extension: only this folder and the assembly registration are needed in the UI. */
export const notesPlugin: StudioPlugin = {
  id: "nexus.example-notes", name: "示例便签", resourceType: "nexus.note", icon: "✎",
  schemaVersion: 1, hostApiVersion: "1", dependencies: [],
  commands: [{ id: "nexus.example-notes.new", label: "新建示例便签", menu: "file",
    validate(args) { if (args !== undefined) throw new Error("此命令不接受参数"); } }],
  views: [{ id: "nexus.example-notes.resources", label: "便签列表", icon: "✎", load: () => import("./view") }],
  capabilities: [{ id: "revise", label: "整理便签" }],
  initialPayload: () => ({ title: "未命名便签", content: "" }),
  title: (payload) => String(payload.title || "未命名便签"),
  load: () => import("./editor"),
  activate(context) {
    context.commands.register("nexus.example-notes.new", async () => {
      context.editors.open(await context.resources.create(notesPlugin.initialPayload()));
    });
  },
};
