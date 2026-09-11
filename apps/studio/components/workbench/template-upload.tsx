"use client";
import { useEffect, useRef, useState } from "react";
import { readTemplate } from "@/lib/template-import";
import s from "./template-upload.module.css";

export function TemplateUpload({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<{
    name: string;
    text: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <div className={s.upload}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "正在读取模板…" : "上传模板"}
      </button>
      <small>
        支持 Markdown、TXT、Word（.docx），最多 8,000 字符；Word
        提取文字目录与要求。
      </small>
      <input
        hidden
        ref={input}
        type="file"
        aria-label="上传文档模板"
        accept=".md,.markdown,.txt,.docx"
        disabled={disabled || busy}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          setError("");
          setNotice("");
          setCandidate(null);
          try {
            const text = await readTemplate(file);
            if (mounted.current) setCandidate({ name: file.name, text });
          } catch (err) {
            if (mounted.current)
              setError(
                err instanceof Error
                  ? err.message
                  : "无法读取模板，请检查文件格式",
              );
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      />
      {candidate && (
        <div className={s.preview}>
          <strong>
            {candidate.name} · {candidate.text.length.toLocaleString()} 字符
          </strong>
          <pre>{candidate.text}</pre>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onApply(candidate.text);
              setNotice(`已应用模板：${candidate.name}`);
              setCandidate(null);
            }}
          >
            应用并替换模板内容
          </button>
          <button type="button" onClick={() => setCandidate(null)}>
            取消
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
