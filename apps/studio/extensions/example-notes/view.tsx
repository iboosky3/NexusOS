"use client";
import type { PluginViewProps } from "@/lib/plugin-sdk/types";

export default function NotesView({ resources, onOpen }: PluginViewProps) {
  return <section aria-label="便签资源">{resources.map((resource) => <p key={resource.id}>
    <button onClick={() => onOpen(resource)}>{String(resource.payload.title)} · r{resource.revision}</button>
  </p>)}{!resources.length && <p>从文件菜单创建第一张便签。</p>}</section>;
}
