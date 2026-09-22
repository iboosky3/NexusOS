"use client";
import type { PluginViewProps } from "@/lib/plugin-sdk/types";
export default function GrapesView({ resources, onOpen }: PluginViewProps) {
  return <section aria-label="自由原型资源">{resources.map((resource) => <p key={resource.id}>
    <button onClick={() => onOpen(resource)}>{String(resource.payload.title)} · r{resource.revision}</button>
  </p>)}{!resources.length && <p>在文件菜单创建自由原型。</p>}</section>;
}
