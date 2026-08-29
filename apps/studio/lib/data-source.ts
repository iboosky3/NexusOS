import type {
  RunDetail,
  RunStatus,
  RunSummary,
  SkillDecisionView,
  TaskStatus,
} from "@/lib/contracts";
import { runDetail as sampleRunDetail, runs as sampleRuns } from "@/lib/sample-data";

interface ApiRunSummary {
  run_id: string;
  status: string;
  request: string;
  started_at: string;
  duration_ms: number;
  iteration: number;
  quality_score: number | null;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
}

interface ApiRunDetail {
  run_id: string;
  status: string;
  request: string;
  started_at: string;
  duration_ms: number;
  iteration: number;
  review: { overall_score: number | null; dimensions: Record<string, number> };
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  tasks: Array<{
    task_id: string;
    title: string;
    dependencies: string[];
    status: string;
    agent_id: string | null;
    skill_ids: string[];
  }>;
  routing: Array<{
    task_id: string;
    candidates: Array<{
      skill_id: string;
      score: number;
      reasons: Record<string, number>;
      instruction_tokens: number;
    }>;
  }>;
  artifacts: Array<{ name: string; media_type: string; size_bytes: number }>;
}

export interface LoadedData<T> {
  data: T;
  source: "api" | "snapshot";
  warning?: string;
}

const RUN_STATUSES = new Set<RunStatus>(["running", "succeeded", "blocked", "failed"]);
const TASK_STATUSES = new Set<TaskStatus>([
  "pending",
  "running",
  "succeeded",
  "failed",
  "blocked",
]);

export async function loadRunSummaries(): Promise<LoadedData<RunSummary[]>> {
  const baseUrl = process.env.NEXUS_API_URL;
  if (!baseUrl) {
    return { data: sampleRuns, source: "snapshot" };
  }
  try {
    const response = await fetch(`${trimSlash(baseUrl)}/v1/runs?limit=20`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const payload = (await response.json()) as { items: ApiRunSummary[] };
    return { data: payload.items.map(toRunSummary), source: "api" };
  } catch (error) {
    return {
      data: sampleRuns,
      source: "snapshot",
      warning: `运行 API 暂不可用：${errorMessage(error)}`,
    };
  }
}

export async function loadRunDetail(runId: string): Promise<LoadedData<RunDetail>> {
  const baseUrl = process.env.NEXUS_API_URL;
  if (!baseUrl) {
    return { data: { ...sampleRunDetail, id: runId }, source: "snapshot" };
  }
  try {
    const response = await fetch(`${trimSlash(baseUrl)}/v1/runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    return { data: toRunDetail((await response.json()) as ApiRunDetail), source: "api" };
  } catch (error) {
    return {
      data: { ...sampleRunDetail, id: runId },
      source: "snapshot",
      warning: `运行详情暂不可用：${errorMessage(error)}`,
    };
  }
}

function toRunSummary(run: ApiRunSummary): RunSummary {
  return {
    id: run.run_id,
    title: run.request,
    status: runStatus(run.status),
    startedAt: formatDateTime(run.started_at),
    duration: formatDuration(run.duration_ms),
    quality: run.quality_score,
    inputTokens: run.usage.input_tokens,
    outputTokens: run.usage.output_tokens,
  };
}

function toRunDetail(run: ApiRunDetail): RunDetail {
  return {
    id: run.run_id,
    title: run.request,
    request: run.request,
    project: "Nexus PRD",
    status: runStatus(run.status),
    startedAt: formatDateTime(run.started_at),
    duration: formatDuration(run.duration_ms),
    quality: run.review.overall_score,
    inputTokens: run.usage.input_tokens,
    outputTokens: run.usage.output_tokens,
    iteration: run.iteration,
    tasks: run.tasks.map((task) => ({
      id: task.task_id,
      title: task.title,
      agent: task.agent_id ?? "尚未分配",
      status: taskStatus(task.status),
      duration: "—",
      skills: task.skill_ids,
      dependencies: task.dependencies,
    })),
    routing: flattenRouting(run),
    review: run.review.dimensions,
    artifacts: run.artifacts.map((artifact) => ({
      name: artifact.name,
      mediaType: artifact.media_type,
      size: formatBytes(artifact.size_bytes),
    })),
  };
}

function flattenRouting(run: ApiRunDetail): SkillDecisionView[] {
  return run.routing.flatMap((decision) =>
    decision.candidates.map((candidate) => ({
      skillId: candidate.skill_id,
      score: candidate.score,
      selected: true,
      reasons: Object.entries(candidate.reasons)
        .filter(([, value]) => value > 0)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([signal, value]) => `${decision.task_id} · ${signal} ${(value * 100).toFixed(0)}%`),
      instructionTokens: candidate.instruction_tokens,
    })),
  );
}

function runStatus(value: string): RunStatus {
  return RUN_STATUSES.has(value as RunStatus) ? (value as RunStatus) : "failed";
}

function taskStatus(value: string): TaskStatus {
  return TASK_STATUSES.has(value as TaskStatus) ? (value as TaskStatus) : "failed";
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
