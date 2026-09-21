"use client";
import type { ResourceEditorProps } from "@/lib/plugin-sdk/types";

export default function NotesEditor({ resource, disabled, onChange }: ResourceEditorProps) {
  return <fieldset disabled={disabled}><legend>示例便签</legend>
    <label>便签标题<input value={String(resource.payload.title)} maxLength={200}
      onChange={(event) => onChange({ ...resource.payload, title: event.target.value })} /></label>
    <label>便签正文<textarea rows={15} value={String(resource.payload.content)} maxLength={20000}
      onChange={(event) => onChange({ ...resource.payload, content: event.target.value })} /></label>
  </fieldset>;
}
