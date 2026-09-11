"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Workbench, EditorTabs, PanelHeading } from "@/components/workbench/workbench";
import { CapabilityBrowser } from "@/components/workbench/capability-browser";
import { ExecutionFlow } from "@/components/workbench/execution-flow";
import { DocumentRenderer } from "@/components/workbench/document-renderer";
import { Plan, Run, PlanningError, planningApi, statusLabels } from "@/lib/planning-api";

export default function TaskWorkspace() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("resources");
  const [selected, setSelected] = useState("");
  const sending = useRef(false);
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const id = new URLSearchParams(window.location.search).get("plan");
        if (!id || !/^[a-f0-9]{32}$/.test(id)) throw new Error("缺少有效编排，请从首页开始。");
        const saved = await planningApi<Plan>(`plans/${id}`);
        const confirmation = await planningApi<{ digest: string }>(`plans/${id}/confirmation`);
        if (confirmation.digest !== saved.digest || saved.status !== "frozen") throw new Error("编排尚未确认，请返回编排页。");
        let current: Run | null = null;
        try { current = await planningApi<Run>(`plans/${id}/run`); }
        catch (err) { if (!(err instanceof PlanningError && err.status === 404)) throw err; }
        if (!disposed) { setPlan(saved); setSelected(saved.proposal?.tasks[0]?.id || ""); setRun(current); }
      } catch (err) { if (!disposed) setError((err as Error).message); }
    }
    void load(); return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!plan || !run || !["queued", "running"].includes(run.status)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = await planningApi<Run>(`plans/${plan!.id}/run`);
        if (!disposed) { setRun(current); setError(""); }
      } catch (err) { if (!disposed) setError((err as Error).message); }
      if (!disposed) timer = setTimeout(poll, 1500);
    }
    timer = setTimeout(poll, 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [plan?.id, run?.status]);
  async function start() {
    if (!plan || run || sending.current) return;
    sending.current = true; setBusy(true); setError("");
    try { setRun(await planningApi<Run>(`plans/${plan.id}/run`, { digest: plan.digest })); }
    catch (err) { setError((err as Error).message); }
    finally { sending.current = false; setBusy(false); }
  }
  const bindings = Object.values(plan?.bindings || {});
  const agentIds = new Set(bindings.map(b => b.agent.id));
  const skillIds = new Set(bindings.flatMap(b => b.skills.map(s => s.id)));
  const agents = (plan?.registry.agents || []).filter(a => agentIds.has(a.id));
  const skills = (plan?.registry.skills || []).filter(s => skillIds.has(s.id));
  const tasks = plan?.proposal?.tasks || [];
  const task = tasks.find(t => t.id === selected);
  const result = run?.tasks[selected];
  const commands = [{ id: "run", label: "运行已确认任务", run: () => void start(), disabled: !plan || busy || Boolean(run) }];
  return <Workbench title={plan?.intent?.goal || "任务工作台"} home={<Link href="/">✦</Link>}
    layoutStorageKey="nexus-task-workbench:layout:v1" commands={commands} menus={[{ label: "运行", commands }]}
    views={[{ id: "resources", label: "产物", icon: "▤" }, { id: "agents", label: "Agent", icon: "◇" }, { id: "skills", label: "Skill", icon: "✦" }, { id: "plugins", label: "插件", icon: "⊞" }]}
    activeView={view} onView={setView}
    sidebar={view === "agents" || view === "skills" ? <CapabilityBrowser kind={view} agents={agents} skills={skills} scoped /> : view === "plugins" ? <><PanelHeading>本任务插件</PanelHeading><p style={{ padding: 16 }}>未选用外部插件。当前执行环境仅支持文本模型调用，不包含联网、代码执行或文件修改能力。</p></> : <><PanelHeading>任务产物</PanelHeading><div style={{ padding: 12 }}>{tasks.map(t => <button key={t.id} style={{ display: "block", width: "100%", padding: 8 }} onClick={() => setSelected(t.id)}>{t.title} · {statusLabels[run?.tasks[t.id]?.status || "pending"]}</button>)}</div></>}
    bottom={<ExecutionFlow nodes={tasks.map(t => ({ id: t.id, title: t.title, status: run?.tasks[t.id]?.status === "blocked" ? "skipped" : run?.tasks[t.id]?.status === "pending" ? "waiting" : run?.tasks[t.id]?.status || "waiting" }))}
      edges={tasks.flatMap(t => t.dependencies.map(source => ({ id: `${source}-${t.id}`, source, target: t.id })))} selected={selected} onSelect={setSelected} />}
    status={run ? statusLabels[run.status] : "编排已确认 · 等待运行"}
    statusRight={<span>Agent {agents.length} · Skill {skills.length} · 插件 0 · Token {(run?.input_tokens || 0) + (run?.output_tokens || 0)}</span>}>
    <EditorTabs tabs={tasks.map(t => ({ id: t.id, label: t.title, icon: "▤" }))} value={selected} onChange={setSelected} />
    <div style={{ padding: 24, overflow: "auto", height: "100%" }}>
      {error && <p role="alert">{error} <Link href="/">返回首页</Link></p>}
      {!plan && !error && <p>正在装载已确认的任务工具…</p>}
      {plan && <>
        <p><Link href={`/orchestrate?plan=${plan.id}`}>查看或调整编排</Link> · v{plan.version} · 已确认能力集</p>
        {!run && <button className="primary-button" disabled={busy} onClick={() => void start()}>{busy ? "正在启动…" : "开始运行任务（调用模型）"}</button>}
        {task && <><h2>{task.title}</h2><p>{task.objective}</p><p>交付：{task.expected_output}</p>
          <details><summary>验收与执行能力</summary><p>{task.acceptance_criteria.join("；")}</p><p>Agent：{plan.bindings?.[task.id]?.agent.role}</p><p>Skill：{plan.bindings?.[task.id]?.skills.map(s => s.id).join("、") || "无"}</p></details>
          {result?.content ? <DocumentRenderer content={result.content} /> : <p>{statusLabels[result?.status || "pending"]}，完成后在此显示产物。</p>}
          {result?.error_type && <p role="alert">节点失败：{result.error_type}</p>}
        </>}
        {run && <p role="status">{run.error || run.notice}</p>}
      </>}
    </div>
  </Workbench>;
}
