/** User-facing Agent documentation contributed by the plugin that owns it. */
export interface AgentStage {
  id: string;
  label: string;
  purpose: string;
  capability?: string;
  participant?: { id: string; label: string; description: string };
}

export interface AgentProfile {
  version: string;
  launchCommand: string;
  summary: string;
  usage: readonly string[];
  stages: readonly AgentStage[];
  /** A viewer must distinguish declared candidates from agents selected for a run. */
  selection: "capability" | "fixed";
}
