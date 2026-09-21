import assert from "node:assert/strict";
import test from "node:test";
import { componentInput } from "../extensions/prototype-designer/capability-input.ts";

test("component input binds only stable identifiers and does not send client component contents", () => {
  const selection = { pageId: "home", block: { props: { id: "button", label: "untrusted", left: ["private"] } } };
  const input = componentInput(selection);
  selection.block.props.id = "different";
  assert.deepEqual(input, { pageId: "home", componentId: "button" });
  for (const invalid of [null, {}, { pageId: "home" }, { pageId: "home", block: { props: { id: 1 } } }]) {
    assert.throws(() => componentInput(invalid), /选择/);
  }
});
