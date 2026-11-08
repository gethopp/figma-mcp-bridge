import assert from "node:assert/strict";
import test from "node:test";
import { setNodeConstraintsInput, toolInputSchemas } from "../dist/schema.js";

const id = "4029:12345";
const values = ["MIN", "MAX", "CENTER", "STRETCH", "SCALE"];

test("accepts all native horizontal and vertical constraint values", () => {
  for (const value of values) {
    assert.equal(setNodeConstraintsInput.safeParse({ nodeId: id, horizontal: value }).success, true);
    assert.equal(setNodeConstraintsInput.safeParse({ nodeId: id, vertical: value }).success, true);
  }
});

test("accepts one axis without requiring the other", () => {
  const result = setNodeConstraintsInput.parse({ nodeId: id, horizontal: "STRETCH" });
  assert.deepEqual(result, { nodeId: id, horizontal: "STRETCH" });
});

test("supports a batch of node IDs and an optional file key", () => {
  const result = setNodeConstraintsInput.parse({
    nodeIds: [id, "4029:12346"],
    horizontal: "CENTER",
    vertical: "MAX",
    fileKey: "design-key",
  });
  assert.equal(result.nodeIds.length, 2);
  assert.equal(result.fileKey, "design-key");
});

test("rejects an empty target list or a request without any target", () => {
  assert.equal(setNodeConstraintsInput.safeParse({ nodeIds: [], horizontal: "MIN" }).success, false);
  assert.equal(setNodeConstraintsInput.safeParse({ horizontal: "MIN" }).success, false);
});

test("rejects missing or invalid axis values", () => {
  assert.equal(setNodeConstraintsInput.safeParse({ nodeId: id }).success, false);
  assert.equal(setNodeConstraintsInput.safeParse({ nodeId: id, horizontal: "LEFT" }).success, false);
  assert.equal(setNodeConstraintsInput.safeParse({ nodeId: id, vertical: "BOTTOM" }).success, false);
});

test("rejects malformed Figma node IDs", () => {
  assert.equal(setNodeConstraintsInput.safeParse({ nodeId: "4029-12345", vertical: "CENTER" }).success, false);
});

test("exposes the new command in the MCP tool input schemas", () => {
  assert.equal(
    toolInputSchemas.set_node_constraints.safeParse({ nodeId: id, horizontal: "SCALE" }).success,
    true
  );
});
