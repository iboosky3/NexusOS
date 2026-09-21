import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionRegistry } from "../lib/extension-host/registry.ts";

function plugin(id, dependencies = []) {
  return {
    id, name: id, agentActions: [`${id}.generate`],
    contributions: {
      schemaVersion: 1, hostApiVersion: "1", dependencies,
      editors: [{ id: `${id}.editor`, legacyTab: id, label: id, icon: "#" }],
      launcher: { id: `${id}.launch`, label: id, icon: "#", editorId: `${id}.editor` },
    },
  };
}

test("empty contribution collection is accepted", () => {
  const registry = createExtensionRegistry([]);
  assert.deepEqual(registry.editors, []);
  assert.equal(registry.enabled("missing", () => true), false);
  assert.equal(registry.launchTab("missing"), undefined);
});
test("third plugin contributes without host-specific branches", () => {
  const registry = createExtensionRegistry([plugin("prd"), plugin("prototype"), plugin("notes")]);
  assert.equal(registry.launchTab("notes"), "notes");
  assert.equal(registry.ownerOfTab("notes").id, "notes");
  assert.equal(registry.ownerOfAction("notes.generate").id, "notes");
  assert.equal(registry.launchers.length, 3);
});
test("disabled transitive dependencies disable consumers", () => {
  const registry = createExtensionRegistry([plugin("a"), plugin("b", ["a"]), plugin("c", ["b"])]);
  assert.equal(registry.enabled("c", () => true), true);
  assert.equal(registry.enabled("c", (id) => id !== "a"), false);
});
test("registration is isolated from mutations", () => {
  const source = plugin("notes");
  const registry = createExtensionRegistry([source]);
  source.contributions.editors[0].legacyTab = "changed";
  assert.equal(registry.launchTab("notes"), "notes");
  assert.throws(() => { registry.manifests[0].id = "changed"; }, TypeError);
});
test("duplicate plugins and actions are rejected", () => {
  assert.throws(() => createExtensionRegistry([plugin("a"), plugin("a")]), /plugin ID/);
  const b = plugin("b"); b.agentActions = ["a.generate"];
  assert.throws(() => createExtensionRegistry([plugin("a"), b]), /Agent action/);
});
test("missing and cyclic dependencies are rejected", () => {
  assert.throws(() => createExtensionRegistry([plugin("a", ["missing"])]), /Missing/);
  assert.throws(() => createExtensionRegistry([plugin("a", ["b"]), plugin("b", ["a"])]), /Cyclic/);
});
test("contribution namespace, duplicate IDs and editor targets are validated", () => {
  let a = plugin("a"); a.contributions.launcher.id = "foreign.launch";
  assert.throws(() => createExtensionRegistry([a]), /contribution ID/);
  a = plugin("a"); a.contributions.launcher.id = "a.editor";
  assert.throws(() => createExtensionRegistry([a]), /contribution ID/);
  a = plugin("a"); a.contributions.launcher.editorId = "a.missing";
  assert.throws(() => createExtensionRegistry([a]), /Unknown launcher/);
});
test("duplicate legacy tabs and unsupported schema versions are rejected", () => {
  const b = plugin("b"); b.contributions.editors[0].legacyTab = "a";
  assert.throws(() => createExtensionRegistry([plugin("a"), b]), /editor tab/);
  const a = plugin("a"); a.contributions.schemaVersion = 2;
  assert.throws(() => createExtensionRegistry([a]), /Unsupported/);
  a.contributions.schemaVersion = 1; a.contributions.hostApiVersion = "2";
  assert.throws(() => createExtensionRegistry([a]), /Unsupported/);
});

test("command ownership is declared and duplicate command bindings are rejected", () => {
  const a = plugin("a");
  a.contributions.commands = [{ id: "a.command.save", legacyCommand: "save" }];
  const registry = createExtensionRegistry([a]);
  assert.equal(registry.ownerOfCommand("save").id, "a");
  assert.equal(registry.ownerOfCommand("unknown"), undefined);
  const b = plugin("b");
  b.contributions.commands = [{ id: "b.command.save", legacyCommand: "save" }];
  assert.throws(() => createExtensionRegistry([a, b]), /command/);
});
