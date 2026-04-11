import assert from "node:assert/strict";

import { handleWriteRequest } from "../dist-test/src/main/write.js";

/** Creates a minimal mock Figma node with the mutable fields used by write tests. */
function createBaseNode(id, type, name) {
  const pluginData = new Map();
  return {
    id,
    type,
    name,
    parent: null,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    opacity: 1,
    blendMode: "PASS_THROUGH",
    constraints: { horizontal: "MIN", vertical: "MIN" },
    rotation: 0,
    fills: [],
    strokes: [],
    strokeWeight: 1,
    strokeAlign: "INSIDE",
    dashPattern: [],
    effects: [],
    cornerRadius: 0,
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomRightRadius: 0,
    bottomLeftRadius: 0,
    cornerSmoothing: 0,
    setSharedPluginData(namespace, key, value) {
      pluginData.set(`${namespace}:${key}`, value);
    },
    getSharedPluginData(namespace, key) {
      return pluginData.get(`${namespace}:${key}`) ?? "";
    },
    remove() {
      if (!this.parent || !("children" in this.parent)) {
        return;
      }
      this.parent.children = this.parent.children.filter((child) => child.id !== this.id);
      this.parent = null;
    },
    resize(width, height) {
      this.width = width;
      this.height = height;
    },
  };
}

/** Builds a mock `figma` runtime that is sufficient for write-tool tests. */
function createMockFigma() {
  let nextId = 1;
  const registry = new Map();
  const createNodeId = () => `1:${nextId++}`;

  const documentNode = {
    id: "document",
    type: "DOCUMENT",
    parent: null,
    children: [],
  };

  const page = Object.assign(createBaseNode("1:0", "PAGE", "Page 1"), {
    type: "PAGE",
    children: [],
    appendChild(child) {
      if (child.parent && "children" in child.parent) {
        child.parent.children = child.parent.children.filter((node) => node.id !== child.id);
      }
      child.parent = this;
      this.children.push(child);
      registry.set(child.id, child);
    },
  });
  page.parent = documentNode;
  documentNode.children.push(page);
  registry.set(page.id, page);

  /** Tracks nodes created during a test so async lookup behaves like the Figma runtime. */
  const attach = (node) => {
    registry.set(node.id, node);
    return node;
  };

  /** Creates a mock rectangle node. */
  const createRectangle = () =>
    attach(createBaseNode(createNodeId(), "RECTANGLE", "Rectangle"));

  /** Creates a mock frame node with child-container behavior. */
  const createFrame = () =>
    attach(
      Object.assign(createBaseNode(createNodeId(), "FRAME", "Frame"), {
        type: "FRAME",
        children: [],
        layoutMode: "NONE",
        layoutWrap: "NO_WRAP",
        itemSpacing: 0,
        primaryAxisAlignItems: "MIN",
        counterAxisAlignItems: "MIN",
        primaryAxisSizingMode: "AUTO",
        counterAxisSizingMode: "AUTO",
        counterAxisSpacing: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        clipsContent: false,
        appendChild(child) {
          if (child.parent && "children" in child.parent) {
            child.parent.children = child.parent.children.filter((node) => node.id !== child.id);
          }
          child.parent = this;
          this.children.push(child);
          registry.set(child.id, child);
        },
      })
    );

  /** Creates a mock text node with the font APIs used by the write engine. */
  const createText = () =>
    attach(
      Object.assign(createBaseNode(createNodeId(), "TEXT", "Text"), {
        type: "TEXT",
        characters: "",
        fontName: { family: "Inter", style: "Regular" },
        fontSize: 16,
        fontWeight: 400,
        textDecoration: "NONE",
        textAlignHorizontal: "LEFT",
        textAlignVertical: "TOP",
        textAutoResize: "NONE",
        lineHeight: { unit: "AUTO" },
        letterSpacing: { unit: "PIXELS", value: 0 },
        getRangeAllFontNames() {
          return [{ family: "Inter", style: "Regular" }];
        },
      })
    );

  return {
    currentPage: page,
    createFrame,
    createRectangle,
    createText,
    async getNodeByIdAsync(nodeId) {
      return registry.get(nodeId) ?? null;
    },
    async loadFontAsync() {},
  };
}

/** Verifies ordered batch execution and reference creation across many steps. */
async function testLargeOrderedBatch() {
  globalThis.figma = createMockFigma();

  const operations = [
    {
      type: "create_frame",
      ref: "tmp:root",
      params: {
        name: "Batch Root",
        width: 1200,
        height: 800,
        layoutMode: "VERTICAL",
        itemSpacing: 8,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
      },
    },
    ...Array.from({ length: 35 }, (_, index) => ({
      type: "create_rectangle",
      ref: `tmp:rect-${index}`,
      params: {
        parentId: "tmp:root",
        name: `Rect ${index}`,
        width: 100 + index,
        height: 40,
      },
    })),
    ...Array.from({ length: 35 }, (_, index) => ({
      type: "set_corner_radius",
      nodeId: `tmp:rect-${index}`,
      params: {
        cornerRadius: (index % 6) + 2,
      },
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      type: "create_text",
      ref: `tmp:text-${index}`,
      params: {
        parentId: "tmp:root",
        name: `Label ${index}`,
        characters: `Item ${index}`,
      },
    })),
  ];

  const result = await handleWriteRequest("batch_mutation", undefined, { operations });

  assert.equal(result.executedCount, operations.length);
  assert.equal(result.results.length, operations.length);
  assert.ok(result.createdRefs["tmp:root"]);
  assert.ok(result.createdRefs["tmp:rect-34"]);
  assert.ok(result.createdRefs["tmp:text-19"]);

  const rootId = result.createdRefs["tmp:root"];
  const root = await globalThis.figma.getNodeByIdAsync(rootId);
  assert.ok(root);
  assert.equal(root.type, "FRAME");
  assert.equal(root.children.length, 55);

  const lastRect = await globalThis.figma.getNodeByIdAsync(result.createdRefs["tmp:rect-34"]);
  assert.equal(lastRect.cornerRadius, 6);
}

/** Verifies batch execution stops cleanly and reports partial progress on failure. */
async function testPartialFailure() {
  globalThis.figma = createMockFigma();

  const operations = [
    {
      type: "create_frame",
      ref: "tmp:root",
      params: { name: "Root" },
    },
    ...Array.from({ length: 80 }, (_, index) => ({
      type: "create_rectangle",
      ref: `tmp:item-${index}`,
      params: {
        parentId: "tmp:root",
        name: `Item ${index}`,
      },
    })),
    {
      type: "set_corner_radius",
      nodeId: "tmp:missing",
      params: { cornerRadius: 10 },
    },
    {
      type: "create_text",
      ref: "tmp:after-failure",
      params: {
        parentId: "tmp:root",
        characters: "must not run",
      },
    },
  ];

  const result = await handleWriteRequest("batch_mutation", undefined, { operations });

  assert.equal(result.executedCount, 81);
  assert.equal(result.failedStepIndex, 81);
  assert.equal(result.failure.code, "UNKNOWN_REFERENCE");
  assert.equal(result.results.length, 81);
  assert.ok(result.createdRefs["tmp:root"]);
  assert.ok(result.createdRefs["tmp:item-79"]);
  assert.equal(result.createdRefs["tmp:after-failure"], undefined);

  const root = await globalThis.figma.getNodeByIdAsync(result.createdRefs["tmp:root"]);
  assert.ok(root);
  assert.equal(root.children.length, 80);
}

/** Verifies batch validation rejects invalid resolved params before executeWrite runs. */
async function testBatchValidationFailure() {
  globalThis.figma = createMockFigma();

  const result = await handleWriteRequest("batch_mutation", undefined, {
    operations: [
      {
        type: "create_frame",
        ref: "tmp:root",
        params: { name: "Root", width: 100, height: 100 },
      },
      {
        type: "set_size",
        nodeId: "tmp:root",
        params: { width: -10, height: 50 },
      },
    ],
  });

  assert.equal(result.executedCount, 1);
  assert.equal(result.failedStepIndex, 1);
  assert.equal(result.failure.code, "INVALID_INPUT");
  assert.match(result.failure.message, /width must be greater than 0/);
  assert.equal(result.results.length, 1);

  const root = await globalThis.figma.getNodeByIdAsync(result.createdRefs["tmp:root"]);
  assert.ok(root);
  assert.equal(root.width, 100);
  assert.equal(root.height, 100);
}

/** Verifies find_nodes accepts JSON query filters from the MCP tool contract. */
async function testFindNodesJsonQuery() {
  globalThis.figma = createMockFigma();

  const root = await handleWriteRequest("create_frame", undefined, {
    name: "Cards",
    key: "cards-root",
  });
  await handleWriteRequest("create_rectangle", undefined, {
    parentId: root.nodeId,
    name: "Hero Card",
    key: "hero-card",
  });
  await handleWriteRequest("create_text", undefined, {
    parentId: root.nodeId,
    name: "Hero Title",
    characters: "Title",
  });

  const result = await handleWriteRequest("find_nodes", undefined, {
    query: JSON.stringify({ parentId: root.nodeId, key: "hero-card" }),
  });

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].name, "Hero Card");
  assert.equal(result.matches[0].parentId, root.nodeId);
  assert.equal(result.matches[0].key, "hero-card");
}

/** Verifies non-JSON query strings fall back to name substring matching. */
async function testFindNodesQuerySubstringFallback() {
  globalThis.figma = createMockFigma();

  await handleWriteRequest("create_frame", undefined, { name: "Card Shell" });
  await handleWriteRequest("create_text", undefined, {
    name: "Card Title",
    characters: "Title",
  });
  await handleWriteRequest("create_rectangle", undefined, { name: "Badge" });

  const result = await handleWriteRequest("find_nodes", undefined, {
    query: "Card",
  });

  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    result.matches.map((node) => node.name).sort(),
    ["Card Shell", "Card Title"]
  );
}

/** Verifies failed create steps in a batch do not leave behind unreported root-level nodes. */
async function testBatchCreateFailureDoesNotLeakNodes() {
  globalThis.figma = createMockFigma();

  const parent = await handleWriteRequest("create_frame", undefined, {
    name: "Modal Root",
  });

  const result = await handleWriteRequest("batch_mutation", undefined, {
    operations: [
      {
        type: "create_frame",
        ref: "tmp:overlay",
        params: {
          parentId: parent.nodeId,
          name: "Overlay",
          width: 800,
          height: 600,
        },
      },
      {
        type: "create_frame",
        ref: "tmp:modal",
        params: {
          parentId: parent.nodeId,
          name: "Modal",
          strokes: [{ type: "IMAGE", color: "#D9DEE8" }],
        },
      },
    ],
  });

  assert.equal(result.executedCount, 1);
  assert.equal(result.failedStepIndex, 1);
  assert.equal(result.failure.code, "UNSUPPORTED_PAINT");
  assert.equal(result.results.length, 1);
  assert.ok(result.createdRefs["tmp:overlay"]);
  assert.equal(result.createdRefs["tmp:modal"], undefined);

  const root = await globalThis.figma.getNodeByIdAsync(parent.nodeId);
  assert.ok(root);
  assert.deepEqual(
    root.children.map((node) => node.name),
    ["Overlay"]
  );

  const pageChildren = globalThis.figma.currentPage.children.map((node) => node.name);
  assert.deepEqual(pageChildren, ["Modal Root"]);
}

/** Verifies mutation tools can target prior batch results through tmp: refs in nodeId. */
async function testBatchSetStrokesSupportsTmpRef() {
  globalThis.figma = createMockFigma();

  const result = await handleWriteRequest("batch_mutation", undefined, {
    operations: [
      {
        type: "create_frame",
        ref: "tmp:modal",
        params: {
          name: "Modal",
          width: 320,
          height: 180,
        },
      },
      {
        type: "set_strokes",
        nodeId: "tmp:modal",
        params: {
          strokes: [{ type: "SOLID", color: "#D9DEE8" }],
        },
      },
    ],
  });

  assert.equal(result.executedCount, 2);
  assert.equal(result.results.length, 2);
  assert.ok(result.createdRefs["tmp:modal"]);

  const modal = await globalThis.figma.getNodeByIdAsync(result.createdRefs["tmp:modal"]);
  assert.ok(modal);
  assert.equal(modal.strokes.length, 1);
  assert.equal(modal.strokes[0].type, "SOLID");
}

/** Runs the write-tool test cases and reports a simple pass/fail summary. */
async function runTests() {
  const tests = [
    ["testLargeOrderedBatch", testLargeOrderedBatch],
    ["testPartialFailure", testPartialFailure],
    ["testBatchValidationFailure", testBatchValidationFailure],
    ["testFindNodesJsonQuery", testFindNodesJsonQuery],
    ["testFindNodesQuerySubstringFallback", testFindNodesQuerySubstringFallback],
    ["testBatchCreateFailureDoesNotLeakNodes", testBatchCreateFailureDoesNotLeakNodes],
    ["testBatchSetStrokesSupportsTmpRef", testBatchSetStrokesSupportsTmpRef],
  ];
  const failures = [];
  let passed = 0;

  for (const [name, test] of tests) {
    try {
      await test();
      passed += 1;
    } catch (error) {
      failures.push({
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    `write.test.mjs: ${passed} passed, ${failures.length} failed`
  );
  for (const failure of failures) {
    console.error(`${failure.name}: ${failure.error}`);
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await runTests();
