/** Validate trusted resource contributions without importing React or domain modules. */
interface ResourceContribution {
  id: string;
  schemaVersion: number;
  hostApiVersion: string;
  dependencies: readonly string[];
  resourceType: string;
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
  return Object.freeze(input.map((plugin) => Object.freeze({ ...plugin,
    dependencies: Object.freeze([...plugin.dependencies]),
    commands: Object.freeze(plugin.commands.map((command) => Object.freeze({ ...command }))),
  })));
}
