import type { Capability } from "@/components/workbench/capability-browser";

export interface PlannedTask {
  id: string; title: string; objective: string; dependencies: string[];
  required_capabilities: string[]; required_tools: string[]; expected_output: string;
  acceptance_criteria: string[]; risk: "low" | "medium" | "high"; output_tokens: number;
  agent_id?: string | null; skill_ids?: string[] | null;
}
export interface Proposal { rationale: string; tasks: PlannedTask[] }
export interface Plan {
  id: string; version: number; status: string; digest: string;
  request: { request: string }; issues: string[]; proposal?: Proposal;
  intent?: { goal: string; confidence: number; rationale: string };
  bindings?: Record<string, { agent: Capability; skills: { id: string; version: string }[] }>;
  registry: { agents: Capability[]; skills: Capability[] };
  discovery?: { agents: Capability[]; skills: Capability[]; method: string };
  planning_usage: { input_tokens: number; output_tokens: number };
}
export interface Run {
  status: string; error?: string; notice?: string; input_tokens: number; output_tokens: number;
  tasks: Record<string, { status: string; content?: string; error_type?: string }>;
}
export class PlanningError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function planningApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/planning/${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new PlanningError(typeof value.detail === "string" ? value.detail : "输入不合法，请检查节点字段", response.status);
  return value;
}
// Deduplicate React Strict Mode mounts; failed model calls are never auto-retried.
const pending = new Map<string, Promise<Plan>>();
export function planDraft(id: string, request: string) {
  if (!pending.has(id)) {
    const key = `nexus-intent-result:${id}`;
    const saved = sessionStorage.getItem(key);
    if (saved && saved !== "pending") return planningApi<Plan>(`plans/${saved}`);
    if (saved === "pending") return Promise.reject(new Error("上次规划尚未返回或页面曾中断；不会自动重发模型请求。需要时请显式重新编排。"));
    sessionStorage.setItem(key, "pending");
    pending.set(id, planningApi<Plan>("plans", { request }).then(plan => {
      sessionStorage.setItem(key, plan.id);
      return plan;
    }));
  }
  return pending.get(id)!;
}
export const statusLabels: Record<string, string> = {
  frozen: "待确认", rejected: "校验未通过", needs_clarification: "请补充信息",
  queued: "排队中", running: "执行中", pending: "待执行", blocked: "未执行",
  succeeded: "已完成", failed: "失败", interrupted: "已中断",
};
