"use client";

import { useCallback, useState } from "react";

/** Closing an editor changes its visibility, not its document or running task. */
export function useEditorTabs<T extends string>(initial: T[], active: T) {
  const [state, setState] = useState<{ open: T[]; active: T | null }>({ open: initial, active });
  const openTab = useCallback((id: T) => {
    setState((previous) => ({
      open: previous.open.includes(id) ? previous.open : [...previous.open, id], active: id,
    }));
  }, []);
  const closeTab = useCallback((id: T) => {
    setState((previous) => {
      const index = previous.open.indexOf(id);
      if (index < 0) return previous;
      const open = previous.open.filter((item) => item !== id);
      return {
        open,
        active: previous.active === id ? open[Math.min(index, open.length - 1)] ?? null : previous.active,
      };
    });
  }, []);
  return { tab: state.active, openTabs: state.open, setTab: openTab, closeTab };
}
