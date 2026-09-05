import test from "node:test";
import assert from "node:assert/strict";
import { getLayoutTree } from "./layout.ts";

test("preserves source transforms and absolute bounds without summing parent positions", async () => {
  const child = {
    id: "2:2",
    type: "RECTANGLE",
    name: "rotated",
    visible: true,
    width: 20,
    height: 10,
    absoluteTransform: [
      [0, -1, 120],
      [1, 0, 50],
    ],
    absoluteBoundingBox: { x: 110, y: 50, width: 10, height: 20 },
    absoluteRenderBounds: null,
  };
  const root = { ...child, id: "1:1", type: "FRAME", children: [child], clipsContent: true };
  child.parent = root;
  globalThis.figma = {
    getNodeByIdAsync: async () => root,
    fileKey: undefined,
    root: { name: "Copy" },
    currentPage: { id: "0:1" },
  };
  const result = await getLayoutTree("1:1");
  assert.equal(result.atomicWithScreenshot, false);
  assert.equal(result.fileKey, null);
  assert.deepEqual(result.nodes[1].absoluteTransform, child.absoluteTransform);
  assert.deepEqual(result.nodes[1].absoluteBoundingBox, child.absoluteBoundingBox);
  assert.equal(result.nodes[1].parentId, "1:1");
  assert.equal(result.nodes[1].absoluteRenderBounds, null);
  assert.equal(result.truncated, false);
  assert.equal((await getLayoutTree("1:1", 1)).truncated, true);
});

test("rejects a missing or non-scene capture root", async () => {
  for (const root of [null, { type: "PAGE" }, { type: "DOCUMENT" }]) {
    globalThis.figma = { getNodeByIdAsync: async () => root };
    await assert.rejects(getLayoutTree("0:0"), /Scene root required/);
  }
});
