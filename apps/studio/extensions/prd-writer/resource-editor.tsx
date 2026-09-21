"use client";

import { useState } from "react";
import type { ResourceEditorProps } from "@/lib/plugin-sdk/types";
import type { Brief } from "@/lib/prd-api";
import { BriefEditor } from "@/components/prd-studio/brief-editor";
import { MarkdownEditor } from "@/components/workbench/markdown-editor";

export default function PrdResourceEditor({ resource, disabled, onChange }: ResourceEditorProps) {
  const [briefVisible, setBriefVisible] = useState(false);
  const [editing, setEditing] = useState(true);
  const [split, setSplit] = useState(true);
  const value = resource.payload;
  return <>
    <button aria-expanded={briefVisible} onClick={() => setBriefVisible(!briefVisible)}>{briefVisible ? "收起需求简报" : "需求简报"}</button>
    {briefVisible && <BriefEditor brief={value.brief as Brief} disabled={disabled} onChange={(brief) => onChange({ ...value, brief })} />}
    <MarkdownEditor value={String(value.content || "")} onChange={(content) => onChange({ ...value, content })}
      disabled={disabled} editing={editing} onEditing={setEditing} split={split} onSplit={setSplit} label="PRD 正文" />
    {Array.isArray(value.provenance) && value.provenance.length > 0 && <details><summary>采用的设计版本 · {value.provenance.length}</summary>
      <pre>{JSON.stringify(value.provenance, null, 2)}</pre>
    </details>}
  </>;
}
