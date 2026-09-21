export interface Disposable { dispose(): void | Promise<void> }
export type PluginState = "registered" | "activating" | "active" | "draining" | "disabled" | "failed";
export type CommandHandler = (args: unknown) => unknown | Promise<unknown>;
export interface CommandDeclaration { id: string; validate(args: unknown): void }

export interface ActivationContext {
  commands: { register(id: string, handler: CommandHandler): Disposable };
  signal: AbortSignal;
  subscriptions: DisposableStore;
}
export interface PluginLifecycle {
  id: string;
  dependencies: readonly string[];
  commands?: readonly CommandDeclaration[];
  activate(context: ActivationContext): Promise<Disposable | void> | Disposable | void;
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Plugin lifecycle timed out; cleanup may still be running")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export class DisposableStore implements Disposable {
  private timeoutMs: number;
  constructor(timeoutMs = 5000) { this.timeoutMs = timeoutMs; }
  private items: Disposable[] = [];
  private closed = false;
  add<T extends Disposable>(item: T): T {
    if (this.closed) throw new Error("Subscription scope is already disposed");
    this.items.push(item);
    return item;
  }
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const item of this.items.reverse()) {
      try { await bounded(Promise.resolve().then(() => item.dispose()), this.timeoutMs); } catch (error) { errors.push(error); }
    }
    this.items = [];
    if (errors.length) throw new AggregateError(errors, "Plugin cleanup failed");
  }
}

/** Serializes state transitions per plugin; unrelated plugins activate independently. */
export class ExtensionHost {
  private definitions = new Map<string, PluginLifecycle>();
  private states = new Map<string, PluginState>();
  private pending = new Map<string, Promise<void>>();
  private draining = new Map<string, Promise<void>>();
  private scopes = new Map<string, { signal: AbortController; subscriptions: DisposableStore }>();
  private allowed = new Set<string>();
  private listeners = new Set<() => void>();
  private bindings = new Map<string, { owner: string; handler: CommandHandler; validate(args: unknown): void }>();
  private commandOwners = new Map<string, string>();
  private cleanupFailures = new Set<string>();
  private timeoutMs: number;
  constructor(definitions: readonly PluginLifecycle[], timeoutMs = 5000) {
    this.timeoutMs = timeoutMs;
    for (const definition of definitions) {
      if (this.definitions.has(definition.id)) throw new Error(`Duplicate plugin: ${definition.id}`);
      for (const command of definition.commands ?? []) {
        if (!command.id.startsWith(`${definition.id}.`) || this.commandOwners.has(command.id))
          throw new Error(`Invalid or duplicate command: ${command.id}`);
        this.commandOwners.set(command.id, definition.id);
      }
      this.definitions.set(definition.id, definition);
      this.states.set(definition.id, "registered");
      this.allowed.add(definition.id);
    }
    const visited = new Set<string>();
    const path = new Set<string>();
    const visit = (id: string) => {
      if (path.has(id)) throw new Error(`Cyclic dependency: ${id}`);
      if (visited.has(id)) return;
      const definition = this.definitions.get(id);
      if (!definition) throw new Error(`Unknown dependency: ${id}`);
      path.add(id); definition.dependencies.forEach(visit); path.delete(id); visited.add(id);
    };
    definitions.forEach(({ id }) => visit(id));
  }
  subscribe(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }
  state(id: string): PluginState { return this.states.get(id) ?? "disabled"; }
  private transition(id: string, state: PluginState) {
    this.states.set(id, state);
    this.listeners.forEach((listener) => { try { listener(); } catch { /* Observers cannot break lifecycle transitions. */ } });
  }
  activate(id: string): Promise<void> {
    if (this.cleanupFailures.has(id)) return Promise.reject(new Error(`Plugin cleanup incomplete; reload required: ${id}`));
    if (!this.allowed.has(id)) return Promise.reject(new Error(`Plugin disabled: ${id}`));
    const draining = this.draining.get(id);
    if (draining) return draining.then(() => this.activate(id));
    if (this.pending.has(id)) return this.pending.get(id)!;
    if (this.state(id) === "active") return Promise.resolve();
    const task = Promise.resolve().then(() => this.start(id));
    this.pending.set(id, task);
    void task.finally(() => { if (this.pending.get(id) === task) this.pending.delete(id); }).catch(() => {});
    return task;
  }
  private async start(id: string) {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown plugin: ${id}`);
    if (!this.allowed.has(id)) throw new Error(`Activation cancelled: ${id}`);
    this.transition(id, "activating");
    const scope = { signal: new AbortController(), subscriptions: new DisposableStore(this.timeoutMs) };
    this.scopes.set(id, scope);
    try {
      for (const dependency of definition.dependencies) await this.activate(dependency);
      if (!this.allowed.has(id)) throw new Error(`Plugin disabled: ${id}`);
      const resource = await definition.activate({
        signal: scope.signal.signal, subscriptions: scope.subscriptions,
        commands: { register: (commandId, handler) => {
          const command = definition.commands?.find((value) => value.id === commandId);
          if (!command || this.bindings.has(commandId) || scope.signal.signal.aborted)
            throw new Error(`Undeclared, duplicate or cancelled command: ${commandId}`);
          const binding = { owner: id, handler, validate: command.validate };
          this.bindings.set(commandId, binding);
          return scope.subscriptions.add({ dispose: () => {
            if (this.bindings.get(commandId) === binding) this.bindings.delete(commandId);
          } });
        } },
      });
      if (resource) {
        if (scope.signal.signal.aborted) await bounded(Promise.resolve().then(() => resource.dispose()), this.timeoutMs);
        else scope.subscriptions.add(resource);
      }
      if (!this.allowed.has(id) || scope.signal.signal.aborted) throw new Error(`Activation cancelled: ${id}`);
      this.transition(id, "active");
    } catch (error) {
      scope.signal.abort();
      this.removeBindings(id);
      try { await scope.subscriptions.dispose(); } catch (cleanup) {
        this.cleanupFailures.add(id);
        throw new AggregateError([error, cleanup], "Activation and cleanup failed");
      } finally {
        this.scopes.delete(id);
        this.transition(id, this.allowed.has(id) || this.cleanupFailures.has(id) ? "failed" : "disabled");
      }
      throw error;
    }
  }
  disable(id: string): Promise<void> {
    this.allowed.delete(id);
    const previous = this.draining.get(id);
    if (previous) return previous;
    const task = this.drain(id);
    this.draining.set(id, task);
    void task.finally(() => { if (this.draining.get(id) === task) this.draining.delete(id); }).catch(() => {});
    return task;
  }
  private removeBindings(id: string) {
    for (const [key, binding] of this.bindings) if (binding.owner === id) this.bindings.delete(key);
  }
  async execute(commandId: string, args?: unknown) {
    const id = this.commandOwners.get(commandId);
    if (!id) throw new Error(`Unknown command: ${commandId}`);
    await this.activate(id);
    const binding = this.bindings.get(commandId);
    if (!binding || !this.allowed.has(id) || this.state(id) !== "active")
      throw new Error(`Command unavailable: ${commandId}`);
    binding.validate(args);
    return binding.handler(args);
  }
  private async drain(id: string): Promise<void> {
    const errors: unknown[] = [];
    this.transition(id, "draining");
    this.removeBindings(id);
    this.scopes.get(id)?.signal.abort();
    for (const definition of this.definitions.values()) {
      if (definition.dependencies.includes(id) && this.allowed.has(definition.id)) {
        try { await this.disable(definition.id); } catch (error) { errors.push(error); }
      }
    }
    try { await bounded((this.pending.get(id) ?? Promise.resolve()).catch(() => {}), this.timeoutMs); }
    catch (error) { errors.push(error); }
    const scope = this.scopes.get(id);
    try { await scope?.subscriptions.dispose(); } catch (error) { errors.push(error); }
    this.scopes.delete(id);
    if (errors.length) this.cleanupFailures.add(id);
    this.transition(id, this.cleanupFailures.has(id) ? "failed" : this.allowed.has(id) ? "registered" : "disabled");
    if (errors.length) throw new AggregateError(errors, "Plugin drain incomplete; reload required");
  }
  enable(id: string) {
    if (!this.definitions.has(id)) throw new Error(`Unknown plugin: ${id}`);
    this.allowed.add(id);
    if (this.state(id) === "disabled") this.transition(id, "registered");
  }
  async dispose() {
    const errors: unknown[] = [];
    for (const id of this.definitions.keys()) {
      try { await this.disable(id); } catch (error) { errors.push(error); }
    }
    this.listeners.clear();
    if (errors.length) throw new AggregateError(errors, "Host cleanup failed");
  }
}
