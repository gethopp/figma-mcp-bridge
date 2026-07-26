/**
 * Regression check for alias normalisation on both request paths.
 *
 * `set_solid_fill` / `set_text_content` accept the create_* spellings
 * (`fillHex`, `fillOpacity`, `characters`). The MCP tool handlers forward
 * `parsed.data`, so they were always fine. The HTTP RPC path needed
 * `validateRpc` to return its parsed result and the leader to forward that —
 * otherwise an aliased call cleared validation and was then rejected by the
 * plugin, which only understands the canonical spelling.
 *
 * The plugin's own guards are inlined below so this runs without a live Figma
 * connection.
 *
 * Run with:  bun run scripts/repro-alias-rpc.ts
 * Exits 0 when both paths normalise correctly, 1 otherwise.
 */

import { validateRpc, toolInputSchemas } from "../src/schema.js";

type Outcome =
  | { status: "rejected-by-server"; message: string }
  | { status: "rejected-by-plugin"; message: string }
  | { status: "applied"; payload: Record<string, unknown> };

/**
 * The plugin's own guards, copied from plugin/src/main/code.ts so this script
 * runs without a live Figma connection.
 */
const pluginGuards: Record<
  string,
  (nodeIds: string[], params: Record<string, unknown>) => string | null
> = {
  set_text_content: (nodeIds, params) => {
    if (!nodeIds[0]) return "nodeIds is required for set_text_content";
    if (typeof params.text !== "string")
      return "text is required for set_text_content";
    return null;
  },
  set_solid_fill: (nodeIds, params) => {
    if (!nodeIds[0]) return "nodeIds is required for set_solid_fill";
    if (typeof params.hex !== "string") return "hex is required";
    return null;
  },
};

/**
 * Mirrors LeaderServer.handleRPC: validate, then forward params to the plugin.
 * `validateRpc` now returns the normalised params, so an aliased call reaches
 * the plugin with the canonical key.
 */
function simulateRpcCall(
  tool: string,
  nodeIds: string[],
  params: Record<string, unknown>
): Outcome {
  const validation = validateRpc(tool, nodeIds, params);
  if (validation.error) {
    return { status: "rejected-by-server", message: validation.error };
  }

  const forwarded = validation.params ?? params;
  const pluginError = pluginGuards[tool](nodeIds, forwarded);
  if (pluginError) {
    return { status: "rejected-by-plugin", message: pluginError };
  }
  return { status: "applied", payload: forwarded };
}

/**
 * Mirrors the MCP tool handlers in server/src/tools.ts, which parse first and
 * forward `parsed.data`. Included as a control: this path handles aliases fine.
 */
function simulateMcpToolCall(
  tool: "set_text_content" | "set_solid_fill",
  args: Record<string, unknown>
): Outcome {
  const parsed = toolInputSchemas[tool].safeParse(args);
  if (!parsed.success) {
    return {
      status: "rejected-by-server",
      message: parsed.error.issues[0].message,
    };
  }

  const { nodeId, fileKey, ...rest } = parsed.data;
  const payload =
    tool === "set_text_content" ? { text: rest.text } : { ...rest };

  const pluginError = pluginGuards[tool]([nodeId], payload);
  if (pluginError) {
    return { status: "rejected-by-plugin", message: pluginError };
  }
  return { status: "applied", payload };
}

function describe(outcome: Outcome): string {
  return outcome.status === "applied"
    ? `applied ${JSON.stringify(outcome.payload)}`
    : `${outcome.status}: ${outcome.message}`;
}

interface Case {
  name: string;
  outcome: Outcome;
  expected: Outcome["status"];
}

const cases: Case[] = [
  // The bug: aliases pass validation, then die inside the plugin.
  {
    name: "RPC   set_text_content { characters }",
    outcome: simulateRpcCall("set_text_content", ["1:2"], {
      characters: "hello",
    }),
    expected: "applied",
  },
  {
    name: "RPC   set_solid_fill   { fillHex }",
    outcome: simulateRpcCall("set_solid_fill", ["1:2"], { fillHex: "#1B66D2" }),
    expected: "applied",
  },
  {
    name: "RPC   set_solid_fill   { fillHex, fillOpacity }",
    outcome: simulateRpcCall("set_solid_fill", ["1:2"], {
      fillHex: "#1B66D2",
      fillOpacity: 0.5,
    }),
    expected: "applied",
  },

  // Canonical spellings over RPC still work.
  {
    name: "RPC   set_text_content { text }",
    outcome: simulateRpcCall("set_text_content", ["1:2"], { text: "hello" }),
    expected: "applied",
  },
  {
    name: "RPC   set_solid_fill   { hex }",
    outcome: simulateRpcCall("set_solid_fill", ["1:2"], { hex: "#1B66D2" }),
    expected: "applied",
  },

  // Genuinely bad input must still be caught by the server, not the plugin.
  {
    name: "RPC   set_solid_fill   { } (neither spelling)",
    outcome: simulateRpcCall("set_solid_fill", ["1:2"], {}),
    expected: "rejected-by-server",
  },
  {
    name: "RPC   set_solid_fill   { fillHex: 'not-a-hex' }",
    outcome: simulateRpcCall("set_solid_fill", ["1:2"], {
      fillHex: "not-a-hex",
    }),
    expected: "rejected-by-server",
  },

  // Control: the MCP tool path forwards parsed.data, so aliases work there.
  {
    name: "TOOL  set_text_content { characters }",
    outcome: simulateMcpToolCall("set_text_content", {
      nodeId: "1:2",
      characters: "hello",
    }),
    expected: "applied",
  },
  {
    name: "TOOL  set_solid_fill   { fillHex }",
    outcome: simulateMcpToolCall("set_solid_fill", {
      nodeId: "1:2",
      fillHex: "#1B66D2",
    }),
    expected: "applied",
  },
];

const failures = cases.filter((c) => c.outcome.status !== c.expected);


for (const { name, outcome, expected } of cases) {
  const ok = outcome.status === expected;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} -> ${describe(outcome)}`
  );
}

console.log();
if (failures.length === 0) {
  console.log("All cases behave as expected — the RPC path is fixed.");
  process.exit(0);
}

console.log(`${failures.length} case(s) failed:`);
for (const { name, outcome, expected } of failures) {
  console.log(`  ${name}\n    expected ${expected}, got ${describe(outcome)}`);
}
process.exit(1);
