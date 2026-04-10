import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Node } from "./node.js";
import { toolInputSchemas } from "./schema.js";
import type { BridgeResponse } from "./types.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ExportFormat = "PNG" | "SVG" | "JPG" | "PDF";

export interface ScreenshotSender {
  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>
  ): Promise<BridgeResponse>;
}

interface ScreenshotExport {
  nodeId: string;
  nodeName: string;
  format: ExportFormat;
  base64: string;
  width: number;
  height: number;
}

interface SaveScreenshotItemInput {
  nodeId: string;
  outputPath: string;
  format?: ExportFormat;
  scale?: number;
}

interface SaveScreenshotItemResult {
  index: number;
  nodeId: string;
  nodeName?: string;
  outputPath: string;
  format?: ExportFormat;
  width?: number;
  height?: number;
  bytesWritten?: number;
  success: boolean;
  error?: string;
}

type WriteToolName = keyof Pick<
  typeof toolInputSchemas,
  | "create_frame"
  | "create_text"
  | "create_rectangle"
  | "append_children"
  | "find_nodes"
  | "batch_mutation"
  | "set_position"
  | "set_size"
  | "set_fills"
  | "set_strokes"
  | "set_corner_radius"
  | "set_text_content"
  | "set_text_style"
  | "set_layout_mode"
  | "set_padding"
  | "set_item_spacing"
  | "delete_node"
>;

export function registerTools(server: McpServer, node: Node): void {
  server.tool(
    "get_document",
    "Get the current Figma page document tree",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_document"));
    }
  );

  server.tool(
    "get_selection",
    "Get the currently selected nodes in Figma",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_selection"));
    }
  );

  server.tool(
    "get_node",
    "Get a specific Figma node by ID. Must use colon format, e.g. '4029:12345', never use hyphens.",
    toolInputSchemas.get_node.shape,
    async ({ nodeId }): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_node", [nodeId]));
    }
  );

  server.tool(
    "get_styles",
    "Get all local styles in the document",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_styles"));
    }
  );

  server.tool(
    "get_metadata",
    "Get metadata about the current Figma document including file name, pages, and current page info",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_metadata"));
    }
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
        node.sendWithParams("get_design_context", undefined, params)
      );
    }
  );

  server.tool(
    "get_variable_defs",
    "Get all local variable definitions including variable collections, modes, and variable values. Variables are Figma's system for design tokens (colors, numbers, strings, booleans).",
    async (): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_variable_defs"));
    }
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
        node.sendWithParams("get_screenshot", nodeIds, params)
      );
    }
  );

  server.tool(
    "save_screenshots",
    "Export screenshots for multiple nodes and save them directly to the local filesystem. Returns metadata only (no base64).",
    toolInputSchemas.save_screenshots.shape,
    async ({ items, format, scale }): Promise<ToolResult> => {
      try {
        const result = await executeSaveScreenshots(node, items, format, scale);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
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
  );

  const registerWriteTool = <N extends WriteToolName>(
    name: N,
    description: string,
    handler: (
      args: z.infer<(typeof toolInputSchemas)[N]>
    ) => Promise<BridgeResponse>
  ): void => {
    server.tool(
      name,
      description,
      toolInputSchemas[name].shape,
      async (args: z.infer<(typeof toolInputSchemas)[N]>): Promise<ToolResult> => {
        return renderResponse(() =>
          handler(args)
        );
      }
    );
  };

  registerWriteTool("create_frame", "Create a frame.", (args) =>
    node.sendWithParams("create_frame", undefined, args)
  );
  registerWriteTool("create_text", "Create a text node.", (args) =>
    node.sendWithParams("create_text", undefined, args)
  );
  registerWriteTool("create_rectangle", "Create a rectangle.", (args) =>
    node.sendWithParams("create_rectangle", undefined, args)
  );
  registerWriteTool("append_children", "Append existing child nodes to a parent.", (args) =>
    node.sendWithParams("append_children", undefined, args)
  );
  registerWriteTool("find_nodes", "Find nodes on the current page.", (args) =>
    node.sendWithParams("find_nodes", undefined, args)
  );
  registerWriteTool("batch_mutation", "Execute write operations in order.", (args) =>
    node.sendWithParams("batch_mutation", undefined, args)
  );

  registerWriteTool("set_position", "Set node position.", ({ nodeId, ...args }) =>
    node.sendWithParams("set_position", [String(nodeId)], args)
  );
  registerWriteTool("set_size", "Set node size.", ({ nodeId, ...args }) =>
    node.sendWithParams("set_size", [String(nodeId)], args)
  );
  registerWriteTool("set_fills", "Set node fills.", ({ nodeId, ...args }) =>
    node.sendWithParams("set_fills", [String(nodeId)], args)
  );
  registerWriteTool("set_strokes", "Set node strokes.", ({ nodeId, ...args }) =>
    node.sendWithParams("set_strokes", [String(nodeId)], args)
  );
  registerWriteTool(
    "set_corner_radius",
    "Set uniform corner radius.",
    ({ nodeId, ...args }) =>
      node.sendWithParams("set_corner_radius", [String(nodeId)], args)
  );
  registerWriteTool(
    "set_text_content",
    "Set text content.",
    ({ nodeId, ...args }) =>
      node.sendWithParams("set_text_content", [String(nodeId)], args)
  );
  registerWriteTool("set_text_style", "Set text style.", ({ nodeId, ...args }) =>
    node.sendWithParams("set_text_style", [String(nodeId)], args)
  );
  registerWriteTool(
    "set_layout_mode",
    "Set auto-layout mode.",
    ({ nodeId, ...args }) =>
      node.sendWithParams("set_layout_mode", [String(nodeId)], args)
  );
  registerWriteTool("set_padding", "Set auto-layout padding.", ({ nodeId, ...args }) =>
    node.sendWithParams("set_padding", [String(nodeId)], args)
  );
  registerWriteTool(
    "set_item_spacing",
    "Set auto-layout item spacing.",
    ({ nodeId, ...args }) =>
      node.sendWithParams("set_item_spacing", [String(nodeId)], args)
  );
  registerWriteTool("delete_node", "Delete a node.", ({ nodeId }) =>
    node.sendWithParams("delete_node", [String(nodeId)])
  );
}

export async function executeSaveScreenshots(
  sender: ScreenshotSender,
  items: SaveScreenshotItemInput[],
  format?: ExportFormat,
  scale?: number
): Promise<{
  total: number;
  succeeded: number;
  failed: number;
  hasErrors: boolean;
  results: SaveScreenshotItemResult[];
}> {
  const results: SaveScreenshotItemResult[] = [];

  for (const [index, item] of items.entries()) {
    const result = await saveScreenshotItemToFile(
      sender,
      item,
      index,
      process.cwd(),
      format,
      scale
    );
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return {
    total: results.length,
    succeeded,
    failed,
    hasErrors: failed > 0,
    results,
  };
}

async function renderResponse(
  fn: () => Promise<BridgeResponse>
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

function resolveAndValidateOutputPath(
  outputPath: string,
  workspaceRoot: string
): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(resolvedRoot, outputPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const escapesRoot =
    relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (escapesRoot) {
    throw new Error(
      `outputPath must be inside the MCP server working directory: ${resolvedRoot}`
    );
  }
  return resolvedPath;
}

function inferFormatFromPath(outputPath: string): ExportFormat | null {
  const ext = path.extname(outputPath).toLowerCase();
  switch (ext) {
    case ".png":
      return "PNG";
    case ".svg":
      return "SVG";
    case ".jpg":
    case ".jpeg":
      return "JPG";
    case ".pdf":
      return "PDF";
    default:
      return null;
  }
}

function resolveExportFormat(
  format: ExportFormat | undefined,
  inferredFormat: ExportFormat | null
): ExportFormat {
  if (format && inferredFormat && format !== inferredFormat) {
    throw new Error(
      `format ${format} conflicts with outputPath extension (${inferredFormat})`
    );
  }
  return format ?? inferredFormat ?? "PNG";
}

function getSingleScreenshotExport(data: unknown): ScreenshotExport {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid screenshot response from plugin");
  }

  const exports = (data as { exports?: unknown }).exports;
  if (!Array.isArray(exports) || exports.length === 0) {
    throw new Error("No screenshot export returned by plugin");
  }

  const first = exports[0];
  if (
    !first ||
    typeof first !== "object" ||
    typeof (first as { nodeId?: unknown }).nodeId !== "string" ||
    typeof (first as { nodeName?: unknown }).nodeName !== "string" ||
    typeof (first as { base64?: unknown }).base64 !== "string" ||
    typeof (first as { width?: unknown }).width !== "number" ||
    typeof (first as { height?: unknown }).height !== "number"
  ) {
    throw new Error("Malformed screenshot export payload");
  }

  const screenshot = first as ScreenshotExport;
  return screenshot;
}

async function saveScreenshotItemToFile(
  sender: ScreenshotSender,
  item: SaveScreenshotItemInput,
  index: number,
  workspaceRoot: string,
  defaultFormat?: ExportFormat,
  defaultScale?: number
): Promise<SaveScreenshotItemResult> {
  let resolvedOutputPath = item.outputPath;

  try {
    resolvedOutputPath = resolveAndValidateOutputPath(
      item.outputPath,
      workspaceRoot
    );
    const inferredFormat = inferFormatFromPath(resolvedOutputPath);
    const resolvedFormat = resolveExportFormat(
      item.format ?? defaultFormat,
      inferredFormat
    );
    const resolvedScale = resolveScale(item.scale, defaultScale);

    const params: Record<string, unknown> = { format: resolvedFormat };
    if (resolvedScale !== undefined) {
      params.scale = resolvedScale;
    }

    const resp = await sender.sendWithParams(
      "get_screenshot",
      [item.nodeId],
      params
    );
    if (resp.error) {
      throw new Error(resp.error);
    }

    const screenshotExport = getSingleScreenshotExport(resp.data);
    const bytesWritten = await writeBase64ToFile(
      screenshotExport.base64,
      resolvedOutputPath
    );

    return {
      index,
      nodeId: screenshotExport.nodeId,
      nodeName: screenshotExport.nodeName,
      outputPath: resolvedOutputPath,
      format: resolvedFormat,
      width: screenshotExport.width,
      height: screenshotExport.height,
      bytesWritten,
      success: true,
    };
  } catch (err) {
    return {
      index,
      nodeId: item.nodeId,
      outputPath: resolvedOutputPath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function writeBase64ToFile(
  base64: string,
  outputPath: string
): Promise<number> {
  const bytes = Buffer.from(base64, "base64");
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, bytes, { flag: "wx" });
  } catch (err) {
    if (isNodeError(err) && err.code === "EEXIST") {
      throw new Error(`File already exists at outputPath: ${outputPath}`);
    }
    throw err;
  }
  return bytes.length;
}

function resolveScale(
  itemScale?: number,
  defaultScale?: number
): number | undefined {
  const resolvedScale = itemScale ?? defaultScale;
  if (resolvedScale === undefined || resolvedScale <= 0) {
    return undefined;
  }
  return resolvedScale;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}
