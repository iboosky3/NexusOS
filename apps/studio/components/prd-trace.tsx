"use client";

import { useEffect, useState } from "react";
import { PrdRecovery } from "@/components/prd-recovery";
import { Job, prdApi } from "@/lib/prd-api";

interface TraceEvent {
  sequence: number; event_id: string; name: string; occurred_at: string;
  trace_id: string; span_id: string; parent_span_id: string | null;
  job_id: string | null; payload_hash: string; payload: Record<string, unknown>;
}
interface JobSummary extends Job {
  action: "generate" | "revise" | "review"; instruction: string; created_at: string;
  trace_id?: string; input_version?: number; input_revision?: number;
  retry_of_job_id?: string | null; trace_available: boolean;
}
interface TraceBundle {
  schema_version: string; coverage: string; job: JobSummary;
  input: Record<string, unknown> | null; events: TraceEvent[];
  artifacts: { version: number; parent_version: number; origin_job_id: string; snapshot_hash: string }[];
  notice: string;
}
interface EventPage { items: TraceEvent[]; next_cursor: number | null; notice: string }
const labels: Record<string, string> = {
  "stage.reused": "复用已完成阶段", "checkpoint.saved": "保存阶段检查点",
  "checkpoint.runtime_recovered": "恢复 LangGraph 节点", "artifact.reused": "沿用已保存正文",
  "document.created": "创建文档", "document.saved": "保存编辑",
  "artifact.version_created": "保存产物版本", "job.queued": "提交任务与输入快照",
  "job.running": "开始执行", "job.configured": "运行配置",
  "stage.started": "阶段开始", "capabilities.selected": "选择 Agent 与 Skill",
  "context.rejected": "上下文预算超限", "model.requested": "发送模型请求",
  "model.responded": "收到模型响应", "model.failed": "模型调用失败",
  "model.cancelled": "停止等待模型", "stage.succeeded": "阶段完成",
  "stage.failed": "阶段失败", "stage.cancelled": "阶段停止",
  "review.published": "保存评审", "job.succeeded": "任务完成",
  "job.failed": "任务失败", "job.cancelled": "任务停止", "job.interrupted": "服务中断",
  "stage.interrupted": "阶段中断", "job.cancel_requested": "请求停止任务",
};
const actions: Record<string, string> = { generate: "生成", revise: "修订", review: "评审" };
const statuses: Record<string, string> = { queued: "排队", running: "执行中", succeeded: "完成", failed: "失败", cancelled: "已停止" };
const date = (text: string) => new Date(text).toLocaleString("zh-CN");

function EventList({ events }: { events: TraceEvent[] }) {
  return <ol className="trace-events">{events.map(event => <li key={event.event_id}>
    <details>
      <summary><span className="trace-sequence">#{event.sequence}</span><strong>{labels[event.name] || event.name}</strong>
        <span className="trace-stage">{typeof event.payload.stage_id === "string" ? event.payload.stage_id : ""}</span>
        <time dateTime={event.occurred_at}>{date(event.occurred_at)}</time></summary>
      <dl className="trace-identifiers"><dt>事件</dt><dd>{event.event_id}</dd><dt>Trace</dt><dd>{event.trace_id}</dd><dt>Span / Parent</dt><dd>{event.span_id} / {event.parent_span_id || "根节点"}</dd><dt>内容 SHA-256</dt><dd>{event.payload_hash}</dd></dl>
      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
    </details>
  </li>)}</ol>;
}

export function PrdTrace({ documentId, refreshKey, disabled, dirty, onExecute }: {
  documentId: string; refreshKey: string; disabled: boolean; dirty: boolean;
  onExecute: (job: Job, mode: "restart" | "resume") => void;
}) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsCursor, setJobsCursor] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<TraceBundle | null>(null);
  const [timeline, setTimeline] = useState<EventPage | null>(null);
  const [view, setView] = useState<"jobs" | "timeline">("jobs");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let disposed = false;
    setError("");
    prdApi<{ items: JobSummary[]; next_cursor: number | null }>(`documents/${documentId}/jobs?limit=30`)
      .then(result => { if (!disposed) { setJobs(result.items); setJobsCursor(result.next_cursor); setSelectedId(current => current || result.items[0]?.id || null); } })
      .catch(err => { if (!disposed) setError(err.message); });
    return () => { disposed = true; };
  }, [documentId, refreshKey, refresh]);

  useEffect(() => {
    if (!selectedId || view !== "jobs") return;
    let disposed = false;
    setLoading(true); setError(""); setBundle(null);
    prdApi<TraceBundle>(`jobs/${selectedId}/trace`)
      .then(result => { if (!disposed) setBundle(result); })
      .catch(err => { if (!disposed) setError(err.message); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [selectedId, view, refreshKey, refresh]);

  useEffect(() => {
    if (view !== "timeline") return;
    let disposed = false;
    setLoading(true); setError("");
    prdApi<EventPage>(`documents/${documentId}/trace?limit=50`)
      .then(result => { if (!disposed) setTimeline(result); })
      .catch(err => { if (!disposed) setError(err.message); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [documentId, view, refresh]);

  async function more() {
    setLoading(true); setError("");
    try {
      if (view === "timeline" && timeline?.next_cursor != null) {
        const page = await prdApi<EventPage>(`documents/${documentId}/trace?limit=50&after=${timeline.next_cursor}`);
        setTimeline({ ...page, items: [...timeline.items, ...page.items] });
      } else if (jobsCursor != null) {
        const page = await prdApi<{ items: JobSummary[]; next_cursor: number | null }>(`documents/${documentId}/jobs?limit=30&before=${jobsCursor}`);
        setJobs(current => [...current, ...page.items]); setJobsCursor(page.next_cursor);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "读取失败"); }
    finally { setLoading(false); }
  }

  function exportTrace() {
    if (!bundle) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `prd-trace-${bundle.job.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="panel editor-panel trace-panel">
    <div className="document-toolbar"><h2>全程追溯</h2><button className="secondary-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新记录</button></div>
    <p className="field-hint">查看每次执行的输入、能力选择、模型调用与产物。旧任务缺失的记录会明确标注。</p>
    <div className="trace-view-tabs"><button className={view === "jobs" ? "text-button selected" : "text-button"} onClick={() => setView("jobs")}>任务历史</button><button className={view === "timeline" ? "text-button selected" : "text-button"} onClick={() => setView("timeline")}>文档时间线</button></div>
    {error && <p role="alert" className="prd-alert error">{error}</p>}
    {view === "jobs" && <>
      {jobs.length ? <label>选择一次任务<select className="trace-select" aria-label="选择追溯任务" value={selectedId || ""} onChange={event => setSelectedId(event.target.value)}>{jobs.map(job => <option key={job.id} value={job.id}>{date(job.created_at)} · {actions[job.action]} · {statuses[job.status]} · {job.id.slice(0, 8)}</option>)}</select></label> : <p className="field-hint">尚无生成任务；手动编辑记录可以在文档时间线查看。</p>}
      {jobsCursor != null && <button className="text-button" disabled={loading} onClick={() => void more()}>加载更早任务</button>}
      {bundle && <>
        <div className="trace-summary">{["failed", "cancelled"].includes(bundle.job.status)
          ? <PrdRecovery job={bundle.job} disabled={disabled} dirty={dirty} onExecute={onExecute} label={`${actions[bundle.job.action]} · ${statuses[bundle.job.status]}`} />
          : <strong>{actions[bundle.job.action]} · {statuses[bundle.job.status]}</strong>}<span>起始版本 {bundle.job.input_version == null ? "未记录" : `v${bundle.job.input_version}`} / 修订号 {bundle.job.input_revision ?? "未记录"}</span><code>Trace {bundle.job.trace_id || "历史任务未记录"}</code><code>任务 {bundle.job.id}</code>{bundle.job.retry_of_job_id && <p>重新执行自 <button className="text-button" onClick={() => { setSelectedId(bundle.job.retry_of_job_id!); }}>{bundle.job.retry_of_job_id}</button></p>}</div>
        {bundle.coverage === "legacy_incomplete" && <p className="prd-alert">此任务在追溯功能上线前执行，仅保留原有阶段结果，缺少当时的模型请求和输入快照。</p>}
        {bundle.job.resume_of_job_id && <p className="field-hint">继续执行自 {bundle.job.resume_of_job_id}</p>}
        <div className="document-toolbar"><button className="secondary-button" onClick={exportTrace}>导出追溯 JSON</button></div>
        <p className="field-hint">导出包含原始需求、参考材料和模型对话。</p>
        {bundle.job.error && <p className="prd-alert error">{bundle.job.error}</p>}
        <details className="trace-input"><summary>本次任务输入快照</summary><pre>{bundle.input ? JSON.stringify(bundle.input, null, 2) : "未记录"}</pre></details>
        {bundle.artifacts.length > 0 && <div className="trace-artifacts"><h3>产物来源</h3>{bundle.artifacts.map(artifact => <p key={artifact.version}>v{artifact.parent_version} → <strong>v{artifact.version}</strong><small>内容校验 {artifact.snapshot_hash}</small></p>)}</div>}
        <EventList events={bundle.events} />
        {bundle.coverage === "legacy_incomplete" && <details className="trace-input"><summary>旧任务已有记录</summary><pre>{JSON.stringify(bundle.job, null, 2)}</pre></details>}
      </>}
    </>}
    {view === "timeline" && timeline && <><p className="field-hint">{timeline.notice}</p><EventList events={timeline.items} />{timeline.next_cursor != null && <button className="secondary-button" disabled={loading} onClick={() => void more()}>加载后续事件</button>}</>}
    {loading && <p role="status">正在读取追溯记录…</p>}
  </section>;
}
