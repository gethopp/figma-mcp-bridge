import assert from "node:assert/strict";

import { handleWriteRequest } from "../dist-test/src/main/write.js";

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

function createMockFigma() {
  let nextId = 1;
  const registry = new Map();

  const documentNode = {
    id: "document",
    type: "DOCUMENT",
    parent: null,
    children: [],
  };

  const page = Object.assign(createBaseNode("page-1", "PAGE", "Page 1"), {
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

  const attach = (node) => {
    registry.set(node.id, node);
    return node;
  };

  const createRectangle = () =>
    attach(createBaseNode(`node-${nextId++}`, "RECTANGLE", "Rectangle"));

  const createFrame = () =>
    attach(
      Object.assign(createBaseNode(`node-${nextId++}`, "FRAME", "Frame"), {
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

  const createText = () =>
    attach(
      Object.assign(createBaseNode(`node-${nextId++}`, "TEXT", "Text"), {
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
    ...Array.from({ length: 120 }, (_, index) => ({
      type: "create_rectangle",
      ref: `tmp:rect-${index}`,
      params: {
        parentId: "tmp:root",
        name: `Rect ${index}`,
        width: 100 + index,
        height: 40,
      },
    })),
    ...Array.from({ length: 120 }, (_, index) => ({
      type: "set_corner_radius",
      nodeId: `tmp:rect-${index}`,
      params: {
        cornerRadius: (index % 6) + 2,
      },
    })),
    ...Array.from({ length: 30 }, (_, index) => ({
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
  assert.ok(result.createdRefs["tmp:rect-119"]);
  assert.ok(result.createdRefs["tmp:text-29"]);

  const rootId = result.createdRefs["tmp:root"];
  const root = await globalThis.figma.getNodeByIdAsync(rootId);
  assert.ok(root);
  assert.equal(root.type, "FRAME");
  assert.equal(root.children.length, 150);

  const lastRect = await globalThis.figma.getNodeByIdAsync(result.createdRefs["tmp:rect-119"]);
  assert.equal(lastRect.cornerRadius, 7);
}

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

await testLargeOrderedBatch();
await testPartialFailure();

console.log("write.test.mjs: ok");
