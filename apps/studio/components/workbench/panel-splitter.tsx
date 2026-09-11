"use client";

import { useEffect, useRef, useState } from "react";
import s from "./panel-splitter.module.css";

/** A keyboard and pointer accessible sash; the owner controls sizing and persistence. */
export function PanelSplitter({
  label,
  orientation,
  value,
  min,
  max,
  onChange,
  onReset,
  direction = 1,
  controls,
}: {
  label: string;
  orientation: "vertical" | "horizontal";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
  direction?: 1 | -1;
  controls?: string;
}) {
  const drag = useRef<{ coordinate: number; value: number } | null>(null);
  const restore = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  function release() {
    drag.current = null;
    restore.current?.();
    restore.current = null;
    setDragging(false);
  }
  useEffect(
    () => () => {
      restore.current?.();
    },
    [],
  );
  return (
    <div
      className={`${s.sash} ${orientation === "vertical" ? s.vertical : s.horizontal}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${Math.round(value)} 像素`}
      aria-controls={controls}
      title={`${label}：拖动调整，双击恢复默认；方向键微调`}
      data-dragging={dragging}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          coordinate:
            orientation === "vertical" ? event.clientX : event.clientY,
          value,
        };
        setDragging(true);
        const style = document.documentElement.style,
          selection = style.userSelect,
          cursor = style.cursor;
        restore.current?.();
        style.userSelect = "none";
        style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
        restore.current = () => {
          style.userSelect = selection;
          style.cursor = cursor;
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const coordinate =
          orientation === "vertical" ? event.clientX : event.clientY;
        update(
          drag.current.value +
            (coordinate - drag.current.coordinate) * direction,
        );
      }}
      onPointerUp={(event) => {
        release();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        const positive =
            orientation === "vertical" ? "ArrowRight" : "ArrowDown",
          negative = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        if (event.key === positive || event.key === negative) {
          event.preventDefault();
          update(
            value +
              (event.key === positive ? 1 : -1) *
                direction *
                (event.shiftKey ? 40 : 10),
          );
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          update(event.key === "Home" ? min : max);
        } else if (event.key === "Enter") {
          event.preventDefault();
          onReset();
        } else if (event.key === "Escape" && drag.current) {
          update(drag.current.value);
          release();
        }
      }}
    />
  );
}
