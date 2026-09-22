"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { createComponentId } from "@/lib/browser-crypto";
import { studioApi, StudioApiError } from "@/lib/studio-client";
import type { ResourcePayload, StudioResource } from "@/lib/plugin-sdk/types";
import { grapesPrototypePlugin } from "./plugin";

const GrapesEditor = dynamic(() => import("./editor"), { ssr: false, loading: () => <p>正在加载自由原型编辑器…</p> });
type Workspace = { id: string; revision: number; plugins: string[]; layouts: Record<string, unknown> };
const workspaceKey = "nexus-grapes:prd-studio-workspace:v1";
const requestKey = "nexus-grapes:prd-studio-create-request:v1";

/** Keeps the established PRD Studio shell while giving GrapesJS independent resources. */
export default function LegacyGrapesBridge() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [resources, setResources] = useState<StudioResource[]>([]);
  const [resource, setResource] = useState<StudioResource | null>(null);
  const current = useRef(resource); current.current = resource;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    async function start() {
      try {
        const known = localStorage.getItem(workspaceKey);
        let next: Workspace;
        if (known) next = await studioApi<Workspace>(`/${known}/configuration`);
        else {
          let request = localStorage.getItem(requestKey);
          if (!request) { request = createComponentId(); localStorage.setItem(requestKey, request); }
          next = await studioApi<Workspace>("", "POST", { title: "PRD Studio", clientRequestId: request });
          localStorage.setItem(workspaceKey, next.id);
        }
        if (!next.plugins.includes(grapesPrototypePlugin.id)) {
          try {
            next = await studioApi<Workspace>(`/${next.id}/configuration`, "PATCH", {
              expectedRevision: next.revision, plugins: [...next.plugins, grapesPrototypePlugin.id], layouts: next.layouts,
            });
          } catch (failure) {
            if (!(failure instanceof StudioApiError) || failure.status !== 409) throw failure;
            next = await studioApi<Workspace>(`/${next.id}/configuration`);
            if (!next.plugins.includes(grapesPrototypePlugin.id)) throw failure;
          }
        }
        const items = await studioApi<StudioResource[]>(`/${next.id}/resources`);
        if (live) { setWorkspace(next); setResources(items.filter((item) => item.resourceType === grapesPrototypePlugin.resourceType && !item.deleted)); }
      } catch (failure) { if (live) setError(`无法加载自由原型资源：${String(failure)}`); }
    }
    void start();
    return () => { live = false; };
  }, []);

  async function create() {
    if (!workspace || busy) return;
    setBusy(true); setError("");
    try {
      const created = await studioApi<StudioResource>(`/${workspace.id}/resources`, "POST", {
        resourceType: grapesPrototypePlugin.resourceType,
        payload: grapesPrototypePlugin.initialPayload(), clientRequestId: createComponentId(),
      });
      setResources((previous) => [...previous, created]); setResource(created);
    } catch (failure) { setError(String(failure)); }
    finally { setBusy(false); }
  }
  async function save(payload?: ResourcePayload): Promise<StudioResource> {
    const base = current.current;
    if (!workspace || !base) throw new Error("请先选择自由原型");
    const saved = await studioApi<StudioResource>(`/${workspace.id}/resources/${base.id}`, "PATCH", {
      expectedRevision: base.revision, payload: payload || base.payload, clientRequestId: createComponentId(),
    });
    current.current = saved; setResource(saved);
    setResources((previous) => previous.map((item) => item.id === saved.id ? saved : item));
    setNotice(`已保存 r${saved.revision}`);
    return saved;
  }
  async function publish(saved: StudioResource) {
    if (!workspace) throw new Error("工作区尚未就绪");
    await studioApi(`/${workspace.id}/artifacts`, "POST", {
      resourceId: saved.id, revision: saved.revision, clientRequestId: createComponentId(),
    });
  }
  return <section aria-label="自由原型插件">
    <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
      <strong>自由原型</strong>
      <button disabled={!workspace || busy} onClick={() => void create()}>新建自由原型</button>
      <label>打开原型 <select aria-label="打开自由原型" value={resource?.id || ""} onChange={(event) => {
        setError(""); setNotice("");
        setResource(resources.find((item) => item.id === event.target.value) || null);
      }}><option value="">请选择</option>{resources.map((item) => <option key={item.id} value={item.id}>{grapesPrototypePlugin.title(item.payload)} · r{item.revision}</option>)}</select></label>
    </header>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {resource ? <GrapesEditor key={resource.id} resource={resource} disabled={busy}
      onChange={(payload) => setResource((previous) => previous ? { ...previous, payload } : previous)}
      onSave={save} onPublish={publish} onSelection={() => {}} onError={setError} />
      : <p style={{ padding: 16 }}>{workspace ? "新建或选择自由原型开始设计。" : "正在准备原型资源…"}</p>}
  </section>;
}
