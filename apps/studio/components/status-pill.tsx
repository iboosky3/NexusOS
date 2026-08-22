import type { RunStatus, TaskStatus } from "@/lib/contracts";

const labels: Record<RunStatus | TaskStatus, string> = {
  pending: "等待中",
  running: "运行中",
  succeeded: "已完成",
  blocked: "待处理",
  failed: "失败",
};

export function StatusPill({ status }: { status: RunStatus | TaskStatus }) {
  return <span className={`status-pill status-${status}`}>{labels[status]}</span>;
}
