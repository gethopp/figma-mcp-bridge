import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPaintStyleInput,
  toolInputSchemas,
  validateRpc,
} from "../dist/schema.js";

const id = "4029:12345";
const styleId = "S:paint-local-123";

test("accepts local paint style IDs and fill/stroke targets", () => {
  for (const target of ["fill", "stroke"]) {
    const parsed = applyPaintStyleInput.parse({ nodeId: id, styleId, target });
    assert.equal(parsed.styleId, styleId);
    assert.equal(parsed.target, target);
  }
  assert.equal(applyPaintStyleInput.parse({ nodeId: id, styleId }).target, undefined);
});

test("accepts a batch and optional file key", () => {
  const parsed = applyPaintStyleInput.parse({
    nodeIds: [id, "4029:12346"],
    styleId,
    fileKey: "design-file",
  });
  assert.equal(parsed.nodeIds.length, 2);
  assert.equal(parsed.fileKey, "design-file");
});

test("rejects missing style or target nodes and unsupported targets", () => {
  for (const input of [
    { nodeId: id, target: "fill" },
    { nodeId: id, styleId: "" },
    { nodeId: id, styleId, target: "effects" },
    { nodeIds: [], styleId },
    { styleId },
    { nodeId: "invalid", styleId },
  ]) {
    assert.equal(applyPaintStyleInput.safeParse(input).success, false);
  }
  assert.equal(toolInputSchemas.apply_paint_style.safeParse({ nodeId: id, styleId }).success, true);
});

test("RPC validates single-node style associations without leaking node IDs", () => {
  assert.deepEqual(
    validateRpc("apply_paint_style", [id], { styleId, target: "stroke" }),
    { error: null, params: { styleId, target: "stroke" } }
  );
});

test("RPC validates batch requests and rejects invalid data", () => {
  assert.deepEqual(
    validateRpc("apply_paint_style", [id, "4029:12346"], { styleId }),
    { error: null, params: { styleId } }
  );
  assert.notEqual(validateRpc("apply_paint_style", [id], { styleId, target: "color" }).error, null);
  assert.notEqual(validateRpc("apply_paint_style", ["bad-id"], { styleId }).error, null);
  assert.notEqual(validateRpc("apply_paint_style", [], { styleId }).error, null);
});
