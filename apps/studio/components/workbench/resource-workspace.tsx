"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { studioPlugins } from "@/extensions/studio-plugins";
import { studioApi, StudioApiError } from "@/lib/studio-client";
import { createComponentId } from "@/lib/browser-crypto";
import { ExtensionHost } from "@/lib/extension-host/lifecycle";
import type { ResourcePayload, StudioPlugin, StudioResource } from "@/lib/plugin-sdk/types";
import { Workbench, EditorTabs, PanelHeading } from "./workbench";
import { PluginErrorBoundary } from "./plugin-error-boundary";
import { AgentDirectory, AgentDetail } from "./agent-catalog";
import { InvocationFlow, type InvocationTrace } from "./invocation-flow";
import { useEditorTabs } from "./use-editor-tabs";
import s from "./resource-workspace.module.css";

type Workspace = { id: string; title: string; revision: number; plugins: string[]; layouts: Record<string, unknown> };
type Session = { base: StudioResource; payload: ResourcePayload };
type Invocation = InvocationTrace & { id: string; status: string; error: string | null; request: { resourceId: string; revision: number; capabilityId: string; instruction: string; input?: ResourcePayload }; result?: { answer?: string; payload?: ResourcePayload; digest?: string } };
type Artifact = { id: string; artifactType: string; sourceResourceId: string; sourceRevision: number; digest: string; payload: { pages: unknown[] } };
type Handoff = { id: string; targetId: string; status: string; proposal: ResourcePayload; proposalDigest: string; artifactDigest: string; expectedRevision: number };
const editors = new Map(studioPlugins.map((plugin) => [plugin.id, dynamic(plugin.load, { ssr: false, loading: () => <p>正在加载编辑器…</p> })]));
const contributedViews = studioPlugins.flatMap((plugin) => (plugin.views ?? []).map((view) => ({ ...view, pluginId: plugin.id, resourceType: plugin.resourceType, Component: dynamic(view.load, { ssr: false }) })));
const owner = (resource: StudioResource) => studioPlugins.find((plugin) => plugin.resourceType === resource.resourceType);
const dirty = (session: Session) => JSON.stringify(session.payload) !== JSON.stringify(session.base.payload);
const draftKey = (workspace: string, resource: string) => `nexus-studio:draft:v1:${workspace}:${resource}`;

export function ResourceWorkspace() {
  const [profile, setProfile] = useState("desktop");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [restored, setRestored] = useState(false);
  const [available, setAvailable] = useState<Workspace[]>([]);
  const [title, setTitle] = useState("我的工作区");
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const operationBusy = useRef(false);
  const uncertainSaves = useRef(new Map<string, { expectedRevision: number; payload: ResourcePayload; clientRequestId: string }>());
  const saves = useRef(new Map<string, Promise<StudioResource>>());
  const [side, setSide] = useState("resources");
  const [sidebarFocus, setSidebarFocus] = useState(0);
  function showView(id: string) { setSide(id); setSidebarFocus((value) => value + 1); }
  const activeView = contributedViews.find((view) => view.id === side);
  const View = activeView?.Component;
  const [instruction, setInstruction] = useState("");
  const [capability, setCapability] = useState("");
  const [selection, setSelection] = useState<unknown>(null);
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [closed, setClosed] = useState<string[]>([]);
  const [host, setHost] = useState<ExtensionHost | null>(null);
  const [, setHostRevision] = useState(0);
  const { tab, openTabs, setTab, closeTab } = useEditorTabs<string>([], "");
  const active = tab ? sessions[tab] : undefined;
  const selectedAgent = tab?.startsWith("agent:") ? studioPlugins.find((item) => item.id === tab.slice(6) && item.agent) : undefined;
  const selectedRun = tab?.startsWith("run:") ? invocations.find((item) => item.id === tab.slice(4)) : undefined;
  const plugin = active ? owner(active.base) : undefined;
  const enabled = (id: string) => Boolean(workspace?.plugins.includes(id));
  const api = <T,>(path: string, method = "GET", body?: unknown) => studioApi<T>(`/${workspace!.id}${path}`, method, body);

  async function perform(action: () => Promise<unknown>) {
    if (operationBusy.current) return;
    operationBusy.current = true;
    setError(""); setBusy(true);
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { operationBusy.current = false; setBusy(false); }
  }
  async function refresh(id: string) {
    const [resources, tasks, published, transfers] = await Promise.all([
      studioApi<StudioResource[]>(`/${id}/resources`), studioApi<Invocation[]>(`/${id}/invocations`),
      studioApi<Artifact[]>(`/${id}/artifacts`), studioApi<Handoff[]>(`/${id}/handoffs`),
    ]);
    const recovered = new Map<string, { base: StudioResource; payload: ResourcePayload }>();
    for (const resource of resources) {
      try {
        const draft = JSON.parse(sessionStorage.getItem(draftKey(id, resource.id)) || "null");
        if (draft && typeof draft.baseRevision === "number" && draft.payload && typeof draft.payload === "object") {
          const base = draft.baseRevision === resource.revision ? resource : await studioApi<StudioResource>(`/${id}/resources/${resource.id}/versions/${draft.baseRevision}`);
          recovered.set(resource.id, { base, payload: draft.payload });
        }
      } catch { setError("部分草稿无法恢复，请保留浏览器数据；当前显示服务器版本。"); }
    }
    setSessions((previous) => {
      const next: Record<string, Session> = {};
      resources.filter((resource) => !resource.deleted).forEach((resource) => {
        const existing = previous[resource.id];
        if (existing && dirty(existing)) { next[resource.id] = existing; return; }
        next[resource.id] = recovered.get(resource.id) || { base: resource, payload: resource.payload };
      });
      return next;
    });
    setInvocations(tasks); setArtifacts(published); setHandoffs(transfers);
  }
  useEffect(() => {
    let live = true;
    setProfile(window.matchMedia("(max-width: 700px)").matches ? "mobile" : "desktop");
    const id = new URLSearchParams(window.location.search).get("workspace");
    void studioApi<Workspace[]>("").then((value) => { if (live) setAvailable(value); }).catch((failure) => { if (live) setError(String(failure)); });
    if (id) void studioApi<Workspace>(`/${id}/configuration`).then(async (value) => {
      if (!live) return; setWorkspace(value); await refresh(id);
      if (!live) return;
      const requested = new URLSearchParams(window.location.search).get("resource");
      let saved: unknown = [];
      try { saved = JSON.parse(localStorage.getItem(`nexus-studio:tabs:${id}`) || "[]"); } catch { setError("标签布局无法恢复，资源和草稿仍保留。"); }
      if (Array.isArray(saved)) saved.filter((item): item is string => typeof item === "string").forEach(setTab);
      if (requested) setTab(requested);
      setRestored(true);
    }).catch((failure) => { if (live) setError(String(failure)); });
    return () => { live = false; };
  }, [setTab]);
  useEffect(() => {
    if (!workspace) return;
    const instance = new ExtensionHost(studioPlugins.map((definition) => ({
      id: definition.id, dependencies: definition.dependencies, commands: definition.commands,
      activate: (context) => definition.activate({ ...context,
        resources: { create: (payload) => studioApi<StudioResource>(`/${workspace.id}/resources`, "POST", {
          resourceType: definition.resourceType, payload, clientRequestId: createComponentId(),
        }) },
        editors: { open: (resource) => {
          setSessions((previous) => ({ ...previous, [resource.id]: { base: resource, payload: resource.payload } }));
          setTab(resource.id);
        } },
      }),
    })));
    const listener = instance.subscribe(() => setHostRevision((value) => value + 1));
    setHost(instance);
    return () => { void listener.dispose(); void instance.dispose().catch(() => {}); };
  }, [workspace?.id]);
  useEffect(() => {
    if (!host || !workspace) return;
    studioPlugins.forEach((definition) => {
      if (workspace.plugins.includes(definition.id)) { host.enable(definition.id); }
      else void host.disable(definition.id).catch((failure) => setError(String(failure)));
    });
  }, [host, workspace?.plugins]);
  useEffect(() => {
    if (host && plugin && enabled(plugin.id)) void host.activate(plugin.id).catch((failure) => setError(String(failure)));
    setSelection(null); setCapability("");
  }, [host, plugin?.id, tab, workspace?.plugins]);
  useEffect(() => {
    if (!workspace || !restored) return;
    try { localStorage.setItem(`nexus-studio:tabs:${workspace.id}`, JSON.stringify(openTabs)); } catch { /* Optional layout preference. */ }
  }, [workspace?.id, openTabs, restored]);
  useEffect(() => {
    if (!workspace || !invocations.some((task) => ["queued", "running", "cancel_requested"].includes(task.status))) return;
    const timer = setInterval(() => { void refresh(workspace.id).catch((failure) => setError(String(failure))); }, 1500);
    return () => clearInterval(timer);
  }, [workspace?.id, invocations]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (Object.values(sessionsRef.current).some(dirty)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function change(id: string, payload: ResourcePayload) {
    const current = sessionsRef.current[id]; if (!current) return;
    const next = { ...sessionsRef.current, [id]: { ...current, payload } };
    sessionsRef.current = next; setSessions(next);
    try { sessionStorage.setItem(draftKey(workspace!.id, id), JSON.stringify({ baseRevision: current.base.revision, payload })); }
    catch { setError("浏览器无法保存本地草稿，请尽快保存到服务器，不要关闭页面。"); }
  }
  async function save(id: string, payload?: ResourcePayload): Promise<StudioResource> {
    const running = saves.current.get(id);
    if (running) { const result = await running; return !payload && !dirty(sessionsRef.current[id]) ? result : save(id, payload); }
    const request = saveResource(id, payload);
    saves.current.set(id, request);
    try { return await request; } finally { if (saves.current.get(id) === request) saves.current.delete(id); }
  }
  async function saveResource(id: string, payload?: ResourcePayload) {
    const session = sessionsRef.current[id];
    if (payload) change(id, payload);
    const value = payload || session.payload;
    // Retry the exact uncertain submission first, even if editing continued meanwhile.
    let submission = uncertainSaves.current.get(id);
    if (!submission) {
      try { submission = JSON.parse(sessionStorage.getItem(`nexus-studio:save:${workspace!.id}:${id}`) || "null"); } catch { /* Keep the current draft. */ }
    }
    submission ||= { expectedRevision: session.base.revision, payload: value, clientRequestId: createComponentId() };
    uncertainSaves.current.set(id, submission);
    try { sessionStorage.setItem(`nexus-studio:save:${workspace!.id}:${id}`, JSON.stringify(submission)); } catch { /* In-memory retry still works. */ }
    let saved: StudioResource;
    try { saved = await api<StudioResource>(`/resources/${id}`, "PATCH", submission); }
    catch (failure) {
      if (failure instanceof StudioApiError && failure.status < 500) {
        uncertainSaves.current.delete(id);
        try { sessionStorage.removeItem(`nexus-studio:save:${workspace!.id}:${id}`); } catch { /* Retain draft. */ }
      }
      throw new Error(`保存未确认，草稿已保留；重试会先核对原提交。${String(failure)}`);
    }
    uncertainSaves.current.delete(id);
    try { sessionStorage.removeItem(`nexus-studio:save:${workspace!.id}:${id}`); } catch { /* Receipt replay is safe. */ }
    const submitted = JSON.stringify(submission.payload);
    // Preserve edits made while the request was in flight.
    const latest = sessionsRef.current[id].payload;
    const next = { ...sessionsRef.current, [id]: { base: saved, payload: JSON.stringify(latest) === submitted ? saved.payload : latest } };
    sessionsRef.current = next; setSessions(next);
    try {
      if (JSON.stringify(latest) === submitted) sessionStorage.removeItem(draftKey(workspace!.id, id));
      else sessionStorage.setItem(draftKey(workspace!.id, id), JSON.stringify({ baseRevision: saved.revision, payload: latest }));
    } catch { setError("服务器保存成功，但本地草稿存储不可用，请复制尚未保存的修改。"); }
    setNotice(`已保存 r${saved.revision}`); return saved;
  }
  async function toggle(definition: StudioPlugin) {
    if (enabled(definition.id) && !window.confirm(`停用“${definition.name}”？草稿会保留，任务记录仍可查看；停用期间不能应用 Agent 提案。`)) return;
    const plugins = enabled(definition.id) ? workspace!.plugins.filter((id) => id !== definition.id) : [...workspace!.plugins, definition.id];
    const next = await api<Workspace>("/configuration", "PATCH", { expectedRevision: workspace!.revision, plugins, layouts: workspace!.layouts }); setWorkspace(next);
    if (activeView?.pluginId === definition.id && !plugins.includes(definition.id)) setSide("resources");
  }
  async function publish(resource: StudioResource) {
    await api("/artifacts", "POST", { resourceId: resource.id, revision: resource.revision, clientRequestId: createComponentId() });
    await refresh(workspace!.id); setSide("handoffs"); setNotice("设计快照已发布。选择目标文档，预览交接后再确认。");
  }
  async function invoke(retry?: Invocation) {
    const current = retry ? sessions[retry.request.resourceId] : active;
    if (!current) throw new Error("请先选择资源");
    const definition = owner(current.base);
    const actionId = retry?.request.capabilityId || capability || definition?.capabilities[0]?.id;
    const action = definition?.capabilities.find((item) => item.id === actionId);
    if (!action) throw new Error("此资源没有可用的 Agent 能力");
    const input = retry ? retry.request.input || {} : action.prepareInput?.(selection) || {};
    const saved = dirty(current) ? await save(current.base.id) : current.base;
    if (dirty(sessionsRef.current[saved.id])) throw new Error("仍有新编辑未保存，请保存当前内容后再发送。");
    await api("/invocations", "POST", { resourceId: saved.id, revision: saved.revision,
      capabilityId: action.id, input,
      instruction: retry?.request.instruction || instruction, clientRequestId: createComponentId(), retryOf: retry?.id || null });
    setInstruction(""); await refresh(workspace!.id);
  }
  const commands = [
    { id: "save", label: "保存当前资源", disabled: busy || !active || !plugin || !enabled(plugin.id), run: () => { if (tab) void perform(() => save(tab)); } },
    { id: "reopen", label: "恢复关闭的标签", disabled: !closed.length, run: () => { const id = closed.at(-1); if (id) { setTab(id); setClosed(closed.slice(0, -1)); } } },
    ...[{ id: "agents", label: "Agent 列表" }, { id: "resources", label: "项目资源" }, { id: "plugins", label: "管理插件" }, { id: "tasks", label: "任务记录" }, { id: "handoffs", label: "版本化交接" }].map((view) => ({ id: `view.${view.id}`, label: view.label, menu: "view", disabled: false, run: () => showView(view.id) })),
    ...studioPlugins.filter((definition) => enabled(definition.id)).flatMap((definition) => definition.commands.map((command) => ({ ...command, disabled: busy || !host, run: () => { void perform(() => host!.execute(command.id)); } }))),
  ];
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (!commands[0].disabled) commands[0].run(); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "t") { event.preventDefault(); commands[1].run(); }
    };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  });

  if (!workspace) return <main className={s.start}><h1>插件工作区</h1><p>选择已有工作区，或组合工具开始新工作。</p>
    {error && <p role="alert">{error}</p>}
    <input aria-label="工作区名称" value={title} onChange={(event) => setTitle(event.target.value)} />
    <button disabled={busy || !title.trim()} onClick={() => void perform(async () => {
      const created = await studioApi<Workspace>("", "POST", { title, clientRequestId: createComponentId() }); window.location.assign(`/studio?workspace=${created.id}`);
    })}>创建工作区</button>
    {available.map((item) => <p key={item.id}><Link href={`/studio?workspace=${item.id}`}>{item.title}</Link></p>)}
    <Link href="/prd-studio">旧 PRD 文档入口（保留原数据）</Link>
  </main>;

  return <Workbench title={workspace.title} home={<Link href="/studio" aria-label="切换工作区">◈</Link>}
    layoutStorageKey={`nexus-studio:layout:local_user:${workspace.id}:${profile}`} commands={commands} menus={[
      { label: "文件", commands: commands.filter((command) => !("menu" in command) || command.menu === "file") },
      { label: "视图", commands: commands.filter((command) => "menu" in command && command.menu === "view") },
    ]}
    views={[{ id: "resources", label: "资源", icon: "▤" }, { id: "agents", label: "Agent", icon: "◇" }, { id: "plugins", label: "插件", icon: "⊞" }, { id: "handoffs", label: "交接", icon: "⇄" }, { id: "tasks", label: "任务", icon: "◷" }]}
    sidebarFocusToken={sidebarFocus} activeView={side} onView={(id) => { setSide(id); const view = contributedViews.find((item) => item.id === id); if (view && host) void perform(() => host.activate(view.pluginId)); }} status={active ? dirty(active) ? "本地草稿 · 待保存" : `已保存 r${active.base.revision}` : "空工作区"}
    sidebar={<div className={s.sidebar}>
      <PanelHeading>{side === "agents" ? "Agent 插件" : side === "plugins" ? "工作区插件" : side === "handoffs" ? "版本化交接" : side === "tasks" ? "任务记录" : activeView?.label || "资源"}</PanelHeading>
      {side === "agents" ? <AgentDirectory plugins={studioPlugins} enabled={enabled} onOpen={(definition) => setTab(`agent:${definition.id}`)} />
      : View && activeView && enabled(activeView.pluginId) ? <PluginErrorBoundary key={activeView.id} pluginId={activeView.pluginId}>
        <View resources={Object.values(sessions).filter((session) => session.base.resourceType === activeView.resourceType).map((session) => ({ ...session.base, payload: session.payload }))} onOpen={(resource) => setTab(resource.id)} />
      </PluginErrorBoundary> : side === "plugins" ? studioPlugins.map((definition) => <section key={definition.id}><strong>{definition.name}</strong><p>{host?.state(definition.id) || "registered"}</p>
        <button disabled={busy} onClick={() => void perform(() => toggle(definition))}>{enabled(definition.id) ? "停用" : "启用"}</button>
        {enabled(definition.id) && <button disabled={busy} onClick={() => void perform(() => host!.execute(definition.commands[0].id))}>新建</button>}
      </section>) : side === "handoffs" ? <>
        <p>快照不可变；先选择接收文档，再预览确认。</p>
        {artifacts.map((artifact) => <section key={artifact.id}><strong>设计 r{artifact.sourceRevision}</strong>
          {Object.values(sessions).filter((session) => owner(session.base)?.acceptsArtifacts?.includes(artifact.artifactType)).map((target) => <button key={target.base.id} disabled={busy || dirty(target)} onClick={() => void perform(async () => {
            await api("/handoffs", "POST", { artifactId: artifact.id, targetId: target.base.id, clientRequestId: createComponentId() }); await refresh(workspace.id);
          })}>交给 {owner(target.base)?.title(target.payload)}</button>)}
        </section>)}
        {handoffs.map((transfer) => <section key={transfer.id}><strong>{transfer.status === "succeeded" ? "已交接" : "待确认交接"} · 目标 r{transfer.expectedRevision}</strong>
          <details><summary>预览将写入的正文</summary><pre>{JSON.stringify(transfer.proposal, null, 2)}</pre></details>
          {transfer.status === "waiting_confirmation" && <button disabled={busy || Boolean(sessions[transfer.targetId] && dirty(sessions[transfer.targetId]))} onClick={() => void perform(async () => {
            await api(`/handoffs/${transfer.id}/apply`, "POST", { proposalDigest: transfer.proposalDigest, artifactDigest: transfer.artifactDigest }); await refresh(workspace.id); setTab(transfer.targetId);
          })}>确认并应用</button>}
        </section>)}
      </> : side === "tasks" ? invocations.slice().reverse().map((task) => <section key={task.id}><strong>{task.status}</strong><p>{task.request.instruction}</p><p>{task.error}</p>
        <p>资源 r{task.request.revision} · {task.request.capabilityId}</p>
        {task.request.input && Object.keys(task.request.input).length > 0 && <details><summary>本次调用范围</summary><pre>{JSON.stringify(task.request.input, null, 2)}</pre></details>}
        {task.execution?.stages && <button onClick={() => setTab(`run:${task.id}`)}>查看工作流</button>}
        {task.result?.answer && <p style={{ whiteSpace: "pre-wrap" }}>{task.result.answer}</p>}
        {task.result?.payload && <details><summary>查看修改提案</summary><pre>{JSON.stringify(task.result.payload, null, 2)}</pre></details>}
        {task.status === "waiting_confirmation" && <button disabled={busy || Boolean(sessions[task.request.resourceId] && dirty(sessions[task.request.resourceId]))} onClick={() => void perform(async () => {
          await api(`/invocations/${task.id}/apply`, "POST", { proposalDigest: task.result!.digest }); await refresh(workspace.id);
        })}>应用到原资源 r{task.request.revision}</button>}
        {["queued", "running", "waiting_confirmation"].includes(task.status) && <button disabled={busy} onClick={() => void perform(async () => { await api(`/invocations/${task.id}/cancel`, "POST"); await refresh(workspace.id); })}>取消</button>}
        {["failed", "cancelled", "interrupted"].includes(task.status) && <button disabled={busy} onClick={() => void perform(() => invoke(task))}>按当前版本重试</button>}
      </section>) : <>
        {Object.values(sessions).map((session) => <button key={session.base.id} onClick={() => setTab(session.base.id)}>{owner(session.base)?.icon} {owner(session.base)?.title(session.payload) || session.base.resourceType}{dirty(session) ? " ●" : ""}</button>)}
        {contributedViews.filter((view) => enabled(view.pluginId)).map((view) => <button key={view.id} onClick={() => setSide(view.id)}>{view.icon} {view.label}</button>)}
      </>}
    </div>}
    assistant={<div className={s.assistant}><PanelHeading>{plugin ? `${plugin.name} Agent` : "Agent"}</PanelHeading>
      <p>{active ? `上下文：${plugin?.title(active.payload)} · r${active.base.revision}` : "打开资源后开始对话"}</p>
      {selection !== null && <details><summary>当前选择</summary><pre>{JSON.stringify(selection, null, 2)}</pre></details>}
      <select aria-label="Agent 能力" value={capability || plugin?.capabilities[0]?.id || ""} onChange={(event) => setCapability(event.target.value)}>{plugin?.capabilities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <textarea aria-label="给 Agent 的指令" value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="描述目标；修改先生成提案，由你确认后应用" />
      <button disabled={busy || !instruction.trim() || !plugin || !enabled(plugin.id)} onClick={() => void perform(async () => { await invoke(); setSide("tasks"); })}>发送（保存上下文并生成提案）</button>
    </div>}>
    <EditorTabs tabs={openTabs.flatMap((id) => {
      const session = sessions[id];
      if (session) return [{ id, icon: owner(session.base)?.icon || "▤", label: `${owner(session.base)?.title(session.payload) || "资源"}${dirty(session) ? " ●" : ""}` }];
      const run = id.startsWith("run:") ? invocations.find((item) => item.id === id.slice(4)) : undefined;
      if (run) return [{ id, icon: "◇", label: `工作流 · ${run.request.instruction.slice(0, 20)}` }];
      const definition = id.startsWith("agent:") ? studioPlugins.find((item) => item.id === id.slice(6) && item.agent) : undefined;
      return definition ? [{ id, icon: definition.icon, label: `${definition.name} · Agent` }] : [];
    })}
      value={tab} onChange={setTab} closableIds={openTabs} onClose={(id) => { closeTab(id); setClosed((previous) => [...previous.filter((value) => value !== id), id]); }} />
    {error && <div role="alert" className={s.error}>{error}<button onClick={() => setError("")}>关闭</button></div>}
    {notice && <div role="status" className={s.notice}>{notice}<button onClick={() => setNotice("")}>关闭</button></div>}
    <div className={s.editors}>
      {!active && !selectedAgent && !selectedRun && <section className={s.empty}><h2>组合插件，开始工作</h2><p>关闭标签不会删除资源或取消任务。</p>{commands.slice(1).map((command) => <button key={command.id} disabled={command.disabled} onClick={command.run}>{command.label}</button>)}</section>}
      {selectedRun && <InvocationFlow key={selectedRun.id} task={selectedRun} onResource={() => setTab(selectedRun.request.resourceId)} />}
      {selectedAgent && <AgentDetail plugin={selectedAgent} enabled={enabled(selectedAgent.id)} busy={busy || !host} onRun={() => {
        if (host) void perform(() => host.execute(selectedAgent.agent!.launchCommand));
      }} />}
      {Object.entries(sessions).map(([id, session]) => {
        const definition = owner(session.base); const Editor = definition && editors.get(definition.id);
        if (!Editor || !definition) return id === tab ? <section key={id}><p>缺少资源编辑插件：{session.base.resourceType} · r{session.base.revision}</p><details><summary>查看只读资源数据</summary><pre>{JSON.stringify(session.payload, null, 2)}</pre></details></section> : null;
        // Document sessions and persisted code drafts outlive editor views.
        if (!openTabs.includes(id)) return null;
        return <div key={id} hidden={id !== tab}>
          {!enabled(definition.id) && <p>插件已停用，草稿已保留。<button onClick={() => setSide("plugins")}>管理插件</button></p>}
          {enabled(definition.id) && host?.state(definition.id) === "active" && <PluginErrorBoundary pluginId={definition.id}><Editor resource={{ ...session.base, payload: session.payload }} disabled={busy || id !== tab}
            onChange={(payload) => change(id, payload)} onSave={(payload) => save(id, payload)} onPublish={publish} onSelection={setSelection} onError={setError} /></PluginErrorBoundary>}
        </div>;
      })}
    </div>
  </Workbench>;
}
