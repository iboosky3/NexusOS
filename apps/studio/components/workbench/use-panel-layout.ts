"use client";

import { useEffect, useRef, useState } from "react";

const defaults = { left: 215, right: 330, bottom: 370 };
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function usePanelLayout({
  storageKey,
  leftVisible,
  rightVisible,
  railWidth,
}: {
  storageKey: string;
  leftVisible: boolean;
  rightVisible: boolean;
  railWidth: number;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 1400, height: 900 });
  const [preferred, setPreferred] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setReady(false);
    let next = defaults;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && typeof saved === "object")
        next = {
          left:
            typeof saved.left === "number" && Number.isFinite(saved.left)
              ? clamp(saved.left, 160, 600)
              : defaults.left,
          right:
            typeof saved.right === "number" && Number.isFinite(saved.right)
              ? clamp(saved.right, 240, 760)
              : defaults.right,
          bottom:
            typeof saved.bottom === "number" && Number.isFinite(saved.bottom)
              ? clamp(saved.bottom, 120, 1400)
              : defaults.bottom,
        };
    } catch {
      /* Optional browser preference. */
    }
    setPreferred(next);
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(preferred));
      } catch {
        /* Resizing remains available without storage. */
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [preferred, ready, storageKey]);
  useEffect(() => {
    if (!body.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setArea({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(body.current);
    return () => observer.disconnect();
  }, []);
  const minimum = (leftVisible ? 160 : 0) + (rightVisible ? 240 : 0);
  const budget = Math.max(
    minimum,
    area.width -
      railWidth -
      320 -
      (leftVisible ? 4 : 0) -
      (rightVisible ? 4 : 0),
  );
  const wanted =
    (leftVisible ? preferred.left - 160 : 0) +
    (rightVisible ? preferred.right - 240 : 0);
  const ratio =
    wanted > 0 ? Math.min(1, Math.max(0, budget - minimum) / wanted) : 1;
  const left = leftVisible ? 160 + (preferred.left - 160) * ratio : 0;
  const right = rightVisible ? 240 + (preferred.right - 240) * ratio : 0;
  const bottomMax = Math.max(120, area.height - 184);
  const bottom = expanded
    ? bottomMax
    : clamp(preferred.bottom, Math.min(160, bottomMax), bottomMax);
  return {
    body,
    left,
    right,
    bottom,
    expanded,
    leftMax: Math.max(160, Math.min(600, budget - right)),
    rightMax: Math.max(240, Math.min(760, budget - left)),
    bottomMax,
    set: (key: keyof typeof defaults, value: number) => {
      if (key === "bottom") setExpanded(false);
      setPreferred((previous) => ({ ...previous, [key]: value }));
    },
    reset: (key: keyof typeof defaults) => {
      if (key === "bottom") setExpanded(false);
      setPreferred((previous) => ({ ...previous, [key]: defaults[key] }));
    },
    toggleExpanded: () => setExpanded((value) => !value),
  };
}
