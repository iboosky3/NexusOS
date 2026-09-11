"use client";

import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import s from "./detail-dialog.module.css";

/** Native modal focus containment, Escape dismissal, and focus return to its trigger. */
export function DetailDialog({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    label = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header>
        <div>
          <h2 id={label}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button autoFocus aria-label="关闭节点详情" onClick={onClose}>
          ×
        </button>
      </header>
      <div className={s.content}>{children}</div>
    </dialog>,
    document.body,
  );
}
