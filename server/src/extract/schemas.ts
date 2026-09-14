import { z } from "zod";
import { EXPORT_SECTIONS } from "./exporter.js";

const nodeId = z
  .string()
  .regex(
    /^(\d+:\d+|I\d+:\d+(;\d+:\d+)+)$/,
    "Node ID must use colon format, e.g. '4029:12345', or instance-child format 'I12740:17806;12740:17793'"
  );

const fileKey = z
  .string()
  .optional()
  .describe(
    "The fileKey of the Figma file to query. Required when multiple files are connected. Use list_files to see connected files."
  );

const relativePath = (what: string) =>
  z
    .string()
    .min(1)
    .describe(`${what} (relative paths resolve from the MCP server working directory)`);

/** Input schemas for the design-system extraction tools. */
export const extractionSchemas = {
  get_bridge_info: z.object({ fileKey }),

  get_page_summary: z.object({
    pageId: nodeId.optional().describe("Page id from get_metadata (default: the current page)"),
    includeVariants: z.boolean().optional().describe("List every variant with its property values"),
    includeUsage: z
      .boolean()
      .optional()
      .describe("Count how often each component is instantiated on the page"),
    fileKey,
  }),

  get_component_set: z.object({
    nodeId: nodeId.describe("Id of a component set or component"),
    fileKey,
  }),

  get_component_inventory: z.object({
    pages: z
      .array(z.string())
      .optional()
      .describe("Page names or ids to include (default: every page)"),
    includeUsage: z
      .boolean()
      .optional()
      .describe("Count instances per component (slower on large files)"),
    outputPath: relativePath(
      "Write the full inventory, including every variant, to this JSON file"
    ).optional(),
    fileKey,
  }),

  get_tokens: z.object({
    format: z
      .enum(["summary", "raw", "dtcg"])
      .optional()
      .describe(
        "summary: collections, modes and style counts (default without outputPath); raw: Figma variables and styles; dtcg: W3C Design Tokens JSON (default with outputPath)"
      ),
    includeLibraries: z
      .boolean()
      .optional()
      .describe("Include library variables that local variables alias (default true)"),
    outputPath: relativePath(
      "Write the raw or DTCG JSON to this file instead of returning it"
    ).optional(),
    fileKey,
  }),

  export_subtree: z.object({
    nodeId: nodeId.optional().describe("Node or page id (default: the current page)"),
    outputPath: relativePath(
      "Fetch the complete tree and write it to this JSON file. Without it, one bounded chunk is returned and unreached nodes are stubs (stub: true) to request next"
    ).optional(),
    maxNodes: z.number().int().positive().optional().describe("Nodes per chunk (default 800)"),
    includeHidden: z.boolean().optional().describe("Include hidden layers"),
    fileKey,
  }),

  find_assets: z.object({
    scopeId: nodeId.optional().describe("Page or node to search (default: the current page)"),
    types: z
      .array(z.string())
      .optional()
      .describe(
        'Node types to consider (default ["COMPONENT"]); add "FRAME", "GROUP" or "INSTANCE" for artwork that isn\'t a component'
      ),
    maxSize: z
      .number()
      .positive()
      .optional()
      .describe("Largest width or height in px (default 256)"),
    includeImages: z
      .boolean()
      .optional()
      .describe("Allow image fills inside assets, e.g. logos or illustrations"),
    includeExportSettings: z
      .boolean()
      .optional()
      .describe("Also return nodes with export settings (default true)"),
    cursor: z.number().int().min(0).optional().describe("nextCursor from the previous call"),
    limit: z.number().int().positive().optional().describe("Assets per call (default 500)"),
    fileKey,
  }),

  export_assets: z.object({
    nodeIds: z.array(nodeId).min(1).describe("Ids of the nodes to export, e.g. from find_assets"),
    outputDir: relativePath("Directory to write the files to"),
    format: z.enum(["SVG", "PNG", "JPG", "PDF"]).optional().describe("Export format (default SVG)"),
    scale: z.number().positive().optional().describe("Scale for raster formats (default 1)"),
    fileKey,
  }),

  export_file: z.object({
    outputDir: relativePath("Directory for the export"),
    pages: z
      .array(z.string())
      .optional()
      .describe("Page names or ids (default: every page except separators)"),
    sections: z
      .array(z.enum(EXPORT_SECTIONS))
      .optional()
      .describe(`Sections to export (default all): ${EXPORT_SECTIONS.join(", ")}`),
    scale: z.number().positive().optional().describe("Screenshot scale (default 1)"),
    assetTypes: z
      .array(z.string())
      .optional()
      .describe('Node types scanned for assets (default ["COMPONENT"])'),
    assetMaxSize: z
      .number()
      .positive()
      .optional()
      .describe("Largest asset width or height in px (default 256)"),
    assetFormats: z
      .array(z.enum(["SVG", "PNG"]))
      .optional()
      .describe('Asset formats (default ["SVG"])'),
    componentUsage: z.boolean().optional().describe("Count component instances per page"),
    fileKey,
  }),
};
