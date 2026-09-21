import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import type { Node } from "../node.js";

/**
 * Shapes an extension area file exports.
 *
 * `schemas` feeds `toolInputSchemas` in `schema.ts`, so every tool listed here
 * is validated on the follower to leader RPC path as well as at the MCP edge.
 */
export type ExtensionSchemaMap = Record<string, z.ZodType<unknown, z.ZodTypeDef, unknown>>;

/**
 * Maps the RPC wire format { tool, nodeIds?, params? } to a tool's input shape.
 * Same signature as the mappers in `schema.ts`.
 */
export type RpcArgMapper = (nodeIds?: string[], params?: Record<string, unknown>) => unknown;

export type ExtensionRpcMap = Record<string, RpcArgMapper>;

/**
 * Registers an area's tools on the MCP server.
 * @param server - The MCP server instance.
 * @param node - The node coordinator for leader/follower routing.
 */
export type ExtensionRegister = (server: McpServer, node: Node) => void;
