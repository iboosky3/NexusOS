"use client";

import { useRef, useState } from "react";
import type { ResourceEditorProps } from "@/lib/plugin-sdk/types";
import type { Brief, Prototype } from "@/lib/prd-api";
import { PrototypeEditor } from "@/components/prd-studio/prototype-editor";
import { createComponentId } from "@/lib/browser-crypto";

export default function PrototypeResourceEditor(props: ResourceEditorProps) {
  const { resource, disabled, onChange, onSave, onPublish, onError, onSelection } = props;
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const payload = resource.payload;
  const brief: Brief = { title: String(payload.title), description: String(payload.description || ""),
    audience: "", problem: "", scope: "", constraints: "", metrics: "", template: "", sources: [], prototype: payload.prototype as Prototype | null };
  const update = (value: Brief) => ({ title: value.title, description: value.description, prototype: value.prototype });
  return <>
    <PrototypeEditor standalone content="" brief={brief} disabled={disabled || busy}
      draftStorageKey={`nexus-studio:code:${resource.workspaceId}:${resource.id}`}
      designerEnabled={!disabled} onOpenExtensions={() => onError("请在插件面板启用原型设计")}
      onBrief={(value) => onChange(update(value))} onBusy={setBusy}
      onImport={() => input.current?.click()} onSelection={onSelection} componentPatch={null} onPatchApplied={() => {}}
      onSave={async (prototype) => { await onSave({ ...payload, prototype }); }}
      onEmbed={async (_content, prototype) => { const saved = await onSave({ ...payload, prototype }); await onPublish(saved); }}
      onOpenBrowser={() => {
        const opened = window.open("about:blank", "_blank");
        if (!opened) { onError("请允许浏览器弹出新标签页"); return; }
        opened.opener = null;
        void onSave().then(() => { opened.location.replace(`/studio?workspace=${resource.workspaceId}&resource=${resource.id}`); }).catch((error) => { opened.close(); onError(String(error)); });
      }} />
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (file.size > 90000) { onError("图片过大，请压缩到 90 KB 以内后导入"); return; }
      const reader = new FileReader();
      reader.onerror = () => onError("图片读取失败");
      reader.onload = () => onChange({ ...payload, prototype: { confirmed: false, pages: [...(brief.prototype?.pages || []), {
        id: createComponentId(), title: file.name, description: "", elements: [], screenshot: String(reader.result),
      }] } });
      reader.readAsDataURL(file);
    }} />
  </>;
}
