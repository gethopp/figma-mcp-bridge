import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Node } from "../node.js";
import type { ExtensionRpcMap, ExtensionSchemaMap } from "./types.js";

/**
 * Variable and variable-collection tools.
 *
 * Import only from `schema-common.js`, `tool-helpers.js`, packages, and types.
 * Importing `schema.js` or `tools.js` here would close an import cycle.
 */

/** Tool name to Zod object schema. Spread into `toolInputSchemas`. */
export const schemas = {} satisfies ExtensionSchemaMap;

/** Tool name to RPC wire mapper. Spread into `rpcToArgs`. */
export const rpcToArgs = {} satisfies ExtensionRpcMap;

/**
 * Registers this area's tools.
 * @param server - The MCP server instance.
 * @param node - The node coordinator for leader/follower routing.
 */
export function register(_server: McpServer, _node: Node): void {
  // Tools land in later phases.
}
