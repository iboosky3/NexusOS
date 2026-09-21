import type { WorkbenchExtension } from "@/lib/workbench-extensions";
import type {
  PrototypeDesign,
  PrototypePage,
  PrototypeSelection,
} from "@/lib/prototype";

export interface DesignerProps {
  page: PrototypePage;
  pages: PrototypePage[];
  disabled: boolean;
  onChange: (design: PrototypeDesign) => void;
  onSelection?: (selection: PrototypeSelection | null) => void;
}

export const prototypeDesigner: WorkbenchExtension<DesignerProps> = {
  manifest: {
    id: "nexus.prototype-designer",
    name: "原型设计器",
    version: "1.0.0",
    description: "拖拽组件组装页面，预览交互并生成截图。基于 Puck 开源编辑器。",
    license: "MIT · Puck",
    homepage: "https://github.com/puckeditor/puck",
    capabilities: ["prototype.edit", "prototype.capture"],
  },
  load: () => import("./editor"),
};
