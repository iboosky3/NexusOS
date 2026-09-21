"use client";

import { useState } from "react";
import { ExtensionManifest } from "@/lib/workbench-extensions";
import { PanelHeading } from "./workbench";
import s from "./extension-browser.module.css";

export function ExtensionBrowser({
  extensions,
  enabled,
  onToggle,
  onOpen,
  disabled = false,
  pinned = [],
  onTogglePin,
}: {
  extensions: ExtensionManifest[];
  enabled: (id: string) => boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  disabled?: boolean;
  pinned?: string[];
  onTogglePin?: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const matches = extensions.filter((e) =>
    `${e.name} ${e.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className={s.browser} aria-label="插件管理">
      <PanelHeading>插件</PanelHeading>
      <input
        aria-label="搜索已安装插件"
        placeholder="搜索已安装插件"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p>已安装 · {extensions.length}</p>
      {matches.map((extension) => (
        <article key={extension.id}>
          <strong>{extension.name}</strong>
          <small>
            v{extension.version} · {enabled(extension.id) ? "已启用" : "已禁用"}
          </small>
          <p>{extension.description}</p>
          <small>{extension.license} · 本地运行</small>
          <div>
            {onTogglePin && <button disabled={disabled} onClick={() => onTogglePin(extension.id)}>
              {pinned.includes(extension.id) ? "从快捷栏移除" : "添加到快捷栏"}
            </button>}
            <button
              disabled={disabled || !enabled(extension.id)}
              onClick={() => onOpen(extension.id)}
            >
              打开
            </button>
            <button disabled={disabled} onClick={() => onToggle(extension.id)}>
              {enabled(extension.id) ? "禁用" : "启用"}
            </button>
            <a href={extension.homepage} target="_blank" rel="noreferrer">
              开源项目 ↗
            </a>
          </div>
        </article>
      ))}
      {!matches.length && <p>没有匹配的已安装插件</p>}
    </section>
  );
}
