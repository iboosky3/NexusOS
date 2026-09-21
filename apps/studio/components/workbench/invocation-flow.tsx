"use client";

import { useState } from "react";
import { ExecutionFlow } from "./execution-flow";
import { DetailDialog } from "./detail-dialog";
import s from "./invocation-flow.module.css";

export interface InvocationTrace {
  id: string;
  status: string;
  request: { resourceId: string; revision: number; instruction: string };
  execution?: {
    workflowVersion?: string;
    model: string;
    stages?: { id: string; title: string; objective: string; agent: { id: string; version: string }; skills: { id: string; version: string }[] }[];
  };
  progress?: Record<string, { status: string; content?: string; digest?: string; durationMs?: number; tokenUsage?: { input: number; output: number } }>;
  result?: { answer?: string };
}

const statusNames: Record<string, string> = {
  queued: "排队中", running: "执行中", waiting_confirmation: "等待人工确认", succeeded: "已完成",
  failed: "执行失败", cancel_requested: "正在停止", cancelled: "已停止", interrupted: "已中断",
};

function readableOutput(content?: string) {
  if (!content) return "尚无完成的阶段输出";
  try { return JSON.stringify(JSON.parse(content), null, 2); }
  catch { return content; }
}

/** Uses the server's recorded plan, never a PRD-specific list of stages. */
export function InvocationFlow({ task, onResource }: { task: InvocationTrace; onResource(): void }) {
  const [selected, setSelected] = useState("");
  const stages = task.execution?.stages || [];
  const current = stages.find((stage) => stage.id === selected);
  const progress = current && task.progress?.[current.id];
  const stopped = ["failed", "cancelled", "interrupted"].includes(task.status);
  const nodes = stages.map((stage) => {
    const recorded = task.progress?.[stage.id]?.status;
    return { id: stage.id, title: stage.title,
      status: recorded === "interrupted" ? "cancelled" : recorded || (stopped ? "skipped" : "waiting"),
      description: stage.agent.id };
  });
  const completed = nodes.filter((node) => node.status === "succeeded").length;
  return <article className={s.root} aria-label="Agent 工作流记录">
    <header><h1>工作流执行记录</h1><p>{task.request.instruction}</p>
      <p role="status">{statusNames[task.status] || task.status} · {completed} / {stages.length} 个阶段完成</p>
      <p>输入版本 r{task.request.revision} · {task.execution?.workflowVersion} · {task.execution?.model}</p>
      <button onClick={onResource}>返回原资源</button>
    </header>
    <ExecutionFlow nodes={nodes} edges={stages.slice(1).map((stage, index) => ({
      id: `${stages[index].id}:${stage.id}`, source: stages[index].id, target: stage.id,
    }))} selected={selected || stages.find((stage) => task.progress?.[stage.id]?.status === "running")?.id || ""} onSelect={setSelected} />
    <p>阶段完成不代表资源已保存。修改提案需在任务记录中确认；失败后可按当前版本重新执行，已有记录保留。</p>
    {task.result?.answer && <div className={s.output} aria-label="工作流结论">{task.result.answer}</div>}
    {current && <DetailDialog title={current.title} subtitle={`${current.agent.id} · v${current.agent.version}`} onClose={() => setSelected("")}>
      <details><summary>查看阶段指令</summary><p className={s.output}>{current.objective}</p></details>
      <p>Skill：{current.skills.map((skill) => `${skill.id} @ ${skill.version}`).join("、") || "未选择"}</p>
      {progress?.tokenUsage && <p>输入 {progress.tokenUsage.input} / 输出 {progress.tokenUsage.output} tokens · {progress.durationMs} ms</p>}
      <h3>阶段输出</h3><pre className={s.output}>{readableOutput(progress?.content)}</pre>
      {progress?.digest && <details><summary>输出摘要</summary><code>{progress.digest}</code></details>}
    </DetailDialog>}
  </article>;
}
