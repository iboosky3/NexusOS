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

export type AiMode = "brainstorm" | "professional";
export type WorkspaceView = "prd" | "design" | "preview" | "split";

export interface PrototypeStyle {
  width?: string;
  minHeight?: string;
  padding?: string;
  margin?: string;
  display?: string;
  justifyContent?: string;
  alignItems?: string;
  textAlign?: "left" | "center" | "right";
}

export interface ScreenshotReference {
  id: string;
  prototypeVersion: number;
  nodeId?: string;
  imageDataUrl?: string;
  purpose: string;
  insertedAt: string;
}

export interface WorkspaceEvent {
  id: string;
  sequence: number;
  action: string;
  summary: string;
  resourceKind: "workspace" | "prd" | "prototype" | "screenshot" | "assistant";
  resourceVersion?: number;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface WorkspaceDocument {
  projectId: string;
  title: string;
  aiMode: AiMode;
  prd: string;
  prdVersion: number;
  prototypeHtml: string;
  prototypeVersion: number;
  selectedNodeId?: string;
  screenshots: ScreenshotReference[];
  events: WorkspaceEvent[];
  updatedAt: string;
}
