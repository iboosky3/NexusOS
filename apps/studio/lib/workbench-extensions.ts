"use client";

import { ComponentType, useEffect, useState } from "react";

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  homepage: string;
  capabilities: string[];
  agentActions?: ("generate" | "revise" | "review" | "prototype")[];
}
export interface WorkbenchExtension<Props> {
  manifest: ExtensionManifest;
  load: () => Promise<{ default: ComponentType<Props> }>;
}

/** Bundled trusted extensions; enabling does not download or execute remote code. */
export function useWorkbenchExtensions() {
  const [disabled, setDisabled] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [pinned, setPinned] = useState<string[]>(["nexus.prototype-designer", "nexus.prd-writer"]);
  useEffect(() => {
    try {
      const pins = JSON.parse(localStorage.getItem("nexus-workbench:pinned-extensions:v1") || "null");
      if (Array.isArray(pins)) setPinned(pins.filter((id): id is string => typeof id === "string"));
      const saved = JSON.parse(
        localStorage.getItem("nexus-workbench:disabled-extensions:v1") || "[]",
      );
      if (Array.isArray(saved))
        setDisabled(saved.filter((id): id is string => typeof id === "string"));
    } catch {
      /* Optional preference. */
    }
    setReady(true);
  }, []);
  function toggle(id: string) {
    setDisabled((previous) => {
      const next = previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id];
      try {
        localStorage.setItem(
          "nexus-workbench:disabled-extensions:v1",
          JSON.stringify(next),
        );
      } catch {
        /* Session still works. */
      }
      return next;
    });
  }
  function togglePin(id: string) {
    setPinned((previous) => {
      const next = previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id];
      try { localStorage.setItem("nexus-workbench:pinned-extensions:v1", JSON.stringify(next)); }
      catch { /* Session preference remains usable. */ }
      return next;
    });
  }
  return { ready, enabled: (id: string) => !disabled.includes(id), toggle, pinned, togglePin };
}
