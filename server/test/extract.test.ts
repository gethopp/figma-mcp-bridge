import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import pngjs from "pngjs";
import { request, type BridgeSender } from "../src/extract/client.js";
import { DEFAULT_EXPORT_OPTIONS, exportFile } from "../src/extract/exporter.js";
import {
  displayName,
  isSeparatorPage,
  matchKey,
  slugify,
  uniqueName,
} from "../src/extract/names.js";
import { tilePng } from "../src/extract/tiles.js";
import { exportTree } from "../src/extract/tree.js";
import type { BridgeResponse } from "../src/types.js";

const { PNG } = pngjs;

const reply = (type: string, data: unknown): BridgeResponse => ({ type, requestId: "t", data });
const failure = (type: string, error: string): BridgeResponse => ({ type, requestId: "t", error });

const png = (width: number, height: number): Buffer => PNG.sync.write(new PNG({ width, height }));

test("names strip decoration and match pages loosely", () => {
  assert.equal(displayName("      ↳ Buttons"), "Buttons");
  assert.equal(slugify("❖ Getting started"), "getting-started");
  assert.equal(matchKey("↳ Log in & sign up"), matchKey("log in sign up"));
  assert.equal(isSeparatorPage("––––––––––"), true);
  assert.equal(isSeparatorPage("Icons"), false);
  const taken = new Set<string>();
  assert.deepEqual(
    [uniqueName(taken, "a"), uniqueName(taken, "a"), uniqueName(taken, "a")],
    ["a", "a-2", "a-3"]
  );
});

test("request retries Figma load timeouts and fails fast on other errors", async () => {
  let calls = 0;
  const flaky: BridgeSender = {
    sendWithParams: async (type) =>
      ++calls < 3
        ? failure(type, "Unable to establish connection to Figma after 10 seconds.")
        : reply(type, 42),
  };
  assert.equal(await request(flaky, "get_tokens", { retryDelayMs: 1 }), 42);
  assert.equal(calls, 3);

  let fatalCalls = 0;
  const fatal: BridgeSender = {
    sendWithParams: async (type) => (fatalCalls++, failure(type, "Node not found: 1:2")),
  };
  await assert.rejects(
    request(fatal, "get_node", { nodeIds: ["1:2"], retryDelayMs: 1 }),
    /get_node 1:2: Node not found/
  );
  assert.equal(fatalCalls, 1);
});

test("exportTree splices stubbed chunks until the tree is complete", async () => {
  const chunks: Record<string, unknown> = {
    page: {
      id: "page",
      name: "Page",
      type: "PAGE",
      children: [
        { id: "a", name: "A", type: "FRAME", stub: true },
        { id: "b", name: "B", type: "TEXT" },
      ],
    },
    a: {
      id: "a",
      name: "A",
      type: "FRAME",
      children: [{ id: "a1", name: "A1", type: "FRAME", childCount: 1, stub: true }],
    },
    a1: {
      id: "a1",
      name: "A1",
      type: "FRAME",
      children: [{ id: "a1x", name: "leaf", type: "VECTOR" }],
    },
  };
  const requested: string[] = [];
  const sender: BridgeSender = {
    sendWithParams: async (type, nodeIds) => {
      requested.push(nodeIds![0]);
      return reply(type, { root: structuredClone(chunks[nodeIds![0]]) });
    },
  };
  const tree = await exportTree(sender, "page", undefined, {});
  assert.deepEqual(requested, ["page", "a", "a1"]);
  assert.equal((tree.children![0].children![0].children![0] as { name: string }).name, "leaf");
  assert.equal(JSON.stringify(tree).includes('"stub"'), false);
});

test("tilePng cuts tall images and leaves short ones alone", () => {
  const tiles = tilePng(png(10, 50), 20);
  assert.deepEqual(
    tiles.map((tile) => PNG.sync.read(tile).height),
    [20, 20, 10]
  );
  assert.equal(tilePng(png(10, 24), 20).length, 0);
});

test("exportFile writes tokens, components, assets, pages, screenshots and index.md", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "figma-export-test-"));
  const requests: string[] = [];
  const sender: BridgeSender = {
    async sendWithParams(type, nodeIds, params) {
      requests.push(type);
      switch (type) {
        case "get_bridge_info":
          return reply(type, { flavor: "test", extractionApi: 1 });
        case "get_metadata":
          return reply(type, {
            fileName: "Kit",
            pages: [
              { id: "0:1", name: "Cover" },
              { id: "0:2", name: "———" },
              { id: "0:3", name: "↳ Icons" },
            ],
          });
        case "get_tokens":
          return reply(type, {
            collections: [
              {
                id: "c",
                name: "Color",
                modes: [{ modeId: "m", name: "Default" }],
                variables: [
                  {
                    id: "v",
                    name: "brand",
                    resolvedType: "COLOR",
                    valuesByMode: { m: { r: 1, g: 0, b: 0, a: 1 } },
                  },
                ],
              },
            ],
            styles: { paints: [], text: [], effects: [], grids: [] },
          });
        case "get_page_summary":
          return reply(type, {
            componentSets: [
              {
                id: "5:1",
                name: "Icon",
                variantCount: 2,
                propertyDefinitions: { Size: { type: "VARIANT" } },
              },
            ],
            components: [],
            topLevel: [],
          });
        case "find_assets":
          return reply(type, {
            assets: [
              {
                id: "5:2",
                name: "Size=sm",
                type: "COMPONENT",
                path: ["Icon"],
                width: 16,
                height: 16,
              },
              {
                id: "5:3",
                name: "Size=md",
                type: "COMPONENT",
                path: ["Icon"],
                width: 24,
                height: 24,
              },
            ],
            nextCursor: null,
          });
        case "export_assets":
          return reply(type, {
            exports: nodeIds!.map((id) => ({
              id,
              format: params?.format,
              svg: `<svg id="${id}"/>`,
            })),
          });
        case "export_subtree":
          return reply(type, {
            root: {
              id: nodeIds![0],
              name: "Icons",
              type: "PAGE",
              children: [
                {
                  id: "6:1",
                  name: "Board",
                  type: "FRAME",
                  bounds: { x: 0, y: 0, width: 10, height: 50 },
                  styles: { fills: [{ type: "IMAGE", imageHash: "abc" }] },
                  tokens: { fills: ["Color/brand"] },
                  children: [
                    {
                      id: "6:2",
                      name: "Label",
                      type: "TEXT",
                      characters: "Hi",
                      mainComponent: undefined,
                    },
                  ],
                },
              ],
            },
          });
        case "get_screenshot":
          return reply(type, { exports: [{ base64: png(10, 50).toString("base64") }] });
        case "export_image_fills":
          return reply(type, {
            images: [{ hash: "abc", mime: "image/png", base64: png(2, 2).toString("base64") }],
          });
        default:
          return failure(type, `Unknown request type: ${type}`);
      }
    },
  };

  try {
    const manifest = await exportFile(sender, {
      ...DEFAULT_EXPORT_OPTIONS,
      outDir,
      pages: ["icons", "Nope"],
      tileHeight: 20,
    });
    assert.deepEqual(manifest.errors, []);
    assert.deepEqual(manifest.missingPages, ["Nope"]);
    assert.equal(manifest.pages.length, 1);
    assert.equal(manifest.pages[0].slug, "02-icons");
    assert.equal(manifest.tokens?.dtcgTokens, 1);
    assert.equal(manifest.components?.sets, 1);
    assert.equal(manifest.assets?.count, 2);
    assert.equal(manifest.pages[0].images[0].tiles.length, 3);
    assert.equal(manifest.imageFills?.count, 1);
    assert.equal(manifest.pages[0].summary?.variables["Color/brand"], 1);

    const dtcg = JSON.parse(await readFile(path.join(outDir, "tokens/tokens.dtcg.json"), "utf8"));
    assert.equal(dtcg.Color.brand.$value.hex, "#ff0000");
    assert.equal(
      await readFile(path.join(outDir, "assets/02-icons/icon/size-sm.svg"), "utf8"),
      '<svg id="5:2"/>'
    );
    const index = await readFile(path.join(outDir, "index.md"), "utf8");
    assert.match(index, /# Figma export: Kit/);
    assert.match(index, /\| Icon \| Icons \| 2 \| Size \|/);
    assert.equal(requests.filter((type) => type === "get_page_summary").length, 1);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("exportFile explains when the plugin lacks extraction support", async () => {
  const stock: BridgeSender = {
    sendWithParams: async (type) => failure(type, `Unknown request type: ${type}`),
  };
  await assert.rejects(
    exportFile(stock, { ...DEFAULT_EXPORT_OPTIONS, outDir: os.tmpdir() }),
    /doesn't support design-system extraction/
  );
});
