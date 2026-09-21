"use client";
import type { PluginViewProps } from "@/lib/plugin-sdk/types";

export default function ResourceView({ resources, onOpen }: PluginViewProps) {
  return <section aria-label="原型资源">{resources.length ? resources.map((resource) =>
    <p key={resource.id}><button onClick={() => onOpen(resource)}>{String(resource.payload.title || "未命名原型")} · r{resource.revision}</button></p>
  ) : <p>尚无原型资源，可从文件菜单创建。</p>}</section>;
}
