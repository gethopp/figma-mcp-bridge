import { z } from "zod";

/**
 * Figma node IDs:
 *   - top-level node:        "4029:12345"
 *   - child inside INSTANCE: "I12740:17806;12740:17793" (and deeper, semicolon-separated)
 *
 * Both forms are valid for figma.getNodeById and are returned as-is by the plugin
 * from get_selection / get_design_context.
 */

/**
 * Creates a Zod schema that validates a Figma node ID string.
 * @returns A Zod string schema for node IDs.
 */
const createFigmaNodeIdSchema = () =>
  z
    .string()
    .regex(
      /^(\d+:\d+|I\d+:\d+(;\d+:\d+)+)$/,
      "Node ID must use colon format, e.g. '4029:12345', or instance-child format 'I12740:17806;12740:17793'"
    );

/**
 * Creates a Zod schema that validates a screenshot export format.
 * @returns A Zod enum schema for export formats.
 */
const createExportFormatSchema = () => z.enum(["PNG", "SVG", "JPG", "PDF"]);

/**
 * Creates a Zod schema that validates a CSS-style hex color string.
 * @returns A Zod string schema for hex colors.
 */
const createHexColorSchema = () =>
  z
    .string()
    .regex(
      /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
      "Color must be a hex value like '#FFAA00'"
    );
const textAlignHorizontal = z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]);
const textAlignVertical = z.enum(["TOP", "CENTER", "BOTTOM"]);
const textAutoResize = z.enum([
  "NONE",
  "WIDTH_AND_HEIGHT",
  "HEIGHT",
  "TRUNCATE",
]);
const shapeType = z.enum(["RECTANGLE", "ELLIPSE", "LINE"]);
const imageScaleMode = z.enum(["FILL", "FIT"]);

const fileKeyField = z
  .string()
  .optional()
  .describe(
    "The fileKey of the Figma file to query. Required when multiple files are connected. Use list_files to see connected files."
  );

const gradientStop = z.object({
  position: z
    .number()
    .min(0)
    .max(1)
    .describe("Stop position from 0 (start of gradient) to 1 (end)"),
  hex: createHexColorSchema().describe("Stop color as hex"),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional per-stop alpha (default 1)"),
});

const gradientTransform = z
  .array(z.array(z.number()).length(3))
  .length(2)
  .describe(
    "2x3 affine matrix [[a,b,tx],[c,d,ty]] mapping the unit gradient onto the shape (Figma's gradientTransform). Defaults to identity (horizontal left→right)."
  );

export const setGradientFillInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  gradientType: z
    .enum(["LINEAR", "RADIAL", "ANGULAR", "DIAMOND"])
    .optional()
    .describe("Gradient family (default LINEAR)"),
  gradientStops: z
    .array(gradientStop)
    .min(2)
    .describe("Ordered list of gradient color stops (at least 2)"),
  gradientTransform: gradientTransform.optional(),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Overall paint opacity (default 1)"),
  target: z
    .enum(["fill", "stroke"])
    .optional()
    .describe("Apply to fills or strokes (default fill)"),
  fileKey: fileKeyField,
});

export const setNodePropertiesInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  name: z.string().optional().describe("Optional new node name"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  rotation: z.number().optional().describe("Optional rotation in degrees"),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional opacity from 0 to 1"),
  visible: z.boolean().optional().describe("Optional visibility"),
  cornerRadius: z.number().min(0).optional().describe("Optional corner radius"),
  fileKey: fileKeyField,
});

export const setSolidFillInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  hex: createHexColorSchema().describe("Solid color as hex (e.g. '#FFAA00')"),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional paint opacity from 0 to 1 (default 1)"),
  target: z
    .enum(["fill", "stroke"])
    .optional()
    .describe("Apply to fills or strokes (default fill)"),
  fileKey: fileKeyField,
});

const blendMode = z.enum([
  "PASS_THROUGH",
  "NORMAL",
  "DARKEN",
  "MULTIPLY",
  "LINEAR_BURN",
  "COLOR_BURN",
  "LIGHTEN",
  "SCREEN",
  "LINEAR_DODGE",
  "COLOR_DODGE",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "DIFFERENCE",
  "EXCLUSION",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY",
]);

const shadowEffect = z.object({
  type: z.enum(["DROP_SHADOW", "INNER_SHADOW"]),
  color: createHexColorSchema().describe("Shadow color as hex"),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Shadow alpha 0..1 (default 1)"),
  offset: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .describe("Shadow offset in pixels"),
  radius: z.number().min(0).describe("Blur radius (>= 0)"),
  spread: z
    .number()
    .optional()
    .describe(
      "Expand/contract distance (default 0). Only honored on rects/ellipses, or on frames/components/instances with visible fills and clipsContent."
    ),
  blendMode: blendMode.optional().describe("Default NORMAL"),
  visible: z.boolean().optional().describe("Default true"),
});

const blurEffect = z.object({
  type: z.enum(["LAYER_BLUR", "BACKGROUND_BLUR"]),
  radius: z.number().min(0).describe("Blur radius (>= 0)"),
  visible: z.boolean().optional().describe("Default true"),
});

const effectInput = z.object({
  type: z
    .enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"])
    .describe("Effect type"),
  color: createHexColorSchema()
    .optional()
    .describe("Required for shadow effects"),
  opacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Shadow alpha 0..1 (default 1)"),
  offset: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional()
    .describe("Required for shadow effects"),
  radius: z.number().min(0).optional().describe("Required blur radius"),
  spread: z
    .number()
    .optional()
    .describe(
      "Expand/contract distance (default 0). Only honored on rects/ellipses, or on frames/components/instances with visible fills and clipsContent."
    ),
  blendMode: blendMode.optional().describe("Default NORMAL"),
  visible: z.boolean().optional().describe("Default true"),
});

const effectRuntimeSchema = z.discriminatedUnion("type", [
  shadowEffect,
  blurEffect,
]);

export const setSelectionInput = z.object({
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .describe("Node IDs to select. Pass [] to clear the selection."),
  fileKey: fileKeyField,
});

export const scrollAndZoomIntoViewInput = z.object({
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .min(1)
    .describe("Node IDs to frame in the viewport"),
  fileKey: fileKeyField,
});

export const groupNodesInput = z.object({
  nodeIds: z
    .array(createFigmaNodeIdSchema())
    .min(1)
    .describe("Node IDs to group. Must share a common parent."),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe(
      "Optional explicit parent for the new group. Defaults to the shared parent of the input nodes."
    ),
  name: z.string().optional().describe("Optional name for the new group"),
  fileKey: fileKeyField,
});

export const ungroupNodeInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe(
    "Group or frame to ungroup. Children move up to its parent and the wrapper is removed."
  ),
  fileKey: fileKeyField,
});

export const setEffectsShape = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  effects: z
    .array(effectInput)
    .describe(
      "Full replacement list of effects. Pass [] to clear all effects. Each entry is a drop/inner shadow or a layer/background blur."
    ),
  fileKey: fileKeyField,
});

export const setEffectsInput = setEffectsShape.superRefine((value, ctx) => {
  value.effects.forEach((effect, index) => {
    const result = effectRuntimeSchema.safeParse(effect);
    if (result.success) return;

    for (const issue of result.error.issues) {
      ctx.addIssue({
        ...issue,
        path: ["effects", index, ...issue.path],
      });
    }
  });
});

export const setStrokePropertiesInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node ID to update"),
  strokeWeight: z
    .number()
    .min(0)
    .optional()
    .describe("Stroke thickness in pixels"),
  strokeAlign: z
    .enum(["INSIDE", "OUTSIDE", "CENTER"])
    .optional()
    .describe("How the stroke is positioned relative to the geometry edge"),
  dashPattern: z
    .array(z.number().min(0))
    .optional()
    .describe(
      "Dash pattern as [dash, gap, dash, gap, ...] in pixels. Pass [] for a solid stroke."
    ),
  strokeCap: z
    .enum(["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"])
    .optional()
    .describe("End-cap style (only meaningful on open paths/lines)"),
  strokeJoin: z
    .enum(["MITER", "BEVEL", "ROUND"])
    .optional()
    .describe("Corner join style"),
  fileKey: fileKeyField,
});

export const setAutoLayoutInput = z.object({
  nodeId: createFigmaNodeIdSchema().describe(
    "The node ID to update (must be a frame)"
  ),
  layoutMode: z
    .enum(["NONE", "HORIZONTAL", "VERTICAL"])
    .optional()
    .describe("Auto-layout direction. 'NONE' disables auto-layout."),
  itemSpacing: z
    .number()
    .optional()
    .describe("Gap between children along the primary axis (pixels)"),
  counterAxisSpacing: z
    .number()
    .optional()
    .describe("Gap between wrapped rows/columns (only when layoutWrap=WRAP)"),
  paddingTop: z.number().min(0).optional(),
  paddingRight: z.number().min(0).optional(),
  paddingBottom: z.number().min(0).optional(),
  paddingLeft: z.number().min(0).optional(),
  primaryAxisAlignItems: z
    .enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"])
    .optional()
    .describe("Alignment along the primary axis"),
  counterAxisAlignItems: z
    .enum(["MIN", "MAX", "CENTER", "BASELINE"])
    .optional()
    .describe("Alignment along the counter axis"),
  primaryAxisSizingMode: z
    .enum(["FIXED", "AUTO"])
    .optional()
    .describe("AUTO = hug contents along primary axis"),
  counterAxisSizingMode: z
    .enum(["FIXED", "AUTO"])
    .optional()
    .describe("AUTO = hug contents along counter axis"),
  layoutWrap: z
    .enum(["NO_WRAP", "WRAP"])
    .optional()
    .describe("Allow children to wrap onto multiple rows/columns"),
  fileKey: fileKeyField,
});

export const createFrameInput = z.object({
  name: z.string().optional().describe("Optional frame name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the frame into"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Frame width"),
  height: z.number().positive().optional().describe("Frame height"),
  fillHex: createHexColorSchema()
    .optional()
    .describe("Optional solid fill color as hex"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional solid fill opacity from 0 to 1"),
  fileKey: fileKeyField,
});

export const setTextPropertiesShape = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The text node ID to update"),
  fontFamily: z.string().optional().describe("Optional font family"),
  fontStyle: z.string().optional().describe("Optional font style"),
  fontSize: z.number().positive().optional().describe("Optional font size"),
  textAlignHorizontal: textAlignHorizontal
    .optional()
    .describe("Optional horizontal alignment"),
  textAlignVertical: textAlignVertical
    .optional()
    .describe("Optional vertical alignment"),
  textAutoResize: textAutoResize
    .optional()
    .describe("Optional text auto-resize mode"),
  lineHeightPx: z
    .number()
    .positive()
    .optional()
    .describe("Optional line height in pixels"),
  letterSpacingPx: z
    .number()
    .optional()
    .describe("Optional letter spacing in pixels"),
  fillHex: createHexColorSchema()
    .optional()
    .describe("Optional text fill color as hex"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional text fill opacity from 0 to 1"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  fileKey: fileKeyField,
});

export const setTextPropertiesInput = setTextPropertiesShape
  .refine(
    (value) =>
      value.fontFamily !== undefined ||
      value.fontStyle !== undefined ||
      value.fontSize !== undefined ||
      value.textAlignHorizontal !== undefined ||
      value.textAlignVertical !== undefined ||
      value.textAutoResize !== undefined ||
      value.lineHeightPx !== undefined ||
      value.letterSpacingPx !== undefined ||
      value.fillHex !== undefined ||
      value.fillOpacity !== undefined ||
      value.x !== undefined ||
      value.y !== undefined ||
      value.width !== undefined ||
      value.height !== undefined,
    "At least one text property must be provided"
  )
  .refine(
    (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
    "fillHex is required when fillOpacity is provided"
  );

export const createTextShape = z.object({
  name: z.string().optional().describe("Optional text node name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the text into"),
  characters: z.string().optional().describe("Initial text content"),
  fontFamily: z.string().optional().describe("Font family, defaults to Inter"),
  fontStyle: z.string().optional().describe("Font style, defaults to Regular"),
  fontSize: z.number().positive().optional().describe("Optional font size"),
  textAlignHorizontal: textAlignHorizontal
    .optional()
    .describe("Optional horizontal alignment"),
  textAutoResize: textAutoResize
    .optional()
    .describe("Optional text auto-resize mode"),
  fillHex: createHexColorSchema()
    .optional()
    .describe("Optional text fill color as hex"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional text fill opacity from 0 to 1"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  fileKey: fileKeyField,
});

export const createTextInput = createTextShape.refine(
  (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
  "fillHex is required when fillOpacity is provided"
);

export const createShapeShape = z.object({
  shapeType: shapeType.describe("Shape type to create"),
  name: z.string().optional().describe("Optional shape name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the shape into"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  rotation: z.number().optional().describe("Optional rotation in degrees"),
  cornerRadius: z
    .number()
    .min(0)
    .optional()
    .describe("Optional corner radius for supported shapes"),
  fillHex: createHexColorSchema()
    .optional()
    .describe("Optional fill color as hex"),
  fillOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional fill opacity from 0 to 1"),
  strokeHex: createHexColorSchema()
    .optional()
    .describe("Optional stroke color as hex"),
  strokeOpacity: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Optional stroke opacity from 0 to 1"),
  strokeWeight: z
    .number()
    .positive()
    .optional()
    .describe("Optional stroke weight"),
  fileKey: fileKeyField,
});

export const createShapeInput = createShapeShape
  .refine(
    (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
    "fillHex is required when fillOpacity is provided"
  )
  .refine(
    (value) =>
      value.strokeOpacity === undefined || value.strokeHex !== undefined,
    "strokeHex is required when strokeOpacity is provided"
  )
  .refine(
    (value) => value.shapeType !== "LINE" || value.fillHex === undefined,
    "LINE shapes do not support fillHex — use strokeHex instead"
  )
  .refine(
    (value) => value.shapeType !== "LINE" || value.strokeHex !== undefined,
    "LINE shapes require strokeHex (lines have no fill and would be invisible otherwise)"
  );

export const createImageInput = z.object({
  source: z
    .string()
    .min(1)
    .describe(
      "Image source. Accepts a local file path (absolute or relative to the MCP server cwd), an http/https URL, or a data URI."
    ),
  name: z.string().optional().describe("Optional image node name"),
  parentId: createFigmaNodeIdSchema()
    .optional()
    .describe("Optional parent node ID to append the image into"),
  x: z.number().optional().describe("Optional x position"),
  y: z.number().optional().describe("Optional y position"),
  width: z.number().positive().optional().describe("Optional width"),
  height: z.number().positive().optional().describe("Optional height"),
  cornerRadius: z.number().min(0).optional().describe("Optional corner radius"),
  scaleMode: imageScaleMode
    .optional()
    .describe("How the image should fit its bounds: FILL (default) or FIT"),
  fileKey: fileKeyField,
});

export const toolInputSchemas = {
  get_document: z.object({
    fileKey: fileKeyField,
  }),

  get_selection: z.object({
    fileKey: fileKeyField,
  }),

  get_node: z.object({
    nodeId: createFigmaNodeIdSchema().describe(
      "The node ID to fetch. Accepts top-level IDs like '4029:12345' and instance-child IDs like 'I12740:17806;12740:17793'."
    ),
    fileKey: fileKeyField,
  }),

  get_styles: z.object({
    fileKey: fileKeyField,
  }),

  get_metadata: z.object({
    fileKey: fileKeyField,
  }),

  get_design_context: z.object({
    depth: z
      .number()
      .optional()
      .describe("How many levels deep to traverse the node tree (default 2)"),
    fileKey: fileKeyField,
  }),

  get_variable_defs: z.object({
    fileKey: fileKeyField,
  }),

  get_screenshot: z.object({
    nodeIds: z
      .array(createFigmaNodeIdSchema())
      .optional()
      .describe(
        "Optional list of node IDs to export. Accepts top-level IDs like '4029:12345' and instance-child IDs like 'I12740:17806;12740:17793'. Never use hyphens. If empty, exports the current selection."
      ),
    format: createExportFormatSchema()
      .optional()
      .describe("Export format: PNG (default) or SVG or JPG or PDF"),
    scale: z
      .number()
      .optional()
      .describe("Export scale for raster formats (default 2)"),
    clip: z
      .boolean()
      .optional()
      .describe(
        "When true, export using Figma's absolute node bounds (REST use_absolute_bounds / plugin useAbsoluteBounds) so PNGs are clipped to the node's logical bounds"
      ),
    fileKey: fileKeyField,
  }),

  set_node_visibility: z.object({
    items: z
      .array(
        z.object({
          nodeId: createFigmaNodeIdSchema().describe("The node ID to modify"),
          visible: z.boolean().describe("true to show, false to hide"),
        })
      )
      .min(1)
      .describe("List of nodes with their target visibility"),
    fileKey: fileKeyField,
  }),

  set_text_content: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The text node ID to update"),
    text: z.string().describe("The new text content"),
    fileKey: fileKeyField,
  }),

  set_text_properties: setTextPropertiesInput,

  set_gradient_fill: setGradientFillInput,

  set_solid_fill: setSolidFillInput,

  set_effects: setEffectsInput,

  set_stroke_properties: setStrokePropertiesInput.refine(
    (value) =>
      value.strokeWeight !== undefined ||
      value.strokeAlign !== undefined ||
      value.dashPattern !== undefined ||
      value.strokeCap !== undefined ||
      value.strokeJoin !== undefined,
    "At least one stroke property must be provided"
  ),

  set_auto_layout: setAutoLayoutInput.refine(
    (value) =>
      value.layoutMode !== undefined ||
      value.itemSpacing !== undefined ||
      value.counterAxisSpacing !== undefined ||
      value.paddingTop !== undefined ||
      value.paddingRight !== undefined ||
      value.paddingBottom !== undefined ||
      value.paddingLeft !== undefined ||
      value.primaryAxisAlignItems !== undefined ||
      value.counterAxisAlignItems !== undefined ||
      value.primaryAxisSizingMode !== undefined ||
      value.counterAxisSizingMode !== undefined ||
      value.layoutWrap !== undefined,
    "At least one auto-layout property must be provided"
  ),

  set_node_properties: setNodePropertiesInput.refine(
    (value) =>
      value.name !== undefined ||
      value.x !== undefined ||
      value.y !== undefined ||
      value.width !== undefined ||
      value.height !== undefined ||
      value.rotation !== undefined ||
      value.opacity !== undefined ||
      value.visible !== undefined ||
      value.cornerRadius !== undefined,
    "At least one property must be provided"
  ),

  create_frame: createFrameInput.refine(
    (value) => value.fillOpacity === undefined || value.fillHex !== undefined,
    "fillHex is required when fillOpacity is provided"
  ),

  create_text: createTextInput,

  create_shape: createShapeInput,

  create_image: createImageInput,

  duplicate_nodes: z.object({
    nodeIds: z
      .array(createFigmaNodeIdSchema())
      .min(1)
      .describe("List of node IDs to duplicate"),
    fileKey: fileKeyField,
  }),

  reparent_nodes: z.object({
    nodeIds: z
      .array(createFigmaNodeIdSchema())
      .min(1)
      .describe("List of node IDs to move"),
    parentId: createFigmaNodeIdSchema().describe("Destination parent node ID"),
    fileKey: fileKeyField,
  }),

  group_nodes: groupNodesInput,

  ungroup_node: ungroupNodeInput,

  set_selection: setSelectionInput,

  scroll_and_zoom_into_view: scrollAndZoomIntoViewInput,

  delete_nodes: z.object({
    nodeIds: z
      .array(createFigmaNodeIdSchema())
      .min(1)
      .describe("List of node IDs to delete"),
    confirm: z.boolean().describe("Must be true to confirm deletion"),
    fileKey: fileKeyField,
  }),

  save_screenshots: z.object({
    items: z
      .array(
        z.object({
          nodeId: createFigmaNodeIdSchema().describe(
            "The node ID to export. Accepts top-level IDs like '4029:12345' and instance-child IDs like 'I12740:17806;12740:17793'."
          ),
          outputPath: z
            .string()
            .min(1)
            .describe(
              "Output file path (relative paths resolve from the MCP server current working directory)"
            ),
          format: createExportFormatSchema()
            .optional()
            .describe("Per-item export format override: PNG, SVG, JPG, or PDF"),
          scale: z
            .number()
            .optional()
            .describe("Per-item export scale override for raster formats"),
          clip: z
            .boolean()
            .optional()
            .describe(
              "Per-item clipping override. When true, PNGs are clipped to the node's logical bounds using Figma's absolute node bounds."
            ),
        })
      )
      .min(1)
      .describe("List of screenshot save operations to execute in batch"),
    format: createExportFormatSchema()
      .optional()
      .describe("Default export format: PNG (default) or SVG or JPG or PDF"),
    scale: z
      .number()
      .optional()
      .describe("Default export scale for raster formats (default 2)"),
    clip: z
      .boolean()
      .optional()
      .describe(
        "Default clipping behavior for saved screenshots. When true, PNGs are clipped to the node's logical bounds using Figma's absolute node bounds."
      ),
    fileKey: fileKeyField,
  }),

  get_motion_styles: z.object({
    fileKey: fileKeyField,
  }),

  get_node_motion: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to fetch motion properties for"),
    fileKey: fileKeyField,
  }),

  apply_animation_style: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to apply the style to"),
    styleId: z.string().describe("The ID of the animation style to apply"),
    animationStyleData: z.record(z.unknown()).optional().describe("Optional values used to configure the applied animation style (e.g. duration, timelineOffset, axis, direction)"),
    fileKey: fileKeyField,
  }),

  remove_animation_style: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to remove the style from"),
    animationStyleId: z.string().optional().describe("The ID of the animation style to remove. If omitted, all animation styles are removed."),
    fileKey: fileKeyField,
  }),

  apply_manual_keyframe_track: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to apply the track to"),
    field: z.record(z.unknown()).describe("The property, paint, or effect field to animate. Example: { type: 'PROPERTY', name: 'TRANSLATION_X' }"),
    track: z.record(z.unknown()).describe("The manual keyframe track to write. Contains keyframes, baseValue, etc."),
    fileKey: fileKeyField,
  }),

  remove_manual_keyframe_track: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID to remove the track from"),
    field: z.record(z.unknown()).describe("The property, paint, or effect field to remove. Example: { type: 'PROPERTY', name: 'TRANSLATION_X' }"),
    fileKey: fileKeyField,
  }),

  set_timeline_duration: z.object({
    nodeId: createFigmaNodeIdSchema().describe("The node ID whose timeline duration will be changed"),
    timelineId: z.string().describe("A timeline id read from the node's timelines array"),
    duration: z.number().positive().describe("The new timeline duration in seconds (must be greater than zero)"),
    fileKey: fileKeyField,
  }),
} as const;

type ToolName = keyof typeof toolInputSchemas;

/**
 * Maps the RPC wire format { tool, nodeIds?, params? } to each tool's
 * expected input shape. Typed as Record<ToolName, ...> so adding a schema
 * without a mapper is a compile error.
 */
const rpcToArgs: Record<
  ToolName,
  (nodeIds?: string[], params?: Record<string, unknown>) => unknown
> = {
  get_document: (_nodeIds, params) => ({ ...params }),
  get_selection: (_nodeIds, params) => ({ ...params }),
  get_node: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  get_styles: (_nodeIds, params) => ({ ...params }),
  get_metadata: (_nodeIds, params) => ({ ...params }),
  get_design_context: (_nodeIds, params) => ({ ...params }),
  get_variable_defs: (_nodeIds, params) => ({ ...params }),
  get_screenshot: (nodeIds, params) => ({ nodeIds, ...params }),
  set_node_visibility: (_nodeIds, params) => ({ ...params }),
  set_text_content: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_text_properties: (nodeIds, params) => ({
    ...params,
    nodeId: nodeIds?.[0],
  }),
  set_node_properties: (nodeIds, params) => ({
    ...params,
    nodeId: nodeIds?.[0],
  }),
  set_gradient_fill: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_solid_fill: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_effects: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_stroke_properties: (nodeIds, params) => ({
    ...params,
    nodeId: nodeIds?.[0],
  }),
  set_auto_layout: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  create_frame: (_nodeIds, params) => ({ ...params }),
  create_text: (_nodeIds, params) => ({ ...params }),
  create_shape: (_nodeIds, params) => ({ ...params }),
  create_image: (_nodeIds, params) => ({ ...params }),
  duplicate_nodes: (nodeIds, params) => ({ nodeIds, ...params }),
  reparent_nodes: (nodeIds, params) => ({ nodeIds, ...params }),
  group_nodes: (nodeIds, params) => ({ nodeIds, ...params }),
  ungroup_node: (nodeIds, params) => ({ nodeId: nodeIds?.[0], ...params }),
  set_selection: (nodeIds, params) => ({ nodeIds, ...params }),
  scroll_and_zoom_into_view: (nodeIds, params) => ({ nodeIds, ...params }),
  delete_nodes: (nodeIds, params) => ({ nodeIds, ...params }),
  save_screenshots: (_nodeIds, params) => ({ ...params }),
  get_motion_styles: (_nodeIds, params) => ({ ...params }),
  get_node_motion: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  apply_animation_style: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  remove_animation_style: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  apply_manual_keyframe_track: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  remove_manual_keyframe_track: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
  set_timeline_duration: (nodeIds, params) => ({ ...params, nodeId: nodeIds?.[0] }),
};

/**
 * Validate an RPC request against the corresponding tool's input schema.
 * Returns an error string on failure, null if valid or no schema exists for the tool.
 */
export function validateRpc(
  tool: string,
  nodeIds?: string[],
  params?: Record<string, unknown>
): string | null {
  if (!(tool in toolInputSchemas)) return null;

  const name = tool as ToolName;
  const result = toolInputSchemas[name].safeParse(
    rpcToArgs[name](nodeIds, params)
  );
  return result.success ? null : result.error.issues[0].message;
}
