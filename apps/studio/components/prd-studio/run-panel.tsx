"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Job, PrototypePage, Review, prdApi } from "@/lib/prd-api";
import {
  ExecutionFlow,
  executionStatus,
} from "@/components/workbench/execution-flow";
import { DetailDialog } from "@/components/workbench/detail-dialog";
import { DocumentRenderer } from "@/components/workbench/document-renderer";
import { PrdRecovery } from "@/components/prd-recovery";
import s from "./run-panel.module.css";

const PrdTrace = dynamic(() =>
  import("@/components/prd-trace").then((m) => m.PrdTrace),
);
const titles: Record<string, string> = {
  brief: "需求简报",
  confirm: "确认原型",
  prototype: "交互原型",
  requirements: "需求分析",
  ux: "流程与异常",
  technical: "数据与可行性",
  "write-1": "背景与范围",
  "write-2": "功能需求",
  "write-3": "验收与交付",
  review: "质量评审",
};
const plans = {
  prototype: ["prototype"],
  generate: [
    "requirements",
    "ux",
    "technical",
    "write-1",
    "write-2",
    "write-3",
    "review",
  ],
  revise: ["write-1", "write-2", "write-3", "review"],
  review: ["review"],
};
interface Event {
  sequence: number;
  name: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}
const eventNames: Record<string, string> = {
  "job.queued": "任务已提交",
  "job.running": "开始运行",
  "job.configured": "流程已准备",
  "stage.started": "开始阶段",
  "capabilities.selected": "已选择执行能力",
  "model.requested": "正在请求模型",
  "model.responded": "模型已返回",
  "model.failed": "模型调用失败",
  "stage.succeeded": "阶段已完成",
  "stage.reused": "复用已有结果",
  "checkpoint.saved": "进度已保存",
  "artifact.version_created": "产物已保存",
  "review.published": "评审已保存",
  "job.succeeded": "任务完成",
  "job.failed": "任务失败",
  "job.cancelled": "任务停止",
  "stage.failed": "阶段失败",
  "stage.cancelled": "阶段停止",
};

export function PrdRunPanel({
  hasBrief,
  prototypeState,
  job,
  documentId,
  showThinking,
  locked,
  dirty,
  onExecute,
  onClose,
}: {
  hasBrief: boolean;
  prototypeState: "none" | "draft" | "confirmed";
  job: Job | null;
  documentId?: string;
  showThinking: boolean;
  locked: boolean;
  dirty: boolean;
  onExecute: (job: Job, mode: "restart" | "resume") => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<
    "overview" | "input" | "output" | "events"
  >("overview");
  const [follow, setFollow] = useState(true);
  const [view, setView] = useState<"output" | "events" | "history">("output");
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setFollow(true);
    setDialogOpen(false);
    setSelected("");
    setView("output");
  }, [job?.id]);
  const current =
    job?.steps.find((step) => step.status === "running")?.id ||
    job?.steps.at(-1)?.id;
  useEffect(() => {
    if (follow && current) setSelected(current);
  }, [current, follow]);
  useEffect(() => {
    if (!job) return;
    let disposed = false,
      cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    setEvents([]);
    setError("");
    async function poll() {
      try {
        const page = await prdApi<{
          items: Event[];
          next_cursor: number | null;
        }>(`jobs/${job!.id}/events?after=${cursor}&limit=100`);
        if (disposed) return;
        cursor = page.items.at(-1)?.sequence ?? cursor;
        setEvents((items) => [...items, ...page.items]);
        setError("");
        if (
          page.next_cursor !== null ||
          ["queued", "running"].includes(job!.status)
        )
          timer = setTimeout(poll, page.next_cursor !== null ? 50 : 2000);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "运行记录读取失败");
          timer = setTimeout(poll, 4000);
        }
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  const terminal =
    job && ["failed", "cancelled", "succeeded"].includes(job.status);
  const plan =
    job?.action === "prototype"
      ? ["prototype", ...plans.generate]
      : job?.plan || plans[job?.action || "generate"];
  const nodes = plan.map((id) => {
    const step = job?.steps.find((step) => step.id === id);
    return {
      id,
      title: titles[id] || step?.title || id,
      status:
        step?.status === "running" && terminal
          ? job!.status
          : step?.status ||
            (terminal && job?.action !== "prototype" ? "skipped" : "waiting"),
    };
  });
  if (!job || ["prototype", "generate"].includes(job.action)) {
    if (job?.action !== "prototype")
      nodes.unshift({
        id: "prototype",
        title: titles.prototype,
        status: prototypeState === "none" ? "waiting" : "succeeded",
      });
    nodes.unshift({
      id: "brief",
      title: titles.brief,
      status: hasBrief ? "succeeded" : "waiting",
    });
    nodes.splice(2, 0, {
      id: "confirm",
      title: titles.confirm,
      status: prototypeState === "confirmed" ? "succeeded" : "waiting",
    });
  }
  const edges = nodes.slice(1).map((node, index) => ({
    id: `${nodes[index].id}-${node.id}`,
    source: nodes[index].id,
    target: node.id,
  }));
  const step = job?.steps.find((step) => step.id === selected);
  const stream = job?.stream?.stage_id === selected ? job.stream : null;
  const visibleEvents = events.filter(
    (event) => !selected || event.payload.stage_id === selected,
  );
  const selectedNode = nodes.find((node) => node.id === selected);
  const started = visibleEvents.find((event) => event.name === "stage.started");
  const completed = [...visibleEvents]
    .reverse()
    .find((event) =>
      ["stage.succeeded", "stage.failed", "stage.cancelled"].includes(
        event.name,
      ),
    );
  const requests = visibleEvents.filter(
    (event) => event.name === "model.requested",
  );
  const responses = visibleEvents.filter(
    (event) => event.name === "model.responded",
  );
  const tokenCount = (key: string) =>
    responses.reduce(
      (sum, event) =>
        sum +
        (typeof event.payload[key] === "number"
          ? (event.payload[key] as number)
          : 0),
      0,
    );
  const output = stream?.content || step?.content || "";
  let designedPages: PrototypePage[] = [];
  let reviewResult: Pick<Review, "summary" | "issues"> | null = null;
  if (["prototype", "review"].includes(selected) && output) {
    try {
      const value = JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      if (
        Array.isArray(value?.pages) &&
        value.pages.every(
          (page: PrototypePage) =>
            page &&
            typeof page.title === "string" &&
            typeof page.description === "string",
        )
      )
        designedPages = value.pages;
      if (
        typeof value?.summary === "string" &&
        Array.isArray(value.issues) &&
        value.issues.every(
          (issue: Review["issues"][number]) =>
            issue &&
            typeof issue.section === "string" &&
            typeof issue.problem === "string" &&
            typeof issue.suggestion === "string",
        )
      )
        reviewResult = value;
    } catch {
      /* An incomplete streamed JSON design is still running. */
    }
  }
  return (
    <section
      className={`${s.panel} ${expanded ? s.expanded : ""}`}
      aria-label="运行工作区"
    >
      <header className={s.header}>
        <strong>运行</strong>
        <span role="status">
          {job
            ? `${job.action === "prototype" && job.status === "succeeded" ? (prototypeState === "confirmed" ? "等待编写 PRD" : "等待确认原型") : executionStatus[job.status] || job.status} · ${nodes.filter((n) => n.status === "succeeded").length}/${nodes.length} 阶段`
            : "尚未运行"}
        </span>
        <button aria-pressed={follow} onClick={() => setFollow(!follow)}>
          跟随进度
        </button>
        <button onClick={() => setExpanded(!expanded)}>
          {expanded ? "还原高度" : "展开面板"}
        </button>
        <button aria-label="收起运行面板" onClick={onClose}>
          ×
        </button>
      </header>
      <nav className={s.tabs} aria-label="运行详情">
        <button
          aria-pressed={view === "output"}
          onClick={() => setView("output")}
        >
          流程画布
        </button>
        <button
          aria-pressed={view === "events"}
          onClick={() => setView("events")}
        >
          运行记录
        </button>
        <button
          aria-pressed={view === "history"}
          onClick={() => setView("history")}
        >
          历史追溯
        </button>
      </nav>
      {view === "output" && job?.error && (
        <p className={s.flowError} role="alert">
          {job.error}
        </p>
      )}
      {view === "output" && (
        <ExecutionFlow
          nodes={nodes.map((node) => ({
            ...node,
            description:
              job?.steps.find((step) => step.id === node.id)?.agent_id ||
              (["brief", "confirm"].includes(node.id)
                ? "用户确认"
                : "执行阶段"),
          }))}
          edges={edges}
          follow={follow}
          onInteract={() => setFollow(false)}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setFollow(false);
            setDialogOpen(true);
            setDetailTab("overview");
          }}
        />
      )}
      {view !== "output" && (
        <div className={s.details}>
          {error && <p role="alert">{error}，正在重试…</p>}
          {job?.error && <p role="alert">{job.error}</p>}
          {job && (
            <PrdRecovery
              job={job}
              disabled={locked}
              dirty={dirty}
              onExecute={onExecute}
            />
          )}
          {view === "events" && (
            <>
              <p>
                完整运行时间线 · 输入 {job?.input_tokens || 0} / 输出{" "}
                {job?.output_tokens || 0} tokens
              </p>
              <ol className={s.events}>
                {events.map((event) => (
                  <li key={event.sequence}>
                    <time>
                      {new Date(event.occurred_at).toLocaleTimeString("zh-CN")}
                    </time>
                    <details>
                      <summary>
                        {eventNames[event.name] || "运行事件"}{" "}
                        {titles[String(event.payload.stage_id)] || ""}
                      </summary>
                      {typeof event.payload.duration_ms === "number" && (
                        <p>
                          耗时 {(event.payload.duration_ms / 1000).toFixed(1)}{" "}
                          秒
                        </p>
                      )}
                      {typeof event.payload.content === "string" && (
                        <pre>{event.payload.content}</pre>
                      )}
                      <details>
                        <summary>技术详情 · {event.name}</summary>
                        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                      </details>
                    </details>
                  </li>
                ))}
              </ol>
              {!events.length && <p>尚无运行记录。</p>}
            </>
          )}
          {view === "history" &&
            (documentId ? (
              <PrdTrace
                documentId={documentId}
                refreshKey={`${job?.id}:${job?.status}`}
                disabled={locked}
                dirty={dirty}
                onExecute={onExecute}
              />
            ) : (
              <p>保存并运行后，可在这里追溯历次任务。</p>
            ))}
        </div>
      )}
      {dialogOpen && selectedNode && (
        <DetailDialog
          title={selectedNode.title}
          subtitle={`${executionStatus[selectedNode.status] || selectedNode.status} · ${step?.agent_id || "准备环节"}`}
          onClose={() => setDialogOpen(false)}
        >
          <div className={s.details}>
            <nav className={s.tabs} aria-label="节点信息分类">
              {(["overview", "input", "output", "events"] as const).map(
                (tab, index) => (
                  <button
                    key={tab}
                    aria-pressed={detailTab === tab}
                    onClick={() => setDetailTab(tab)}
                  >
                    {["概览", "输入", "输出", "节点记录"][index]}
                  </button>
                ),
              )}
            </nav>
            {error && <p role="alert">{error}，正在重试读取记录。</p>}
            {detailTab === "overview" && (
              <>
                <dl className={s.metrics}>
                  <div>
                    <dt>执行状态</dt>
                    <dd>
                      {executionStatus[selectedNode.status] ||
                        selectedNode.status}
                    </dd>
                  </div>
                  <div>
                    <dt>耗时</dt>
                    <dd>
                      {typeof completed?.payload.duration_ms === "number"
                        ? `${(completed.payload.duration_ms / 1000).toFixed(2)} 秒`
                        : selectedNode.status === "running"
                          ? "正在执行"
                          : "尚无记录"}
                    </dd>
                  </div>
                  <div>
                    <dt>输入 / 输出 tokens</dt>
                    <dd>
                      {responses.length
                        ? `${tokenCount("input_tokens")} / ${tokenCount("output_tokens")}`
                        : "尚无响应记录"}
                    </dd>
                  </div>
                  <div>
                    <dt>模型调用</dt>
                    <dd>{requests.length} 次</dd>
                  </div>
                </dl>
                <h3>本节点任务</h3>
                <p>
                  {typeof started?.payload.objective === "string"
                    ? started.payload.objective
                    : selected === "brief"
                      ? "填写产品、用户、范围与约束；可在编辑区与 AI 一起完善需求。"
                      : selected === "confirm"
                        ? "核对原型页面及交互说明，确认后生成截图。"
                        : "任务开始后显示实际执行目标与输入输出。"}
                </p>
                {step && (
                  <>
                    <h3>执行能力</h3>
                    <p>Agent：{step.agent_id}</p>
                    <p>Skill：{step.skill_ids.join("、") || "无"}</p>
                  </>
                )}
                <p>
                  开始：
                  {started
                    ? new Date(started.occurred_at).toLocaleString("zh-CN")
                    : "尚无记录"}
                </p>
                {completed && (
                  <p>
                    结束：
                    {new Date(completed.occurred_at).toLocaleString("zh-CN")}
                  </p>
                )}
                {typeof completed?.payload.error_type === "string" && (
                  <p role="alert">失败原因：{completed.payload.error_type}</p>
                )}
                {["failed", "cancelled"].includes(selectedNode.status) &&
                  job?.error && <p role="alert">{job.error}</p>}
                {job &&
                  ["failed", "cancelled"].includes(selectedNode.status) && (
                    <PrdRecovery
                      job={job}
                      disabled={locked}
                      dirty={dirty}
                      onExecute={onExecute}
                    />
                  )}
              </>
            )}
            {detailTab === "input" && (
              <>
                <p>本节点实际发送的模型请求。多次调用可能来自重试或续写。</p>
                {!requests.length && (
                  <p>尚未记录模型输入；人工准备环节不发送模型请求。</p>
                )}
                {requests.map((event, index) => (
                  <section key={event.sequence}>
                    <h3>
                      调用 {index + 1} ·{" "}
                      {typeof event.payload.model === "string"
                        ? event.payload.model
                        : "模型"}
                    </h3>
                    {Array.isArray(event.payload.messages) &&
                      event.payload.messages.map((message: unknown, i) => {
                        if (
                          !message ||
                          typeof message !== "object" ||
                          !("content" in message) ||
                          typeof message.content !== "string"
                        )
                          return null;
                        return (
                          <details key={i}>
                            <summary>
                              {"role" in message && message.role === "system"
                                ? "执行指令"
                                : "任务上下文"}{" "}
                              · {i + 1}
                            </summary>
                            <pre>{message.content}</pre>
                          </details>
                        );
                      })}
                  </section>
                ))}
              </>
            )}
            {detailTab === "output" && (
              <>
                <p>
                  <strong>{titles[selected] || "选择节点查看运行详情"}</strong>
                  {step && (
                    <span>
                      {" "}
                      · Agent {step.agent_id} · Skill{" "}
                      {step.skill_ids.join("、") || "无"}
                    </span>
                  )}
                </p>
                {showThinking && stream?.reasoning_content && (
                  <details>
                    <summary>思考过程</summary>
                    <pre>{stream.reasoning_content}</pre>
                  </details>
                )}
                {selected === "brief" ? (
                  <p>需求在编辑区填写；AI 对话可辅助澄清。</p>
                ) : selected === "confirm" ? (
                  <p>
                    {prototypeState === "confirmed"
                      ? "用户已确认页面与交互，截图已准备。"
                      : "请在原型设计中核对页面和交互，并确认截图。"}
                  </p>
                ) : selected === "prototype" ? (
                  <>
                    {designedPages.map((page, index) => (
                      <div key={index}>
                        <strong>{page.title}</strong>
                        <p>{page.description}</p>
                      </div>
                    ))}
                    {!designedPages.length && (
                      <p>
                        {step?.status === "running"
                          ? "正在设计页面、组件与跳转…"
                          : "原型页面在编辑区预览和确认。"}
                      </p>
                    )}
                    {output && (
                      <details>
                        <summary>设计数据</summary>
                        <pre>{output}</pre>
                      </details>
                    )}
                  </>
                ) : selected === "review" ? (
                  <>
                    {reviewResult ? (
                      <>
                        <p>{reviewResult.summary}</p>
                        {reviewResult.issues.map((issue, index) => (
                          <div key={index}>
                            <strong>{issue.section}</strong>
                            <p>{issue.problem}</p>
                            <p>建议：{issue.suggestion}</p>
                          </div>
                        ))}
                      </>
                    ) : (
                      <p>
                        {step?.status === "running"
                          ? "正在检查需求和验收条件…"
                          : "此阶段尚无有效评审结果。"}
                      </p>
                    )}
                    {output && (
                      <details>
                        <summary>评审数据</summary>
                        <pre>{output}</pre>
                      </details>
                    )}
                  </>
                ) : output ? (
                  <DocumentRenderer content={output} />
                ) : (
                  <p>
                    {step?.status === "running"
                      ? "正在处理，等待模型输出…"
                      : "此阶段尚无输出。"}
                  </p>
                )}

                {visibleEvents.length > 0 && (
                  <small>
                    {visibleEvents.length} 条节点记录 ·
                    在“运行记录”中查看完整时间线
                  </small>
                )}
              </>
            )}

            {detailTab === "events" && (
              <>
                <p>{visibleEvents.length} 条节点记录</p>
                <ol className={s.events}>
                  {visibleEvents.map((event) => (
                    <li key={event.sequence}>
                      <time>
                        {new Date(event.occurred_at).toLocaleTimeString(
                          "zh-CN",
                        )}
                      </time>
                      <details>
                        <summary>
                          {eventNames[event.name] || event.name}
                        </summary>
                        {typeof event.payload.duration_ms === "number" && (
                          <p>
                            耗时 {(event.payload.duration_ms / 1000).toFixed(2)}{" "}
                            秒
                          </p>
                        )}
                        <details>
                          <summary>技术详情</summary>
                          <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                        </details>
                      </details>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </DetailDialog>
      )}
    </section>
  );
}
