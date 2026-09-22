import { registerResourcePlugins } from "@/lib/extension-host/resource-registry";
import { grapesPrototypePlugin } from "./grapes-prototype/plugin";
import { notesPlugin } from "./example-notes/plugin";
import { prdPlugin } from "./prd-writer/plugin";
import { prototypePlugin } from "./prototype-designer/plugin";

/** The only domain assembly dependency of the resource workbench. */
export const studioPlugins = registerResourcePlugins([prdPlugin, prototypePlugin, notesPlugin, grapesPrototypePlugin]);
