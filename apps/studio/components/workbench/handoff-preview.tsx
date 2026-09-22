"use client";

import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import type { HandoffPreviewProps, ResourcePayload, StudioResource } from "@/lib/plugin-sdk/types";
import { studioApi } from "@/lib/studio-client";
import s from "./handoff-preview.module.css";

export type Artifact = { id: string; artifactType: string; sourceResourceId: string; sourceRevision: number; digest: string; producerPluginId: string; producerPluginVersion: string; payload: ResourcePayload };
export type Handoff = { id: string; artifactId: string; targetId: string; status: string; proposal: ResourcePayload; proposalDigest: string; artifactDigest: string; expectedRevision: number; appliedRevision?: number };

export function HandoffPreview({ workspace, transfer, artifact, current, targetTitle, disabled, Preview, onApply, onRepreview }: {
  workspace: string; transfer: Handoff; artifact?: Artifact; current?: StudioResource; targetTitle: string;
  disabled: boolean; Preview?: ComponentType<HandoffPreviewProps>; onApply(): void; onRepreview(): void;
}) {
  const [baseline, setBaseline] = useState<StudioResource>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setBaseline(undefined); setError("");
    void studioApi<StudioResource>(`/${workspace}/resources/${transfer.targetId}/versions/${transfer.expectedRevision}`)
      .then((value) => { if (live) setBaseline(value); })
      .catch((failure) => { if (live) setError(String(failure)); });
    return () => { live = false; };
  }, [workspace, transfer.id, transfer.targetId, transfer.expectedRevision, attempt]);
  const conflict = current && current.revision !== transfer.expectedRevision;
  const pending = transfer.status === "waiting_confirmation";
  return <section className={s.preview} aria-label="交接预览">
    <h2>交接到 {targetTitle}</h2>
    <p>目标：{transfer.targetId} · 预览基于 r{transfer.expectedRevision}{!pending && ` · 已应用 r${transfer.appliedRevision}`}</p>
    {artifact && <details open><summary>来源与版本</summary>
      <p>源资源：{artifact.sourceResourceId} · r{artifact.sourceRevision}</p>
      <p>产物：{artifact.id} · {artifact.artifactType}</p>
      <p>生产插件：{artifact.producerPluginId} · {artifact.producerPluginVersion}</p>
      <p>产物摘要：{artifact.digest}</p>
    </details>}
    {error && <p role="alert">无法读取原版本：{error}<button onClick={() => setAttempt((value) => value + 1)}>重试读取</button></p>}
    {pending && conflict && <p role="alert">目标已有新版本 r{current.revision}。旧预览不能直接应用，请按最新版本重新预览并再次确认。</p>}
    {baseline ? Preview ? <Preview before={baseline.payload} after={transfer.proposal} /> : <div className={s.columns}>
      <section><h3>交接前</h3><pre>{JSON.stringify(baseline.payload, null, 2)}</pre></section>
      <section><h3>交接后</h3><pre>{JSON.stringify(transfer.proposal, null, 2)}</pre></section>
    </div> : !error && <p role="status">读取预览基线…</p>}
    {pending && conflict && <details><summary>查看目标最新版本 r{current.revision}</summary>
      {Preview ? <Preview before={baseline?.payload || {}} after={current.payload} /> : <pre>{JSON.stringify(current.payload, null, 2)}</pre>}
    </details>}
    {pending && <footer>
      <button disabled={disabled || !baseline || !artifact || Boolean(conflict)} onClick={onApply}>确认并应用</button>
      <button disabled={disabled} onClick={onRepreview}>按最新版本重新预览</button>
      <p>重新预览不会写入正文，需要再次确认；本地有未保存修改时请先保存。</p>
    </footer>}
  </section>;
}
