"use client";

import { useId } from "react";
import { Job } from "@/lib/prd-api";

export function PrdRecovery({ job, disabled, dirty, onExecute, label }: {
  job: Job; disabled: boolean; dirty: boolean; label?: string;
  onExecute: (job: Job, mode: "restart" | "resume") => void;
}) {
  const reasonId = useId();
  if (!["failed", "cancelled"].includes(job.status)) return null;
  const reason = dirty ? "有未保存修改，请重新执行；继续执行需要保留原始需求和文档。" : job.recovery?.reason;
  return <div className="prd-recovery-actions">
    <div className="recovery-action-row">
      <div className="recovery-status"><strong>{label || (job.status === "failed" ? "任务失败" : "任务已停止")}</strong><span>可复用 {job.recovery?.completed_stages.length ?? 0} 个阶段</span></div>
      <div className="recovery-button-group" role="group" aria-label="任务恢复操作">
        <button className="recovery-button continue" disabled={disabled || dirty || !job.recovery?.can_resume} aria-describedby={reason ? reasonId : undefined} onClick={() => onExecute(job, "resume")}>继续执行</button>
        <button className="recovery-button" disabled={disabled} onClick={() => onExecute(job, "restart")}>重新执行</button>
      </div>
    </div>
    {reason && <p id={reasonId} className="recovery-reason">{reason}</p>}
    <details className="recovery-help"><summary>执行方式说明</summary><p>继续执行沿用原始输入，复用已完成阶段；重新执行保存当前输入并从头运行，已保存版本保留。未完成阶段重新调用模型可能产生费用。</p></details>
  </div>;
}
