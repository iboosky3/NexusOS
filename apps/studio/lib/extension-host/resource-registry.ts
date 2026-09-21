import type { AgentProfile } from "../plugin-sdk/agent";

/** Validate trusted resource contributions without importing React or domain modules. */
interface ResourceContribution {
  id: string;
  schemaVersion: number;
  hostApiVersion: string;
  dependencies: readonly string[];
  resourceType: string;
  views?: readonly { id: string }[];
  capabilities?: readonly { id: string }[];
  agent?: AgentProfile;
  commands: readonly { id: string; label: string; menu: string; validate(args: unknown): void }[];
}
export function registerResourcePlugins<T extends ResourceContribution>(input: readonly T[]): readonly T[] {
  const plugins = new Map<string, T>();
  const resources = new Set<string>();
  const commands = new Set<string>();
  for (const plugin of input) {
    if (plugins.has(plugin.id) || !plugin.id || resources.has(plugin.resourceType)) throw new Error(`Duplicate plugin or resource type: ${plugin.id}`);
    if (plugin.schemaVersion !== 1 || plugin.hostApiVersion !== "1") throw new Error(`Unsupported plugin API: ${plugin.id}`);
    plugins.set(plugin.id, plugin); resources.add(plugin.resourceType);
    if (plugin.capabilities?.length && !plugin.agent) throw new Error(`Missing Agent profile: ${plugin.id}`);
    if (plugin.agent) {
      if (!plugin.capabilities?.length || !plugin.agent.version.trim() || !plugin.agent.summary.trim() ||
          !plugin.agent.usage.length || !plugin.agent.stages.length ||
          !["capability", "fixed"].includes(plugin.agent.selection)) throw new Error(`Invalid Agent profile: ${plugin.id}`);
      if (!plugin.commands.some((command) => command.id === plugin.agent!.launchCommand)) throw new Error(`Unknown Agent launch command: ${plugin.id}`);
      const stages = new Set<string>();
      for (const stage of plugin.agent.stages) {
        if (!stage.id || stages.has(stage.id) || !stage.label.trim() || !stage.purpose.trim() ||
            (stage.capability && !stage.capability.trim())) throw new Error(`Invalid Agent stage: ${plugin.id}`);
        stages.add(stage.id);
      }
    }
    for (const view of plugin.views ?? []) {
      if (!view.id.startsWith(`${plugin.id}.`) || commands.has(view.id)) throw new Error(`Invalid view: ${view.id}`);
      commands.add(view.id);
    }
    for (const command of plugin.commands) {
      if (!command.id.startsWith(`${plugin.id}.`) || commands.has(command.id)) throw new Error(`Invalid command: ${command.id}`);
      if (!["file", "view", "editor.toolbar", "resource.context"].includes(command.menu)) throw new Error(`Unknown menu: ${command.menu}`);
      commands.add(command.id);
    }
  }
  const visited = new Set<string>();
  function visit(id: string, path = new Set<string>()) {
    if (path.has(id)) throw new Error(`Cyclic dependency: ${id}`);
    if (visited.has(id)) return;
    const plugin = plugins.get(id);
    if (!plugin) throw new Error(`Unknown dependency: ${id}`);
    const next = new Set(path).add(id);
    plugin.dependencies.forEach((dependency) => visit(dependency, next));
    visited.add(id);
  }
  input.forEach((plugin) => visit(plugin.id));
  // Copy declaration containers; never freeze imported React components or loader functions.
  function freezeProfile(profile: AgentProfile | undefined): AgentProfile | undefined {
    if (!profile) return undefined;
    return Object.freeze({ ...profile, usage: Object.freeze([...profile.usage]),
      stages: Object.freeze(profile.stages.map((stage) => Object.freeze({ ...stage,
        participant: stage.participant ? Object.freeze({ ...stage.participant }) : undefined,
      }))),
    });
  }
  return Object.freeze(input.map((plugin) => Object.freeze({ ...plugin,
    dependencies: Object.freeze([...plugin.dependencies]),
    agent: freezeProfile(plugin.agent),
    views: Object.freeze((plugin.views ?? []).map((view) => Object.freeze({ ...view }))),
    commands: Object.freeze(plugin.commands.map((command) => Object.freeze({ ...command }))),
  })));
}
