export type RunStatus = "running" | "succeeded" | "blocked" | "failed";
export type TaskStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";

export interface RunSummary {
  id: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  duration: string;
  quality: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface TaskView {
  id: string;
  title: string;
  agent: string;
  status: TaskStatus;
  duration: string;
  skills: string[];
  dependencies: string[];
}

export interface SkillDecisionView {
  skillId: string;
  score: number;
  selected: boolean;
  reasons: string[];
  instructionTokens: number;
}

export interface RunDetail extends RunSummary {
  request: string;
  project: string;
  iteration: number;
  tasks: TaskView[];
  routing: SkillDecisionView[];
  review: Record<string, number>;
  artifacts: Array<{ name: string; mediaType: string; size: string }>;
}
