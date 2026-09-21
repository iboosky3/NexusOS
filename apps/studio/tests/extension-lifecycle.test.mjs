import test from "node:test";
import assert from "node:assert/strict";
import { DisposableStore, ExtensionHost } from "../lib/extension-host/lifecycle.ts";

test("subscriptions dispose in reverse order, once, despite failures", async () => {
  const calls = []; const scope = new DisposableStore();
  scope.add({ dispose() { calls.push(1); } });
  scope.add({ dispose() { calls.push(2); throw new Error("test"); } });
  await assert.rejects(scope.dispose(), AggregateError);
  await scope.dispose(); assert.deepEqual(calls, [2, 1]);
  assert.throws(() => scope.add({ dispose() {} }), /disposed/);
});
test("concurrent activation shares one task and disable releases resources", async () => {
  let starts = 0; let stops = 0;
  const host = new ExtensionHost([{ id: "a", dependencies: [], async activate() { starts++; await Promise.resolve(); return { dispose() { stops++; } }; } }]);
  await Promise.all([host.activate("a"), host.activate("a")]);
  assert.equal(starts, 1); assert.equal(host.state("a"), "active");
  await host.disable("a"); await host.disable("a"); assert.equal(stops, 1);
  await assert.rejects(host.activate("a"), /disabled/);
  host.enable("a"); await host.activate("a"); assert.equal(starts, 2); await host.dispose();
});
test("failure releases partial subscriptions and activation may retry", async () => {
  let stops = 0; let attempts = 0;
  const host = new ExtensionHost([{ id: "a", dependencies: [], activate({ subscriptions }) {
    subscriptions.add({ dispose() { stops++; } }); if (++attempts === 1) throw new Error("first");
  } }]);
  await assert.rejects(host.activate("a"), /first/); assert.equal(stops, 1);
  assert.equal(host.state("a"), "failed"); await host.activate("a"); await host.dispose(); assert.equal(stops, 2);
});
test("disabling dependency drains consumers first", async () => {
  const calls = [];
  const host = new ExtensionHost([...["a", "b"].map((id) => ({ id, dependencies: id === "b" ? ["a"] : [], activate() { return { dispose() { calls.push(id); } }; } }))]);
  await host.activate("b"); await host.disable("a"); assert.deepEqual(calls, ["b", "a"]);
});
test("disable during activation cancels and disposes a late result", async () => {
  let release; let stopped = false;
  const host = new ExtensionHost([{ id: "a", dependencies: [], async activate() {
    await new Promise((resolve) => { release = resolve; }); return { dispose() { stopped = true; } };
  } }]);
  const activation = host.activate("a"); await Promise.resolve(); const rejected = assert.rejects(activation, /cancelled/);
  const disabling = host.disable("a"); release(); await rejected; await disabling;
  assert.equal(stopped, true); assert.equal(host.state("a"), "disabled");
});
test("invalid dependency graphs are rejected before activation", () => {
  const activate = () => {};
  assert.throws(() => new ExtensionHost([{ id: "a", dependencies: ["b"], activate }]), /Unknown/);
  assert.throws(() => new ExtensionHost([{ id: "a", dependencies: ["a"], activate }]), /Cyclic/);
});

test("reenabling during drain waits for old resources before activating again", async () => {
  let release; let starts = 0;
  const host = new ExtensionHost([{ id: "a", dependencies: [], activate() {
    starts++;
    return { dispose() { if (starts === 1) return new Promise((resolve) => { release = resolve; }); } };
  } }]);
  await host.activate("a");
  const draining = host.disable("a");
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  host.enable("a"); const activation = host.activate("a");
  assert.equal(starts, 1); release(); await draining; await activation;
  assert.equal(starts, 2); assert.equal(host.state("a"), "active"); await host.dispose();
});


test("hung cleanup releases remaining subscriptions and quarantines the plugin", async () => {
  let disposed = false;
  const host = new ExtensionHost([{ id: "a", dependencies: [], activate({ subscriptions }) {
    subscriptions.add({ dispose() { disposed = true; } });
    subscriptions.add({ dispose() { return new Promise(() => {}); } });
  } }], 10);
  await host.activate("a");
  await assert.rejects(host.disable("a"), /incomplete/);
  assert.equal(disposed, true);
  assert.equal(host.state("a"), "failed");
  host.enable("a");
  await assert.rejects(host.activate("a"), /reload required/);
});

test("hung activation drains with a deadline and disposes its late result", async () => {
  let release; let disposed = false;
  const host = new ExtensionHost([{ id: "a", dependencies: [], activate() {
    return new Promise((resolve) => { release = () => resolve({ dispose() { disposed = true; } }); });
  } }], 10);
  const activation = host.activate("a");
  const rejected = assert.rejects(activation, /cancelled/);
  await Promise.resolve();
  await assert.rejects(host.disable("a"), /incomplete/);
  release(); await rejected;
  assert.equal(disposed, true);
  assert.equal(host.state("a"), "failed");
});

test("consumer cleanup failure still releases dependency and isolates observers", async () => {
  let released = false;
  const host = new ExtensionHost([
    { id: "a", dependencies: [], activate() { return { dispose() { released = true; } }; } },
    { id: "b", dependencies: ["a"], activate() { return { dispose() { throw new Error("failure"); } }; } },
  ]);
  host.subscribe(() => { throw new Error("observer"); });
  await host.activate("b");
  await assert.rejects(host.disable("a"), AggregateError);
  assert.equal(released, true);
  assert.equal(host.state("b"), "failed");
});

test("third plugin commands activate lazily, validate arguments and unbind on disable", async () => {
  let starts = 0;
  const host = new ExtensionHost([{ id: "third", dependencies: [],
    commands: [{ id: "third.echo", validate(value) { if (typeof value !== "string") throw new Error("string required"); } }],
    activate({ commands }) { starts++; commands.register("third.echo", (value) => value); },
  }]);
  assert.equal(await host.execute("third.echo", "hello"), "hello");
  await assert.rejects(host.execute("third.echo", 1), /string required/);
  assert.equal(starts, 1);
  await host.disable("third");
  await assert.rejects(host.execute("third.echo", "hello"), /disabled/);
});

test("undeclared bindings roll back and cannot take another plugin command", async () => {
  const host = new ExtensionHost([{ id: "third", dependencies: [], activate({ commands }) {
    commands.register("other.command", () => {});
  } }]);
  await assert.rejects(host.activate("third"), /Undeclared/);
  assert.equal(host.state("third"), "failed");
});
