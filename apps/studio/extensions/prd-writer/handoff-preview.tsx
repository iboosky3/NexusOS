"use client";

import type { HandoffPreviewProps } from "@/lib/plugin-sdk/types";
import { DocumentRenderer } from "@/components/workbench/document-renderer";
import s from "@/components/workbench/handoff-preview.module.css";

export default function PrdHandoffPreview({ before, after }: HandoffPreviewProps) {
  return <div className={s.columns}>
    {[{ title: "交接前正文", payload: before }, { title: "交接后正文", payload: after }].map(({ title, payload }) => <section key={title} aria-label={title}>
      <h3>{title}</h3><DocumentRenderer content={String(payload.content || "")} />
      <details><summary>查看正文原文</summary><pre>{String(payload.content || "")}</pre></details>
    </section>)}
  </div>;
}
