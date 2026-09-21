import type { WorkbenchExtension } from "@/lib/workbench-extensions";
import type {
  PrototypeDesign,
  PrototypePage,
  PrototypeSelection,
  PrototypePatchRequest,
} from "@/lib/prototype";

export interface DesignerProps {
  draftStorageKey?: string;
  page: PrototypePage;
  pages: PrototypePage[];
  disabled: boolean;
  onChange: (design: PrototypeDesign) => void;
  onPageChange: (patch: Partial<Pick<PrototypePage, "title" | "description">>) => void;
  onSelection?: (selection: PrototypeSelection | null) => void;
  componentPatch?: PrototypePatchRequest | null;
  onPatchApplied?: (error?: string) => void;
}

export const prototypeDesigner: WorkbenchExtension<DesignerProps> = {
  manifest: {
    id: "nexus.prototype-designer",
    contributions: {
      schemaVersion: 1, hostApiVersion: "1", dependencies: [],
      commands: ["prototype", "image"].map((legacyCommand) => ({ id: `nexus.prototype-designer.command.${legacyCommand}`, legacyCommand })),
      editors: [{ id: "nexus.prototype-designer.canvas", legacyTab: "prototype", label: "原型设计", icon: "▧" }],
      launcher: { id: "nexus.prototype-designer.launch", label: "原型", icon: "▧", editorId: "nexus.prototype-designer.canvas" },
    },
    name: "原型设计器",
    version: "1.0.0",
    description: "拖拽组件组装页面，预览交互并生成截图。基于 Puck 开源编辑器。",
    license: "MIT · Puck",
    homepage: "https://github.com/puckeditor/puck",
    capabilities: ["prototype.edit", "prototype.capture"],
    agentActions: ["prototype"],
  },
  load: () => import("./editor"),
};
