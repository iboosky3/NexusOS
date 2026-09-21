import test from "node:test";
import assert from "node:assert/strict";
import { registerResourcePlugins } from "../lib/extension-host/resource-registry.ts";
import { ExtensionHost } from "../lib/extension-host/lifecycle.ts";

const plugin = (id = "third") => ({ id, schemaVersion: 1, hostApiVersion: "1", dependencies: [], resourceType: `example.${id}`,
  commands: [{ id: `${id}.new`, label: "New", menu: "file", validate() {} }],
  activate({ commands }) { commands.register(`${id}.new`, () => ({ resourceType: `example.${id}` })); },
});
test("empty shell and third resource commands use the same host path", async () => {
  assert.deepEqual(registerResourcePlugins([]), []);
  const registry = registerResourcePlugins([plugin("first"), plugin("second"), plugin()]);
  const host = new ExtensionHost(registry);
  assert.deepEqual(await host.execute("third.new"), { resourceType: "example.third" });
  await host.dispose();
});
test("resource, menu, version, ownership and dependency errors fail before activation", () => {
  assert.throws(() => registerResourcePlugins([plugin(), plugin()]), /Duplicate/);
  assert.throws(() => registerResourcePlugins([{ ...plugin(), views: [{ id: "other.sidebar" }] }]), /Invalid view/);
  assert.throws(() => registerResourcePlugins([{ ...plugin(), views: [{ id: "third.new" }] }]), /Invalid command/);
  assert.throws(() => registerResourcePlugins([{ ...plugin(), hostApiVersion: "2" }]), /Unsupported/);
  assert.throws(() => registerResourcePlugins([{ ...plugin(), dependencies: ["missing"] }]), /Unknown dependency/);
  assert.throws(() => registerResourcePlugins([{ ...plugin(), dependencies: ["third"] }]), /Cyclic/);
  assert.throws(() => registerResourcePlugins([{ ...plugin(), commands: [{ id: "third.new", menu: "arbitrary" }] }]), /Unknown menu/);
  assert.throws(() => registerResourcePlugins([{ ...plugin(), commands: [{ id: "other.new", menu: "file" }] }]), /Invalid command/);
});
test("declaration containers cannot be mutated after registration", () => {
  const source = plugin(); const [snapshot] = registerResourcePlugins([source]);
  source.dependencies.push("missing"); source.commands[0].id = "changed";
  assert.deepEqual(snapshot.dependencies, []);
  assert.equal(snapshot.commands[0].id, "third.new");
  assert.throws(() => snapshot.commands.push({}), TypeError);
});
