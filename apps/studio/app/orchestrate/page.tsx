"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { browserId } from "@/lib/browser-id";
import { ExecutionFlow } from "@/components/workbench/execution-flow";
import { Plan, Proposal, PlannedTask, planningApi, planDraft, statusLabels } from "@/lib/planning-api";

export default function OrchestratePage() {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const sending = useRef(false);
  function install(value: Plan) {
    setPlan(value); setProposal(value.proposal ? structuredClone(value.proposal) : null);
    setRequest(value.request.request); setSelected(value.proposal?.tasks[0]?.id || "");
    window.history.replaceState(null, "", `/orchestrate?plan=${value.id}`);
  }
  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const params = new URLSearchParams(window.location.search);
        const id = params.get("plan"), draft = params.get("draft");
        if (id && /^[a-f0-9]{32}$/.test(id)) {
          const value = await planningApi<Plan>(`plans/${id}`);
          if (!disposed) install(value);
        } else if (draft && /^[a-f0-9-]{36}$/.test(draft)) {
          const text = sessionStorage.getItem(`nexus-intent:${draft}`);
          if (!text) throw new Error("任务目标已过期，请从首页重新输入。");
          if (!disposed) setRequest(text);
          const value = await planDraft(draft, text);
          if (!disposed) install(value);
        } else throw new Error("请从首页输入任务目标。");
      } catch (err) { if (!disposed) setError((err as Error).message); }
      finally { if (!disposed) setBusy(false); }
    }
    void load(); return () => { disposed = true; };
  }, []);
  async function perform(action: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError("");
    try { await action(); } catch (err) { setError((err as Error).message); }
    finally { sending.current = false; setBusy(false); }
  }
  const dirty = JSON.stringify(proposal) !== JSON.stringify(plan?.proposal || null);
  const changedGoal = Boolean(plan && request.trim() !== plan.request.request);
  function edit(id: string, update: Partial<PlannedTask>) {
    setProposal(current => current && ({ ...current, tasks: current.tasks.map(t => t.id === id ? { ...t, ...update } : t) }));
  }
  const task = proposal?.tasks.find(t => t.id === selected);
  const agents = plan?.registry.agents || [];
  const skills = plan?.discovery?.skills || [];
  return <section className="panel" style={{ padding: 24, maxWidth: 1200, margin: "auto" }}>
    <p className="panel-kicker">目标 → 意图识别 → 能力检索 → 编排确认 → 专属工作台</p>
    <h1>为这项任务组装工具</h1>
    <p>AI 在已注册 Agent / Skill 库中检索候选并编排任务。你可以调整后确认；确认仅创建工作台，不会立即执行。</p>
    <textarea aria-label="任务目标" rows={3} maxLength={12000} style={{ width: "100%" }} value={request} disabled={busy} onChange={e => setRequest(e.target.value)} />
    <button disabled={busy || !request.trim()} onClick={() => void perform(async () => install(await planningApi<Plan>("plans", { request, supersedes: plan?.id || null })))}>按目标重新识别与编排</button>
    {busy && <p role="status">正在处理意图、检索能力或校验编排，请稍候…</p>}
    {error && <p role="alert">{error}</p>}
    {plan && <>
      <h2>编排 v{plan.version} · {statusLabels[plan.status]}</h2>
      {plan.intent && <p>{plan.intent.goal}<br />{plan.intent.rationale}（模型自评置信度 {Math.round(plan.intent.confidence * 100)}%）</p>}
      {plan.issues.length > 0 && <ul>{plan.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
      {plan.discovery && <details><summary>能力检索结果：{plan.discovery.agents.length} 个 Agent / {skills.length} 个 Skill 候选</summary><p>先根据意图排序注册元数据，再由模型选择；服务端校验完整能力覆盖和兼容性。</p><p>Agent：{plan.discovery.agents.map(a => a.role || a.id).join("、")}</p><p>Skill：{skills.map(s => s.id).join("、")}</p></details>}
      <p>插件 / 外部工具：当前文本运行环境未接入；需要联网、代码执行等能力的任务不会被当作已支持。</p>
    </>}
    {proposal && <>
      <p>{proposal.rationale}</p>
      <div style={{ height: 310 }}><ExecutionFlow nodes={proposal.tasks.map(t => ({ id: t.id, title: t.title, status: "waiting" }))}
        edges={proposal.tasks.flatMap(t => t.dependencies.map(source => ({ id: `${source}-${t.id}`, source, target: t.id })))} selected={selected} onSelect={setSelected} /></div>
      <fieldset disabled={busy} style={{ marginTop: 16 }}><legend>调整任务与能力</legend>
        <select aria-label="选择任务节点" value={selected} onChange={e => setSelected(e.target.value)}>{proposal.tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
        <button disabled={proposal.tasks.length >= 12} onClick={() => {
          const id = `task-${browserId().slice(0, 8)}`;
          setProposal({ ...proposal, tasks: [...proposal.tasks, { id, title: "新任务", objective: "请填写目标", dependencies: [], required_capabilities: [], required_tools: [], expected_output: "文本产物", acceptance_criteria: ["请填写验收条件"], risk: "low", output_tokens: 2000 }] }); setSelected(id);
        }}>添加节点</button>
        {task && <div style={{ display: "grid", gap: 12, padding: "16px 0" }}>
          <label>任务名称 <input value={task.title} maxLength={200} onChange={e => edit(task.id, { title: e.target.value })} /></label>
          <label>目标 <textarea style={{ width: "100%" }} value={task.objective} maxLength={4000} onChange={e => edit(task.id, { objective: e.target.value })} /></label>
          <label>所需能力（逗号分隔） <input value={task.required_capabilities.join(",")} onChange={e => edit(task.id, { required_capabilities: e.target.value.split(",") })} /></label>
          <label>Agent <select value={task.agent_id || ""} onChange={e => edit(task.id, { agent_id: e.target.value || null, skill_ids: null })}>
            <option value="">自动匹配</option>{agents.filter(a => task.required_capabilities.every(c => a.capabilities.includes(c.trim()))).map(a => <option key={a.id} value={a.id}>{a.role || a.id}</option>)}
          </select></label>
          <div>Skill（不兼容的选择会被拒绝）{skills.map(s => {
            const chosen = task.skill_ids ?? plan?.bindings?.[task.id]?.skills.map(item => item.id) ?? [];
            return <label key={s.id} style={{ display: "block" }}><input type="checkbox" checked={chosen.includes(s.id)} onChange={e => edit(task.id, { skill_ids: e.target.checked ? [...chosen, s.id] : chosen.filter(id => id !== s.id) })} />{s.id}</label>;
          })}</div>
          <div>前置依赖{proposal.tasks.filter(t => t.id !== task.id).map(t => <label key={t.id} style={{ display: "block" }}><input type="checkbox" checked={task.dependencies.includes(t.id)} onChange={e => edit(task.id, { dependencies: e.target.checked ? [...task.dependencies, t.id] : task.dependencies.filter(id => id !== t.id) })} />{t.title}</label>)}</div>
          <label>交付物 <input value={task.expected_output} onChange={e => edit(task.id, { expected_output: e.target.value })} /></label>
          <label>验收条件（每行一项）<textarea style={{ width: "100%" }} value={task.acceptance_criteria.join("\n")} onChange={e => edit(task.id, { acceptance_criteria: e.target.value.split("\n") })} /></label>
          <button disabled={proposal.tasks.length <= 1} onClick={() => {
            const tasks = proposal.tasks.filter(t => t.id !== task.id).map(t => ({ ...t, dependencies: t.dependencies.filter(id => id !== task.id) }));
            setProposal({ ...proposal, tasks }); setSelected(tasks[0]?.id || "");
          }}>删除当前节点（同步移除其依赖引用）</button>
        </div>}
      </fieldset>
      <p>实际绑定：{Object.entries(plan?.bindings || {}).map(([id, binding]) => `${proposal.tasks.find(t => t.id === id)?.title || id} → ${binding.agent.role || binding.agent.id} / ${binding.skills.map(s => s.id).join("、") || "无 Skill"}`).join("；")}{dirty && "（修改尚未校验，以上仍是已保存版本）"}</p>
      <button disabled={busy || !dirty || changedGoal || plan?.status !== "frozen"} onClick={() => void perform(async () => install(await planningApi<Plan>(`plans/${plan!.id}/revision`, { digest: plan!.digest, proposal })))}>校验并保存调整</button>
      <button className="primary-button" disabled={busy || dirty || changedGoal || plan?.status !== "frozen"} onClick={() => void perform(async () => {
        await planningApi(`plans/${plan!.id}/confirmation`, { digest: plan!.digest });
        router.push(`/workspace?plan=${plan!.id}`);
      })}>确认编排，打开专属工作台</button>
      {(dirty || changedGoal) && <p>存在未确认修改：目标变化需重新编排，节点调整需先校验保存。</p>}
    </>}
    <p><Link href="/">返回首页</Link> · <Link href="/prd-studio">使用 PRD 受控动态流程</Link></p>
  </section>;
}
