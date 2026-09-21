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
}
export interface WorkbenchExtension<Props> {
  manifest: ExtensionManifest;
  load: () => Promise<{ default: ComponentType<Props> }>;
}

/** Bundled trusted extensions; enabling does not download or execute remote code. */
export function useWorkbenchExtensions() {
  const [disabled, setDisabled] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
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
  return { ready, enabled: (id: string) => !disabled.includes(id), toggle };
}
