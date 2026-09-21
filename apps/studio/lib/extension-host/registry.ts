/** Trusted bundled contributions. No React or domain imports belong here. */
export interface PluginContributions {
  schemaVersion: 1;
  hostApiVersion: "1";
  dependencies: string[];
  commands?: { id: string; legacyCommand: string }[];
  editors: { id: string; label: string; icon: string; legacyTab: string }[];
  launcher: { id: string; label: string; icon: string; editorId: string };
}

export interface RegisteredManifest {
  id: string;
  name: string;
  contributions: PluginContributions;
  agentActions?: readonly string[];
}

export function createExtensionRegistry<T extends RegisteredManifest>(input: readonly T[]) {
  // Own the snapshot: later mutations cannot invalidate registration checks.
  const manifests = structuredClone(input) as T[];
  const byId = new Map<string, T>();
  const contributionIds = new Set<string>();
  const tabs = new Set<string>();
  const actions = new Map<string, T>();
  const commands = new Map<string, T>();
  for (const manifest of manifests) {
    if (!manifest.id || byId.has(manifest.id)) throw new Error(`Duplicate or empty plugin ID: ${manifest.id}`);
    byId.set(manifest.id, manifest);
    const c = manifest.contributions;
    if (c.schemaVersion !== 1 || c.hostApiVersion !== "1") throw new Error(`Unsupported plugin API: ${manifest.id}`);
    for (const item of [...c.editors, c.launcher, ...(c.commands ?? [])]) {
      if (!item.id.startsWith(`${manifest.id}.`) || contributionIds.has(item.id))
        throw new Error(`Invalid or duplicate contribution ID: ${item.id}`);
      contributionIds.add(item.id);
    }
    if (!c.editors.some((editor) => editor.id === c.launcher.editorId))
      throw new Error(`Unknown launcher editor: ${c.launcher.editorId}`);
    for (const editor of c.editors) {
      if (!editor.legacyTab || tabs.has(editor.legacyTab)) throw new Error(`Duplicate or empty editor tab: ${editor.legacyTab}`);
      tabs.add(editor.legacyTab);
    }
    for (const action of manifest.agentActions ?? []) {
      if (actions.has(action)) throw new Error(`Duplicate Agent action: ${action}`);
      actions.set(action, manifest);
    }
    for (const command of c.commands ?? []) {
      if (!command.legacyCommand || commands.has(command.legacyCommand))
        throw new Error(`Duplicate or empty command: ${command.legacyCommand}`);
      commands.set(command.legacyCommand, manifest);
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) throw new Error(`Cyclic plugin dependency: ${id}`);
    if (visited.has(id)) return;
    const manifest = byId.get(id);
    if (!manifest) throw new Error(`Missing plugin dependency: ${id}`);
    visiting.add(id);
    manifest.contributions.dependencies.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  manifests.forEach((manifest) => visit(manifest.id));
  function enabled(id: string, allows: (id: string) => boolean): boolean {
    const manifest = byId.get(id);
    return Boolean(manifest && allows(id) && manifest.contributions.dependencies.every((dependency) => enabled(dependency, allows)));
  }
  function freeze(value: object) {
    Object.values(value).forEach((child) => { if (child && typeof child === "object") freeze(child); });
    Object.freeze(value);
  }
  freeze(manifests);
  return {
    manifests: manifests as readonly T[],
    enabled,
    ownerOfAction: (action: string) => actions.get(action),
    ownerOfCommand: (command: string) => commands.get(command),
    ownerOfTab: (tab: string) => manifests.find((m) => m.contributions.editors.some((e) => e.legacyTab === tab)),
    editors: manifests.flatMap((m) => m.contributions.editors.map((e) => ({ ...e, pluginId: m.id }))),
    launchers: manifests.map((m) => ({ ...m.contributions.launcher, pluginId: m.id })),
    launchTab(id: string): string | undefined {
      const manifest = byId.get(id);
      return manifest?.contributions.editors.find((e) => e.id === manifest.contributions.launcher.editorId)?.legacyTab;
    },
  };
}
