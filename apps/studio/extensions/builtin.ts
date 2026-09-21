import { prdWriter } from "./prd-writer/manifest";
import { prototypeDesigner } from "./prototype-designer/manifest";
import { createExtensionRegistry } from "../lib/extension-host/registry";

/** Single assembly point for bundled plugin contributions. */
export const builtinRegistry = createExtensionRegistry([
  prototypeDesigner.manifest,
  prdWriter.manifest,
]);
