"use client";

import { useState } from "react";
import type { StudioPlugin } from "@/lib/plugin-sdk/types";
import s from "./agent-catalog.module.css";

/** The shell lists declared Agent plugins; domain content stays in each plugin profile. */
export function AgentDirectory({ plugins, enabled, onOpen }: {
  plugins: readonly StudioPlugin[];
  enabled(id: string): boolean;
  onOpen(plugin: StudioPlugin): void;
}) {
  const [query, setQuery] = useState("");
  return <div className={s.directory}>
    <label className={s.search}>搜索 Agent
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Agent 或能力" />
    </label>
    <ul className={s.entries} aria-label="Agent 插件">
      {plugins.filter((plugin) => plugin.agent && `${plugin.name} ${plugin.agent.summary} ${plugin.capabilities.map((item) => item.label).join(" ")}`.toLowerCase().includes(query.toLowerCase()))
        .map((plugin) => <li key={plugin.id}><button className={s.entry} onClick={() => onOpen(plugin)}>
          <span className={s.icon}>{plugin.icon}</span><span><strong>{plugin.name}</strong><small>{enabled(plugin.id) ? "可运行" : "未启用"} · {plugin.agent!.summary}</small></span>
        </button></li>)}
    </ul>
  </div>;
}

export function AgentDetail({ plugin, enabled, busy = false, onRun }: {
  plugin: StudioPlugin;
  enabled: boolean;
  busy?: boolean;
  onRun(): void;
}) {
  const profile = plugin.agent;
  if (!profile) return null;
  const participants = profile.stages.flatMap((stage) => stage.participant ? [{ ...stage.participant, stage: stage.label }] : []);
  return <article className={s.detail} aria-label={`${plugin.name} Agent 详情`}>
    <header className={s.hero}>
      <span className={s.heroIcon}>{plugin.icon}</span>
      <div><small>Agent 插件 · v{profile.version}</small><h1>{plugin.name}</h1><p>{profile.summary}</p>
        <button onClick={onRun} disabled={!enabled || busy}>{enabled ? "运行 / 打开工作台" : "插件未启用"}</button>
      </div>
    </header>
    <section><h2>使用方法</h2><ol>{profile.usage.map((step) => <li key={step}>{step}</li>)}</ol></section>
    <section><h2>智能体架构图</h2><p className={s.hint}>这是插件声明的流程；本次运行的实际 Agent、版本和步骤以运行记录为准。</p>
      <ol className={s.graph}>{profile.stages.map((stage) => <li key={stage.id}>
        <strong>{stage.label}</strong><p>{stage.purpose}</p>{stage.capability && <small>所需能力：{stage.capability}</small>}
      </li>)}</ol>
    </section>
    <section><h2>子 Agent 与参与角色</h2>
      {participants.length ? <><p className={s.hint}>{profile.selection === "capability" ? "下列是声明的阶段候选角色，运行时按能力选择；并非每次都固定调用。" : "下列是插件声明的固定参与角色。"}</p>
        <div className={s.participants}>{participants.map((item) => <div key={`${item.stage}:${item.id}`}><strong>{item.label}</strong><small>{item.stage} · {item.id}</small><p>{item.description}</p></div>)}</div>
      </> : <p>此 Agent 未声明子 Agent；能力可独立执行。</p>}
    </section>
    <section><h2>可用能力</h2><p>{plugin.capabilities.map((item) => item.label).join(" · ")}</p></section>
  </article>;
}
