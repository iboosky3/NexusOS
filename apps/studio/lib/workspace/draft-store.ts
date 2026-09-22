/** Durable draft branches. Every page lifetime writes a new branch, including duplicated tabs. */
export interface StoragePort {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
type Reference = { id: string; stamp: string };
export interface DraftRecord {
  version: 1; id: string; scope: string; stamp: string; updatedAt: number;
  parents: Reference[]; data: unknown;
}
export interface DraftCandidate { id: string; raw: string; record?: DraftRecord }
const namespace = "nexus:drafts:v1:";
const pointer = (scope: string) => `nexus:draft-pointer:${scope}`;
const prefix = (scope: string) => `${namespace}${encodeURIComponent(scope)}:`;
const isReference = (value: unknown): value is Reference => Boolean(value && typeof value === "object" &&
  typeof (value as Reference).id === "string" && typeof (value as Reference).stamp === "string");

export function decodeDraft(raw: string, scope: string, id: string): DraftRecord {
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || value.scope !== scope || value.id !== id ||
      typeof value.stamp !== "string" || !Number.isFinite(value.updatedAt) ||
      !Array.isArray(value.parents) || !value.parents.every(isReference) || !("data" in value)) {
    throw new Error("草稿格式损坏，原始记录已保留，可下载后检查");
  }
  return value;
}

export class DraftStore {
  private branches = new Map<string, { id: string; parents: Reference[] }>();
  private durable: StoragePort;
  private session: StoragePort;
  private uuid: () => string;
  constructor(durable: StoragePort, session: StoragePort, uuid: () => string) {
    this.durable = durable; this.session = session; this.uuid = uuid;
  }

  read(scope: string): DraftRecord | undefined {
    const branch = this.branches.get(scope);
    const id = branch?.id || this.session.getItem(pointer(scope));
    if (!id) return;
    const raw = this.durable.getItem(prefix(scope) + id);
    if (raw !== null) return decodeDraft(raw, scope, id);
  }

  resume(scope: string, validate: (data: unknown) => unknown): DraftRecord | undefined {
    const record = this.read(scope);
    if (!record) return;
    try { validate(record.data); }
    catch (failure) {
      // Subsequent edits must not consume a structurally valid envelope with damaged domain data.
      this.branches.set(scope, { id: this.uuid(), parents: [] });
      throw failure;
    }
    if (!this.branches.has(scope)) {
      const raw = this.durable.getItem(prefix(scope) + record.id)!;
      this.adopt(scope, { id: record.id, raw, record });
    }
    return this.read(scope);
  }

  list(scope: string): DraftCandidate[] {
    const entries: DraftCandidate[] = [];
    for (let i = 0; i < this.durable.length; i++) {
      const key = this.durable.key(i);
      if (!key?.startsWith(prefix(scope))) continue;
      const raw = this.durable.getItem(key);
      if (raw === null) continue;
      const id = key.slice(prefix(scope).length);
      try { entries.push({ id, raw, record: decodeDraft(raw, scope, id) }); }
      catch { entries.push({ id, raw }); }
    }
    return entries.sort((a, b) => (b.record?.updatedAt || 0) - (a.record?.updatedAt || 0));
  }

  candidates(scope: string, validate?: (data: unknown) => unknown): DraftCandidate[] {
    let current: DraftRecord | undefined;
    try { current = this.read(scope); if (current && validate) validate(current.data); } catch { current = undefined; }
    return this.list(scope).filter((item) => item.id !== current?.id &&
      !current?.parents.some((parent) => parent.id === item.id && parent.stamp === item.record?.stamp));
  }

  write(scope: string, data: unknown): void {
    let branch = this.branches.get(scope);
    if (!branch) {
      let previous: DraftRecord | undefined;
      try { previous = this.read(scope); } catch { /* Never overwrite a damaged draft. */ }
      branch = { id: this.uuid(), parents: previous ? [...previous.parents, { id: previous.id, stamp: previous.stamp }] : [] };
      this.branches.set(scope, branch);
    }
    const record: DraftRecord = { version: 1, scope, ...branch, stamp: this.uuid(), updatedAt: Date.now(), data };
    this.durable.setItem(prefix(scope) + branch.id, JSON.stringify(record));
    this.session.setItem(pointer(scope), branch.id);
  }

  adopt(scope: string, candidate: DraftCandidate): unknown {
    const raw = this.durable.getItem(prefix(scope) + candidate.id);
    if (raw !== candidate.raw) throw new Error("这份草稿已在另一窗口变化，请重新选择");
    const record = decodeDraft(raw, scope, candidate.id);
    this.branches.set(scope, { id: this.uuid(), parents: [...record.parents, { id: record.id, stamp: record.stamp }] });
    this.write(scope, record.data);
    return record.data;
  }

  clear(scope: string): void {
    const record = this.read(scope);
    if (!record) return;
    // Delete only the exact ancestors consumed by this saved branch. Other tabs may have advanced.
    for (const ref of [...record.parents, { id: record.id, stamp: record.stamp }]) {
      const key = prefix(scope) + ref.id;
      const raw = this.durable.getItem(key);
      if (raw === null) continue;
      try { if (decodeDraft(raw, scope, ref.id).stamp !== ref.stamp) continue; }
      catch { continue; }
      this.durable.removeItem(key);
    }
    this.session.removeItem(pointer(scope));
    this.branches.delete(scope);
  }

  discard(scope: string, candidate: DraftCandidate): void {
    const key = prefix(scope) + candidate.id;
    if (this.durable.getItem(key) !== candidate.raw) throw new Error("草稿已变化，请重新检查后删除");
    this.durable.removeItem(key);
  }
}
