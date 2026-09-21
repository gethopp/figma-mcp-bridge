import assert from "node:assert/strict";
import { registerTools } from "../dist/tools.js";
import { validateRpc } from "../dist/schema.js";

const handlers = new Map();
const server = {
  tool(name, ...args) {
    handlers.set(name, args.at(-1));
  },
};

const calls = [];
const node = {
  listConnectedFiles() {
    return [];
  },
  async send() {
    return { data: {} };
  },
  async sendWithParams(type, nodeIds, params, fileKey) {
    calls.push({ type, nodeIds, params, fileKey });
    return { data: { type, params, fileKey } };
  },
};

registerTools(server, node, 1994);
const createSvg = handlers.get("create_svg");
assert.equal(typeof createSvg, "function");

const inline = await createSvg({
  source:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>',
  name: "Inline smoke",
  width: 32,
  height: 32,
  fileKey: "file-a",
});
assert.equal(inline.isError, undefined);
assert.equal(calls.at(-1).type, "create_svg");
assert.match(calls.at(-1).params.svgText, /^<svg/);
assert.equal(calls.at(-1).params.width, 32);
assert.equal(calls.at(-1).fileKey, "file-a");

const withXmlPreamble = await createSvg({
  source:
    '<?xml version="1.0" encoding="UTF-8"?>\n<!-- generated asset -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M1 4h6"/></svg>',
});
assert.equal(withXmlPreamble.isError, undefined);
assert.match(calls.at(-1).params.svgText, /^<\?xml/);

const fromFile = await createSvg({
  source: "test/fixtures/simple.svg",
  parentId: "1:2",
  x: 10,
  y: 20,
});
assert.equal(fromFile.isError, undefined);
assert.match(calls.at(-1).params.svgText, /^<\?xml/);
assert.match(calls.at(-1).params.svgText, /<path/);
assert.equal(calls.at(-1).params.parentId, "1:2");

const invalid = await createSvg({ source: "<html></html>" });
assert.equal(invalid.isError, true);
assert.match(invalid.content[0].text, /not found|must begin/);

const traversal = await createSvg({ source: "../README.md" });
assert.equal(traversal.isError, true);
assert.match(traversal.content[0].text, /inside the MCP server working directory/);

assert.equal(
  validateRpc("create_svg", undefined, {
    svgText: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    name: "RPC smoke",
  }).error,
  null
);
assert.notEqual(validateRpc("create_svg", undefined, { name: "missing payload" }).error, null);

console.log("create_svg server smoke: ok");
