import assert from "node:assert/strict";
import test from "node:test";
import { DraftStore } from "../lib/workspace/draft-store.ts";
import { resourceDraft } from "../lib/workspace/resource-draft.ts";

class MemoryStorage {
  data = new Map(); fail = false;
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { if (this.fail) throw new Error("quota"); this.data.set(key, value); }
  removeItem(key) { if (this.fail) throw new Error("denied"); this.data.delete(key); }
  clone() { const copy = new MemoryStorage(); copy.data = new Map(this.data); return copy; }
}
let counter = 0;
const uuid = () => `id-${++counter}`;
const scope = "resource:workspace:prd";
const draft = (content, revision = 1) => ({ baseRevision: revision, payload: { content } });
const store = (durable, session = new MemoryStorage()) => new DraftStore(durable, session, uuid);

test("a closed browser leaves a selectable durable draft, not an automatically adopted one", () => {
  const disk = new MemoryStorage();
  const first = store(disk); first.write(scope, draft("unsaved"));
  const reopened = store(disk);
  assert.equal(reopened.read(scope), undefined);
  const [candidate] = reopened.candidates(scope);
  reopened.adopt(scope, candidate);
  assert.deepEqual(reopened.read(scope).data, draft("unsaved"));
  reopened.clear(scope);
  assert.equal(reopened.list(scope).length, 0);
});

test("reload forks the restored branch and a successful save consumes unchanged ancestors", () => {
  const disk = new MemoryStorage(), session = new MemoryStorage();
  const first = store(disk, session); first.write(scope, draft("first"));
  const reload = store(disk, session);
  assert.equal(reload.resume(scope, resourceDraft).data.payload.content, "first");
  reload.write(scope, draft("edited"));
  assert.equal(reload.candidates(scope).length, 0);
  reload.clear(scope);
  assert.equal(disk.length, 0);
});

test("duplicated tabs fork on restore; saving one never clears the other tab's draft", () => {
  const disk = new MemoryStorage(), originalSession = new MemoryStorage();
  const original = store(disk, originalSession); original.write(scope, draft("shared initial"));
  const duplicated = store(disk, originalSession.clone());
  duplicated.resume(scope, resourceDraft);
  original.write(scope, draft("original changed"));
  duplicated.write(scope, draft("duplicate changed"));
  duplicated.clear(scope);
  assert.equal(original.read(scope).data.payload.content, "original changed");
  assert.equal(disk.length, 1);
});

test("workspace and resource scopes do not share data", () => {
  const disk = new MemoryStorage(); const first = store(disk);
  first.write(scope, draft("one")); first.write("resource:other:prd", draft("two"));
  first.write("resource:workspace:other", draft("three"));
  first.clear(scope);
  assert.equal(first.read("resource:other:prd").data.payload.content, "two");
  assert.equal(first.read("resource:workspace:other").data.payload.content, "three");
});

test("malformed envelopes and invalid payloads stay available for download and cannot be silently consumed", () => {
  const disk = new MemoryStorage(), session = new MemoryStorage(); const first = store(disk, session);
  first.write(scope, draft("healthy")); const key = disk.key(0); disk.setItem(key, "{broken");
  const reload = store(disk, session);
  assert.throws(() => reload.resume(scope, resourceDraft));
  assert.equal(reload.candidates(scope)[0].raw, "{broken");
  reload.write(scope, draft("new edits")); reload.clear(scope);
  assert.equal(disk.getItem(key), "{broken");
  const bad = store(disk); bad.write(scope, { baseRevision: -1, payload: [] });
  assert.throws(() => resourceDraft(bad.read(scope).data));
  assert.equal(bad.candidates(scope, resourceDraft).length, 2);
});

test("quota failure preserves the previous durable record and reports failure", () => {
  const disk = new MemoryStorage(); const first = store(disk); first.write(scope, draft("safe"));
  disk.fail = true;
  assert.throws(() => first.write(scope, draft("new in memory")), /quota/);
  assert.equal(first.read(scope).data.payload.content, "safe");
  assert.throws(() => first.clear(scope), /denied/);
});

test("restoring or deleting a draft changed in another window requires another explicit selection", () => {
  const disk = new MemoryStorage(); const first = store(disk); first.write(scope, draft("first"));
  const second = store(disk); const [candidate] = second.candidates(scope);
  first.write(scope, draft("changed"));
  assert.throws(() => second.adopt(scope, candidate), /变化/);
  assert.throws(() => second.discard(scope, candidate), /变化/);
  assert.equal(first.read(scope).data.payload.content, "changed");
});

test("uncertain save request and later edits survive reopening together with their original revision", () => {
  const disk = new MemoryStorage(); const first = store(disk);
  const data = { ...draft("later edits", 3), submission: { expectedRevision: 3, payload: { content: "submitted" }, clientRequestId: "original-key" } };
  first.write(scope, data);
  const second = store(disk); second.adopt(scope, second.candidates(scope)[0]);
  assert.deepEqual(resourceDraft(second.read(scope).data), data);
});

test("invalid domain data is retained after a new draft is saved", () => {
  const disk = new MemoryStorage(), session = new MemoryStorage();
  const first = store(disk, session); first.write(scope, { baseRevision: -1, payload: [] });
  const raw = disk.getItem(disk.key(0));
  const reload = store(disk, session);
  assert.throws(() => reload.resume(scope, resourceDraft));
  reload.write(scope, draft("valid edit")); reload.clear(scope);
  assert.equal(disk.length, 1);
  assert.equal(disk.getItem(disk.key(0)), raw);
});
