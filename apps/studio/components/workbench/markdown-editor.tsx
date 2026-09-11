"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { PanelSplitter } from "./panel-splitter";
import { DocumentRenderer } from "./document-renderer";
import s from "./markdown-editor.module.css";

/** Controlled text editor: callers supply business actions and persistence. */
export function MarkdownEditor({
  value,
  onChange,
  editing,
  onEditing,
  split,
  onSplit,
  disabled,
  label = "Markdown 正文",
  placeholder = "# 文档",
  limit = 200000,
  actions,
  empty,
}: {
  value: string;
  onChange: (value: string) => void;
  editing: boolean;
  onEditing: (value: boolean) => void;
  split: boolean;
  onSplit: (value: boolean) => void;
  disabled: boolean;
  label?: string;
  placeholder?: string;
  limit?: number;
  actions?: ReactNode;
  empty?: ReactNode;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const splitContainer = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(0.5);
  const [layoutReady, setLayoutReady] = useState(false);
  useEffect(() => {
    try {
      const saved = Number(
        localStorage.getItem("nexus-workbench:markdown-split:v1"),
      );
      if (Number.isFinite(saved) && saved >= 0.2 && saved <= 0.8)
        setRatio(saved);
    } catch {
      /* Optional preference. */
    }
    setLayoutReady(true);
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    if (splitContainer.current) observer.observe(splitContainer.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!layoutReady) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          "nexus-workbench:markdown-split:v1",
          String(ratio),
        );
      } catch {
        /* Keep the local layout usable. */
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [ratio, layoutReady]);
  const sideBySide = split && editing && width >= 480;
  const minimum = Math.max(0.2, 160 / Math.max(1, width - 4));
  const effectiveRatio = Math.max(minimum, Math.min(1 - minimum, ratio));
  function format(before: string, after = "") {
    const start = editor.current?.selectionStart ?? value.length;
    const end = editor.current?.selectionEnd ?? start;
    const next =
      value.slice(0, start) +
      before +
      value.slice(start, end) +
      after +
      value.slice(end);
    if (disabled || next.length > limit) return;
    onChange(next);
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(
        start + before.length,
        end + before.length,
      );
    });
  }
  return (
    <>
      <div className={s.toolbar}>
        <button aria-pressed={!editing} onClick={() => onEditing(false)}>
          预览
        </button>
        <button aria-pressed={editing} onClick={() => onEditing(true)}>
          编辑 Markdown
        </button>
        <button
          aria-pressed={split}
          onClick={() => {
            onSplit(!split);
            onEditing(true);
          }}
        >
          分屏
        </button>
        {actions}
      </div>
      {editing && (
        <div className={s.toolbar}>
          <button
            aria-label="加粗所选文字"
            disabled={disabled}
            onClick={() => format("**", "**")}
          >
            <b>B</b>
          </button>
          <button disabled={disabled} onClick={() => format("\n## ")}>
            H2
          </button>
          <button disabled={disabled} onClick={() => format("\n- ")}>
            列表
          </button>
          <button
            disabled={disabled}
            onClick={() =>
              format("\n| 名称 | 说明 |\n| --- | --- |\n|  |  |\n")
            }
          >
            表格
          </button>
          <span>
            {value.length.toLocaleString()} / {limit.toLocaleString()} 字符
          </span>
        </div>
      )}
      <div
        ref={splitContainer}
        className={sideBySide ? s.split : undefined}
        style={
          sideBySide
            ? {
                gridTemplateColumns: `minmax(0,${effectiveRatio}fr) 4px minmax(0,${1 - effectiveRatio}fr)`,
              }
            : undefined
        }
      >
        {editing && (
          <textarea
            ref={editor}
            className={s.editor}
            aria-label={label}
            disabled={disabled}
            value={value}
            maxLength={limit}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
          />
        )}
        {sideBySide && (
          <PanelSplitter
            label="调整编辑器与预览宽度"
            orientation="vertical"
            value={(width - 4) * effectiveRatio}
            min={(width - 4) * minimum}
            max={(width - 4) * (1 - minimum)}
            onChange={(value) => setRatio(value / (width - 4))}
            onReset={() => setRatio(0.5)}
          />
        )}
        {(!editing || split) && (
          <article className={`${s.document} markdown-content`}>
            {value ? <DocumentRenderer content={value} /> : empty}
          </article>
        )}
      </div>
    </>
  );
}
