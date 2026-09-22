import type { WorkbenchExtension } from "@/lib/workbench-extensions";

/** Entry in the current PRD Studio shell; the editor keeps its own resource store. */
export const grapesPrototypeLegacy: WorkbenchExtension<Record<string, never>> = {
  manifest: {
    id: "nexus.grapes-prototype",
    contributions: {
      schemaVersion: 1, hostApiVersion: "1", dependencies: [],
      editors: [{ id: "nexus.grapes-prototype.editor", legacyTab: "grapes", label: "自由原型", icon: "▦" }],
      launcher: { id: "nexus.grapes-prototype.launch", label: "自由原型", icon: "▦", editorId: "nexus.grapes-prototype.editor" },
    },
    name: "自由原型试验",
    version: "0.1.0",
    description: "使用 GrapesJS 自由布局组件，独立保存原型资源和版本快照。",
    license: "BSD-3-Clause · GrapesJS",
    homepage: "https://grapesjs.com/",
    capabilities: ["prototype.edit", "prototype.capture"],
  },
  load: () => import("./legacy-bridge"),
};
