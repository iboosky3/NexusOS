"use client";
import type { PluginViewProps } from "@/lib/plugin-sdk/types";

export default function ResourceView({ resources, onOpen }: PluginViewProps) {
  return <section aria-label="需求文档">{resources.length ? resources.map((resource) =>
    <p key={resource.id}><button onClick={() => onOpen(resource)}>{String((resource.payload.brief as { title?: string })?.title || "未命名 PRD")} · r{resource.revision}</button></p>
  ) : <p>尚无需求文档，可从文件菜单创建。</p>}</section>;
}
