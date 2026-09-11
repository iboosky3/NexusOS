"use client";

import { ReactNode, useRef, useState } from "react";
import s from "./attachment-dropzone.module.css";

/** File acquisition only; the host validates formats and decides where files belong. */
export function AttachmentDropzone({
  accept,
  disabled,
  onUpload,
  onBusy,
  children,
}: {
  accept: string;
  disabled: boolean;
  onUpload: (files: File[]) => Promise<void>;
  onBusy: (busy: boolean) => void;
  children: (open: () => void) => ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  async function upload(files: File[]) {
    if (disabled || uploading.current || !files.length) return;
    uploading.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await onUpload(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "附件添加失败，请重试");
    } finally {
      uploading.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div
      className={`${s.zone} ${dragging ? s.dragging : ""}`}
      aria-label="对话附件上传区"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
          setDragging(!disabled);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(Array.from(event.dataTransfer.files));
      }}
    >
      {children(() => {
        if (!disabled && !busy) input.current?.click();
      })}
      <input
        hidden
        ref={input}
        type="file"
        aria-label="选择对话附件"
        accept={accept}
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          void upload(files);
        }}
      />
      {dragging && <span className={s.hint}>松开以添加附件</span>}
      {busy && (
        <p role="status" className={s.message}>
          正在读取附件…
        </p>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
          <button
            type="button"
            aria-label="关闭附件错误"
            onClick={() => setError("")}
          >
            ×
          </button>
        </p>
      )}
    </div>
  );
}
