import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import type { z } from "zod";
import type { Node } from "./node.js";
import {
  createFrameInput,
  createImageInput,
  createShapeShape,
  createTextShape,
  createShapeInput,
  createTextInput,
  setNodePropertiesInput,
  setGradientFillInput,
  setSolidFillInput,
  setEffectsShape,
  setEffectsInput,
  setStrokePropertiesInput,
  setAutoLayoutInput,
  setSelectionInput,
  scrollAndZoomIntoViewInput,
  groupNodesInput,
  ungroupNodeInput,
  setTextPropertiesShape,
  setTextPropertiesInput,
  toolInputSchemas,
} from "./schema.js";
import type { BridgeResponse } from "./types.js";
import { Follower } from "./follower.js";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_REDIRECTS = 5;

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
  clip?: boolean;
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

/**
 * Registers all Figma bridge tools on the given MCP server.
 * @param server - The MCP server instance.
 * @param node - The node coordinator for leader/follower routing.
 * @param port - The port used for follower-to-leader HTTP calls.
 */
export function registerTools(
  server: McpServer,
  node: Node,
  port: number
): void {
  server.tool(
    "list_files",
    "List all currently connected Figma files. Returns fileKey and fileName for each. Use the fileKey to target a specific file in other tools.",
    async (): Promise<ToolResult> => {
      try {
        let files = node.listConnectedFiles();
        if (files === undefined) {
          // Follower: fetch via RPC from leader
          const follower = new Follower(`http://localhost:${port}`);
          files = await follower.listConnectedFiles();
        }
        return {
          content: [{ type: "text", text: JSON.stringify(files) }],
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

  server.tool(
    "get_document",
    "Get the current Figma page document tree. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_document.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.send("get_document", undefined, fileKey)
      );
    }
  );

  server.tool(
    "get_selection",
    "Get the currently selected nodes in Figma. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_selection.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.send("get_selection", undefined, fileKey)
      );
    }
  );

  server.tool(
    "get_node",
    "Get a specific Figma node by ID. Accepts top-level IDs like '4029:12345' and instance-child IDs like 'I12740:17806;12740:17793'. Never use hyphens. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_node.shape,
    async ({ nodeId, fileKey }): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_node", [nodeId], fileKey));
    }
  );

  server.tool(
    "get_styles",
    "Get all local styles in the document. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_styles.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      return renderResponse(() => node.send("get_styles", undefined, fileKey));
    }
  );

  server.tool(
    "get_metadata",
    "Get metadata about the current Figma document including file name, pages, and current page info. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_metadata.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.send("get_metadata", undefined, fileKey)
      );
    }
  );

  server.tool(
    "get_design_context",
    "Get the design context for the current selection or page. Returns a summarized tree structure optimized for understanding the current design context. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_design_context.shape,
    async ({ depth, fileKey }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (depth !== undefined && depth > 0) {
        params.depth = depth;
      }
      return renderResponse(() =>
        node.sendWithParams("get_design_context", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "get_variable_defs",
    "Get all local variable definitions including variable collections, modes, and variable values. Variables are Figma's system for design tokens (colors, numbers, strings, booleans). When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_variable_defs.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.send("get_variable_defs", undefined, fileKey)
      );
    }
  );

  server.tool(
    "get_screenshot",
    "Export a screenshot of the selected nodes or specific nodes by ID. Returns base64-encoded image data. When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_screenshot.shape,
    async ({ nodeIds, format, scale, clip, fileKey }): Promise<ToolResult> => {
      const params: Record<string, unknown> = {};
      if (format) params.format = format;
      if (scale !== undefined && scale > 0) params.scale = scale;
      if (clip !== undefined) params.clip = clip;
      return renderResponse(() =>
        node.sendWithParams("get_screenshot", nodeIds, params, fileKey)
      );
    }
  );

  server.tool(
    "set_node_visibility",
    "Show or hide specific Figma nodes. Returns previous visibility for each node so you can restore them after. Useful for isolating a single layer before exporting: hide all siblings, export the frame, then restore visibility.",
    toolInputSchemas.set_node_visibility.shape,
    async ({ items, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams(
          "set_node_visibility",
          undefined,
          { items },
          fileKey
        )
      );
    }
  );

  server.tool(
    "set_text_content",
    "Update the contents of a single text node. The plugin loads the node's fonts before applying the new text. When multiple files are connected, specify fileKey.",
    toolInputSchemas.set_text_content.shape,
    async ({ nodeId, text, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("set_text_content", [nodeId], { text }, fileKey)
      );
    }
  );

  server.tool(
    "set_text_properties",
    "Patch common text properties such as font family/style, size, alignment, auto-resize, line height, letter spacing, fill color, and bounds. When multiple files are connected, specify fileKey.",
    setTextPropertiesShape.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(setTextPropertiesInput, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...properties } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams(
          "set_text_properties",
          [nodeId],
          properties,
          fileKey
        )
      );
    }
  );

  server.tool(
    "set_node_properties",
    "Patch common node properties such as name, position, size, visibility, opacity, and corner radius. Only supported properties for the target node type may be changed. Use set_solid_fill or set_gradient_fill to change paints. When multiple files are connected, specify fileKey.",
    setNodePropertiesInput.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(toolInputSchemas.set_node_properties, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...properties } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams(
          "set_node_properties",
          [nodeId],
          properties,
          fileKey
        )
      );
    }
  );

  server.tool(
    "set_solid_fill",
    "Replace a node's fill (or stroke) with a single solid paint. Provide a hex color and optional paint opacity. Use set_gradient_fill for gradient paints.",
    setSolidFillInput.shape,
    async ({ nodeId, fileKey, ...params }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("set_solid_fill", [nodeId], params, fileKey)
      );
    }
  );

  server.tool(
    "set_gradient_fill",
    "Replace a node's fill (or stroke) with a gradient paint. Provide ordered stops (position 0..1, hex color, optional alpha) and an optional 2x3 gradientTransform matching Figma's gradientTransform format. Useful for setting linear/radial/angular/diamond gradients programmatically.",
    setGradientFillInput.shape,
    async ({ nodeId, fileKey, ...params }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("set_gradient_fill", [nodeId], params, fileKey)
      );
    }
  );

  server.tool(
    "set_effects",
    "Replace a node's effects list (drop/inner shadows, layer/background blurs). Pass an empty array to clear all effects. Each entry mirrors the shape returned by get_node's `effects` field.",
    setEffectsShape.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(setEffectsInput, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("set_effects", [nodeId], params, fileKey)
      );
    }
  );

  server.tool(
    "set_stroke_properties",
    "Patch stroke geometry properties: weight, align, dash pattern, cap, join. Use set_solid_fill/set_gradient_fill with target='stroke' to set the paint itself.",
    setStrokePropertiesInput.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(
        toolInputSchemas.set_stroke_properties,
        args
      );
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("set_stroke_properties", [nodeId], params, fileKey)
      );
    }
  );

  server.tool(
    "set_auto_layout",
    "Configure auto-layout on a frame: direction, gap, padding, alignment, sizing modes, wrap. Set layoutMode='NONE' to disable auto-layout on the frame.",
    setAutoLayoutInput.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(toolInputSchemas.set_auto_layout, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("set_auto_layout", [nodeId], params, fileKey)
      );
    }
  );

  server.tool(
    "create_frame",
    "Create a new frame, optionally inside a specified parent. You can set name, size, position, and a solid fill. When multiple files are connected, specify fileKey.",
    createFrameInput.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(toolInputSchemas.create_frame, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("create_frame", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "create_text",
    "Create a new text node, optionally inside a specified parent. You can set its content, font, size, alignment, color, position, and bounds. When multiple files are connected, specify fileKey.",
    createTextShape.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(createTextInput, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("create_text", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "create_shape",
    "Create a rectangle, ellipse, or line, optionally inside a specified parent. You can set its size, position, rotation, fill, and stroke. When multiple files are connected, specify fileKey.",
    createShapeShape.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(createShapeInput, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("create_shape", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "create_image",
    "Create an image-backed rectangle from a local file path, remote URL, or data URI. You can set its parent, position, size, corner radius, and fit mode. When multiple files are connected, specify fileKey.",
    createImageInput.shape,
    async ({ source, fileKey, ...params }): Promise<ToolResult> => {
      try {
        const imageBase64 = await loadImageSourceAsBase64(
          source,
          process.cwd()
        );
        return await renderResponse(() =>
          node.sendWithParams(
            "create_image",
            undefined,
            { ...params, imageBase64 },
            fileKey
          )
        );
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

  server.tool(
    "duplicate_nodes",
    "Duplicate one or more nodes in place. The duplicates remain under the same parent as the originals. When multiple files are connected, specify fileKey.",
    toolInputSchemas.duplicate_nodes.shape,
    async ({ nodeIds, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("duplicate_nodes", nodeIds, undefined, fileKey)
      );
    }
  );

  server.tool(
    "reparent_nodes",
    "Move one or more nodes into a different parent container. When multiple files are connected, specify fileKey.",
    toolInputSchemas.reparent_nodes.shape,
    async ({ nodeIds, parentId, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("reparent_nodes", nodeIds, { parentId }, fileKey)
      );
    }
  );

  server.tool(
    "group_nodes",
    "Wrap a list of nodes in a new group. Nodes must share a common parent (or supply parentId explicitly). Returns the new group's node ID.",
    groupNodesInput.shape,
    async ({ nodeIds, fileKey, ...params }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("group_nodes", nodeIds, params, fileKey)
      );
    }
  );

  server.tool(
    "ungroup_node",
    "Ungroup a group or frame — its children move up to its parent and the wrapper is removed. Returns the IDs of the orphaned children in their new parent.",
    ungroupNodeInput.shape,
    async ({ nodeId, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("ungroup_node", [nodeId], undefined, fileKey)
      );
    }
  );

  server.tool(
    "set_selection",
    "Set the current page selection to a list of node IDs. Pass an empty array to clear the selection. Works in both design editor and Dev Mode.",
    setSelectionInput.shape,
    async ({ nodeIds, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("set_selection", nodeIds, undefined, fileKey)
      );
    }
  );

  server.tool(
    "scroll_and_zoom_into_view",
    "Scroll and zoom the Figma viewport so the given nodes are framed in view. Works in both design editor and Dev Mode.",
    scrollAndZoomIntoViewInput.shape,
    async ({ nodeIds, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams(
          "scroll_and_zoom_into_view",
          nodeIds,
          undefined,
          fileKey
        )
      );
    }
  );

  server.tool(
    "delete_nodes",
    "Delete one or more nodes. This is destructive and requires confirm: true. Page and document nodes cannot be deleted through this tool. When multiple files are connected, specify fileKey.",
    toolInputSchemas.delete_nodes.shape,
    async ({ nodeIds, confirm, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.sendWithParams("delete_nodes", nodeIds, { confirm }, fileKey)
      );
    }
  );

  server.tool(
    "get_motion_styles",
    "List all available animation presets in Figma (Motion API beta). When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_motion_styles.shape,
    async ({ fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.send("get_motion_styles", undefined, fileKey)
      );
    }
  );

  server.tool(
    "get_node_motion",
    "Read a node's current animationStyles, animations, manualKeyframeTracks, and timelines (Motion API beta). When multiple files are connected, specify fileKey.",
    toolInputSchemas.get_node_motion.shape,
    async ({ nodeId, fileKey }): Promise<ToolResult> => {
      return renderResponse(() =>
        node.send("get_node_motion", [nodeId], fileKey)
      );
    }
  );

  server.tool(
    "apply_animation_style",
    "Apply a preset animation style to a node (Motion API beta). When multiple files are connected, specify fileKey.",
    toolInputSchemas.apply_animation_style.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(toolInputSchemas.apply_animation_style, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...properties } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams(
          "apply_animation_style",
          [nodeId],
          properties,
          fileKey
        )
      );
    }
  );

  server.tool(
    "remove_animation_style",
    "Remove an applied animation style from a node (Motion API beta). If no animationStyleId is provided, removes all styles. When multiple files are connected, specify fileKey.",
    toolInputSchemas.remove_animation_style.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(toolInputSchemas.remove_animation_style, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...properties } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams(
          "remove_animation_style",
          [nodeId],
          properties,
          fileKey
        )
      );
    }
  );

  server.tool(
    "apply_manual_keyframe_track",
    "Applies or replaces the manual Motion keyframe track for a property, paint, or effect field on a node. When multiple files are connected, specify fileKey.",
    toolInputSchemas.apply_manual_keyframe_track.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(toolInputSchemas.apply_manual_keyframe_track, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...properties } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams(
          "apply_manual_keyframe_track",
          [nodeId],
          properties,
          fileKey
        )
      );
    }
  );

  server.tool(
    "remove_manual_keyframe_track",
    "Removes the manual Motion keyframe track for a property, paint, or effect field on a node. When multiple files are connected, specify fileKey.",
    toolInputSchemas.remove_manual_keyframe_track.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(toolInputSchemas.remove_manual_keyframe_track, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...properties } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams(
          "remove_manual_keyframe_track",
          [nodeId],
          properties,
          fileKey
        )
      );
    }
  );

  server.tool(
    "set_timeline_duration",
    "Sets the duration (in seconds) for a timeline. When multiple files are connected, specify fileKey.",
    toolInputSchemas.set_timeline_duration.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(toolInputSchemas.set_timeline_duration, args);
      if (!parsed.success) return parsed.error;
      const { nodeId, fileKey, ...properties } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams(
          "set_timeline_duration",
          [nodeId],
          properties,
          fileKey
        )
      );
    }
  );

  server.tool(
    "save_screenshots",
    "Export screenshots for multiple nodes and save them directly to the local filesystem. Returns metadata only (no base64). When multiple files are connected, specify fileKey.",
    toolInputSchemas.save_screenshots.shape,
    async ({ items, format, scale, clip, fileKey }): Promise<ToolResult> => {
      try {
        // Create a sender bound to the specific fileKey
        const sender: ScreenshotSender = {
          sendWithParams: (requestType, nodeIds, params) =>
            node.sendWithParams(requestType, nodeIds, params, fileKey),
        };
        const result = await executeSaveScreenshots(
          sender,
          items,
          format,
          scale,
          clip
        );
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
}

/**
 * Saves screenshots for multiple nodes to the local filesystem in batch.
 * @param sender - Sender that forwards get_screenshot requests to the plugin.
 * @param items - Screenshot save operations to execute.
 * @param format - Default export format override.
 * @param scale - Default export scale override for raster formats.
 * @param clip - Default clipping override for saved screenshots.
 * @returns Aggregate result with per-item outcomes.
 */
export async function executeSaveScreenshots(
  sender: ScreenshotSender,
  items: SaveScreenshotItemInput[],
  format?: ExportFormat,
  scale?: number,
  clip?: boolean
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
      scale,
      clip
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

/**
 * Wraps a bridge call and converts the result into a tool result.
 * @param fn - Bridge call to execute.
 * @returns Tool result with the bridge response or an error message.
 */
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

/**
 * Parses raw tool arguments with a Zod schema and returns a typed result or a tool error.
 * @param schema - Zod schema to validate against.
 * @param args - Raw arguments from the MCP client.
 * @returns Parsed data on success, or an error tool result on failure.
 */
function parseToolInput<T>(
  schema: z.ZodType<T>,
  args: unknown
): { success: true; data: T } | { success: false; error: ToolResult } {
  const result = schema.safeParse(args);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: {
      content: [{ type: "text", text: result.error.issues[0].message }],
      isError: true,
    },
  };
}

/**
 * Resolves an output path relative to the workspace and ensures it stays inside it.
 * @param outputPath - Relative or absolute output path.
 * @param workspaceRoot - Root directory that must contain the resolved path.
 * @returns Absolute path inside the workspace root.
 */
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

/**
 * Loads an image source as a base64 string from a URL, data URI, or local file.
 * @param source - Image source: URL, data URI, or local file path.
 * @param workspaceRoot - Root directory for resolving relative local paths.
 * @returns Base64-encoded image bytes.
 */
async function loadImageSourceAsBase64(
  source: string,
  workspaceRoot: string
): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const bytes = await fetchImageBytes(source);
    return bytes.toString("base64");
  }

  const dataUrlMatch = source.match(/^data:.*?;base64,(.+)$/);
  if (dataUrlMatch) {
    return dataUrlMatch[1];
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(resolvedRoot, source);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  const escapesRoot =
    relativePath.startsWith("..") || path.isAbsolute(relativePath);
  if (escapesRoot) {
    throw new Error(
      `image source must be inside the MCP server working directory: ${resolvedRoot}`
    );
  }
  const bytes = await readFile(resolvedPath);
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes`);
  }
  return bytes.toString("base64");
}

/**
 * Fetches image bytes from a remote URL with redirect and timeout limits.
 * @param source - HTTP or HTTPS image URL.
 * @returns Raw image bytes.
 */
async function fetchImageBytes(source: string): Promise<Buffer> {
  let url = new URL(source);
  let redirects = 0;

  while (true) {
    await assertSafeHttpUrl(url);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      IMAGE_FETCH_TIMEOUT_MS
    );
    let resp: Response;
    try {
      resp = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Timed out fetching image after ${IMAGE_FETCH_TIMEOUT_MS}ms`
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) {
        throw new Error(
          `Image redirect missing Location header: ${resp.status}`
        );
      }
      redirects += 1;
      if (redirects > MAX_IMAGE_REDIRECTS) {
        throw new Error(
          `Image fetch exceeded ${MAX_IMAGE_REDIRECTS} redirects`
        );
      }
      url = new URL(location, url);
      continue;
    }

    if (!resp.ok) {
      throw new Error(
        `Failed to fetch image: ${resp.status} ${resp.statusText}`
      );
    }

    const contentLength = resp.headers.get("content-length");
    if (contentLength !== null) {
      const size = Number(contentLength);
      if (!Number.isFinite(size) || size < 0) {
        throw new Error("Invalid image Content-Length header");
      }
      if (size > MAX_IMAGE_BYTES) {
        throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes`);
      }
    }

    return readBoundedResponse(resp, MAX_IMAGE_BYTES);
  }
}

/**
 * Validates that an image URL uses a safe public HTTP(S) endpoint.
 * @param url - URL to validate.
 */
async function assertSafeHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Image URL must use http or https");
  }
  if (!url.hostname) {
    throw new Error("Image URL must include a hostname");
  }

  const hostname = normalizeHostname(url.hostname);
  const literalIp = isIP(hostname);
  if (literalIp !== 0) {
    if (isBlockedIp(hostname)) {
      throw new Error("Image URL resolves to a blocked internal address");
    }
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("Image URL hostname did not resolve");
  }
  if (addresses.some((address) => isBlockedIp(address.address))) {
    throw new Error("Image URL resolves to a blocked internal address");
  }
}

/**
 * Checks whether an IP address is in a private, loopback, or otherwise blocked range.
 * @param address - IPv4 or IPv6 address string.
 * @returns True if the address is blocked for SSRF protection.
 */
function isBlockedIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIp(normalized.slice("::ffff:".length));
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]:/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

/**
 * Strips surrounding brackets from an IPv6 hostname so it can be parsed as an IP.
 * @param hostname - Hostname string, possibly bracketed.
 * @returns Normalized hostname without brackets.
 */
function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Reads a response body up to a maximum byte limit.
 * @param resp - Fetch response with a readable body.
 * @param maxBytes - Maximum number of bytes to accept.
 * @returns Concatenated response bytes.
 */
async function readBoundedResponse(
  resp: Response,
  maxBytes: number
): Promise<Buffer> {
  if (!resp.body) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of resp.body) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) {
      throw new Error(`Image exceeds ${maxBytes} bytes`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Infers an export format from a file path extension.
 * @param outputPath - Output file path.
 * @returns Export format, or null if the extension is unrecognized.
 */
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

/**
 * Resolves the final export format, ensuring it does not conflict with the file extension.
 * @param format - Explicitly requested format.
 * @param inferredFormat - Format inferred from the output path extension.
 * @returns Resolved export format.
 */
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

/**
 * Extracts and validates the first screenshot export from plugin response data.
 * @param data - Plugin response payload.
 * @returns Validated screenshot export object.
 */
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

/**
 * Saves a single screenshot item to the local filesystem.
 * @param sender - Sender that forwards get_screenshot requests to the plugin.
 * @param item - Screenshot save request.
 * @param index - Index of this item in the batch.
 * @param workspaceRoot - Root directory for resolving output paths.
 * @param defaultFormat - Default export format override.
 * @param defaultScale - Default export scale override.
 * @param defaultClip - Default clipping override.
 * @returns Result of the save operation.
 */
async function saveScreenshotItemToFile(
  sender: ScreenshotSender,
  item: SaveScreenshotItemInput,
  index: number,
  workspaceRoot: string,
  defaultFormat?: ExportFormat,
  defaultScale?: number,
  defaultClip?: boolean
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
    const resolvedClip = item.clip ?? defaultClip;

    const params: Record<string, unknown> = { format: resolvedFormat };
    if (resolvedScale !== undefined) {
      params.scale = resolvedScale;
    }
    if (resolvedClip !== undefined) {
      params.clip = resolvedClip;
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

/**
 * Writes base64-encoded bytes to a file, creating parent directories as needed.
 * @param base64 - Base64-encoded file contents.
 * @param outputPath - Destination file path.
 * @returns Number of bytes written.
 */
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

/**
 * Resolves the effective screenshot scale from item and default values.
 * @param itemScale - Scale specified for the item.
 * @param defaultScale - Default scale for the batch.
 * @returns Positive scale value, or undefined if not applicable.
 */
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

/**
 * Type guard that checks whether a value is a NodeJS error with an optional code.
 * @param err - Value to check.
 * @returns True when the value is an Error instance.
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error;
}
