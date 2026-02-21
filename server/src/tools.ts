import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Node } from "./node.js";
import { toolInputSchemas } from "./schema.js";
import type { BridgeResponse } from "./types.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function registerTools(server: McpServer, node: Node): void {
  server.tool(
    "get_document",
    "Get the current Figma page document tree",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_document"));
    },
  );

  server.tool(
    "get_selection",
    "Get the currently selected nodes in Figma",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_selection"));
    },
  );

  server.tool(
    "get_node",
    "Get a specific Figma node by ID. Must use colon format, e.g. '4029:12345', never use hyphens.",
    toolInputSchemas.get_node.shape,
    async ({ nodeId }): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_node", [nodeId]));
    },
  );

  server.tool(
    "get_styles",
    "Get all local styles in the document",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_styles"));
    },
  );

  server.tool(
    "get_metadata",
    "Get metadata about the current Figma document including file name, pages, and current page info",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_metadata"));
    },
  );

  server.tool(
    "get_design_context",
    "Get the design context for the current selection or page. Returns a summarized tree structure optimized for understanding the current design context.",
    toolInputSchemas.get_design_context.shape,
    async ({ depth }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (depth !== undefined && depth > 0) {
        params.depth = depth;
      }
      return renderResponse(() =>
        node.sendWithParams("get_design_context", undefined, params),
      );
    },
  );

  server.tool(
    "get_variable_defs",
    "Get all local variable definitions including variable collections, modes, and variable values. Variables are Figma's system for design tokens (colors, numbers, strings, booleans).",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_variable_defs"));
    },
  );

  server.tool(
    "get_screenshot",
    "Export a screenshot of the selected nodes or specific nodes by ID. Returns base64-encoded image data.",
    toolInputSchemas.get_screenshot.shape,
    async ({ nodeIds, format, scale }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (format) params.format = format;
      if (scale !== undefined && scale > 0) params.scale = scale;
      return renderResponse(() =>
        node.sendWithParams("get_screenshot", nodeIds, params),
      );
    },
  );
}

async function renderResponse(
  fn: () => Promise<BridgeResponse>,
): Promise<ToolResult> {
  try {
    const resp = await fn();
    if (resp.error) {
      return {
        content: [{ type: "text", text: resp.error }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(resp.data) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  }
}
