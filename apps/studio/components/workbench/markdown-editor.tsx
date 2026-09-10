"use client";

import { ReactNode, useRef } from "react";
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
      <div className={split && editing ? s.split : undefined}>
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
        {(!editing || split) && (
          <article className={`${s.document} markdown-content`}>
            {value ? <DocumentRenderer content={value} /> : empty}
          </article>
        )}
      </div>
    </>
  );
}
