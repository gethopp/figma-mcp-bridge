// Runs against the compiled output: `bun run build` (tsc) first, then `node --test test/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRpc, toolInputSchemas } from "../dist/schema.js";

test("get_prototype_connections folds the transport node id and forwards only options", () => {
  const result = validateRpc("get_prototype_connections", ["45:3565"], {
    maxNodes: 100,
    includeEmpty: true,
  });
  assert.deepEqual(result, { error: null, params: { maxNodes: 100, includeEmpty: true } });
});

test("get_prototype_connections accepts a page-wide scan with no node id", () => {
  assert.deepEqual(validateRpc("get_prototype_connections", undefined, {}), {
    error: null,
    params: {},
  });
});

test("trace_prototype_flow requires a start node and strips it from forwarded params", () => {
  assert.deepEqual(validateRpc("trace_prototype_flow", ["I1:2;3:4"], { maxScreens: 5 }), {
    error: null,
    params: { maxScreens: 5 },
  });
  assert.notEqual(validateRpc("trace_prototype_flow", undefined, {}).error, null);
  assert.notEqual(validateRpc("trace_prototype_flow", ["1-2"], {}).error, null);
});

test("limits are validated", () => {
  assert.notEqual(validateRpc("trace_prototype_flow", ["1:2"], { maxScreens: 0 }).error, null);
  assert.notEqual(validateRpc("get_prototype_connections", ["1:2"], { maxNodes: 1.5 }).error, null);
});

test("get_node stays backward compatible and accepts includePrototype", () => {
  assert.deepEqual(validateRpc("get_node", ["1:2"], undefined), { error: null, params: {} });
  assert.deepEqual(validateRpc("get_node", ["1:2"], { includePrototype: true }), {
    error: null,
    params: { includePrototype: true },
  });
  assert.equal(toolInputSchemas.get_node.safeParse({ nodeId: "1:2" }).success, true);
});
