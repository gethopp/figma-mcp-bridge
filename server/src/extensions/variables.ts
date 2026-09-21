import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Node } from "../node.js";
import { createFigmaNodeIdSchema, createVariableIdSchema, fileKeyField } from "../schema-common.js";
import { parseToolInput, renderResponse } from "../tool-helpers.js";
import type { ToolResult } from "../tool-helpers.js";
import type { ExtensionRpcMap, ExtensionSchemaMap } from "./types.js";

/**
 * Variable and variable-collection tools.
 *
 * Import only from `schema-common.js`, `tool-helpers.js`, packages, and types.
 * Importing `schema.js` or `tools.js` here would close an import cycle.
 */

/**
 * Creates a Zod schema that validates a variable collection ID.
 * @returns A Zod string schema for collection IDs.
 */
const createCollectionIdSchema = () =>
  z
    .string()
    .regex(
      /^VariableCollectionId:.+$/,
      "Collection ID must start with 'VariableCollectionId:' — use an ID from get_variable_defs"
    );

const collectionIdField = createCollectionIdSchema().describe(
  "The variable collection ID, as reported by get_variable_defs"
);

const variableTypeField = z
  .enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"])
  .describe("Resolved type of the variable");

const variableScopeField = z.enum([
  "ALL_SCOPES",
  "ALL_FILLS",
  "FRAME_FILL",
  "SHAPE_FILL",
  "TEXT_FILL",
  "STROKE_COLOR",
  "EFFECT_COLOR",
  "TEXT_CONTENT",
  "CORNER_RADIUS",
  "WIDTH_HEIGHT",
  "GAP",
  "OPACITY",
  "STROKE_FLOAT",
  "EFFECT_FLOAT",
  "FONT_WEIGHT",
  "FONT_SIZE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
  "PARAGRAPH_SPACING",
  "PARAGRAPH_INDENT",
  "FONT_FAMILY",
  "FONT_STYLE",
]);

/**
 * A variable value, or an alias to another variable.
 *
 * Deliberately loose: a union reports only "Invalid input" when every branch
 * fails, which would bury the reason. The plugin checks the value against the
 * type of the item and answers with the cause and the correction instead.
 */
const variableValueField = z
  .union([
    z.string(),
    z.number(),
    z.boolean(),
    z.object({
      aliasId: z
        .string()
        .min(1)
        .optional()
        .describe("ID of the variable to alias, e.g. 'VariableID:1:2'"),
      aliasName: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Name of the variable to alias. Resolved against this batch first, then the target collection, then the other local collections."
        ),
    }),
  ])
  .describe(
    "COLOR: a hex string '#RGB', '#RRGGBB', or '#RRGGBBAA'. FLOAT: a number. STRING: a string. BOOLEAN: true or false. Any type may instead take an alias object with exactly one of aliasId or aliasName."
  );

const createVariableItem = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      "Variable name. A '/' makes a group, e.g. 'color/brand'. Must not exist in the collection already and must be unique within this call."
    ),
  type: variableTypeField,
  value: variableValueField,
  scopes: z
    .array(variableScopeField)
    .min(1)
    .optional()
    .describe(
      "Where Figma offers the variable. Must suit the type: fill and stroke scopes for COLOR, size and spacing scopes for FLOAT, font name scopes for STRING, ALL_SCOPES for BOOLEAN. ALL_SCOPES must stand alone, and ALL_FILLS must not be combined with FRAME_FILL, SHAPE_FILL, or TEXT_FILL."
    ),
  description: z.string().optional().describe("Optional description, shown in Figma"),
});

const variableIdField = createVariableIdSchema().describe(
  "The variable to change, as reported by get_variable_defs"
);

const updateVariableItem = z
  .object({
    variableId: variableIdField,
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        "A new name. Must not already exist in the collection of this variable, and must be unique within this call."
      ),
    value: variableValueField.optional(),
    scopes: z
      .array(variableScopeField)
      .min(1)
      .optional()
      .describe("Replaces the current scopes. Must suit the type the variable already has."),
    description: z.string().optional().describe("Replaces the current description"),
  })
  .refine(
    (item) =>
      item.name !== undefined ||
      item.value !== undefined ||
      item.scopes !== undefined ||
      item.description !== undefined,
    "Each update needs at least one of name, value, scopes, or description"
  );

const bindableField = z
  .enum([
    "fills",
    "strokes",
    "visible",
    "characters",
    "fontFamily",
    "fontStyle",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "paragraphSpacing",
    "paragraphIndent",
    "width",
    "height",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "opacity",
    "cornerRadius",
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
    "strokeWeight",
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
    "itemSpacing",
    "counterAxisSpacing",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom",
    "gridRowGap",
    "gridColumnGap",
  ])
  .describe(
    "The field to bind. COLOR variables take fills and strokes, BOOLEAN takes visible, STRING takes characters, fontFamily, and fontStyle, and FLOAT takes every other field."
  );

const bindingItem = z.object({
  nodeId: createFigmaNodeIdSchema().describe("The node to bind on"),
  field: bindableField,
  variableId: createVariableIdSchema()
    .nullable()
    .describe("The variable to bind, or null to remove the binding from this field"),
  paintIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Which paint of fills or strokes to bind, defaulting to 0. That paint must be SOLID. Leave it out for every other field."
    ),
});

/** Tool name to Zod object schema. Spread into `toolInputSchemas`. */
export const schemas = {
  create_variable_collection: z.object({
    name: z.string().min(1).describe("Name of the new collection"),
    fileKey: fileKeyField,
  }),

  update_variable_collection: z.object({
    collectionId: collectionIdField,
    name: z.string().min(1).describe("The new collection name"),
    fileKey: fileKeyField,
  }),

  delete_variable_collection: z.object({
    collectionId: collectionIdField,
    confirm: z.boolean().describe("Must be true to confirm deletion"),
    fileKey: fileKeyField,
  }),

  create_variables: z.object({
    collectionId: collectionIdField,
    variables: z
      .array(createVariableItem)
      .min(1)
      .max(200)
      .describe("The variables to create, 1 to 200 per call"),
    fileKey: fileKeyField,
  }),

  update_variables: z.object({
    updates: z
      .array(updateVariableItem)
      .min(1)
      .max(200)
      .describe("The changes to apply, 1 to 200 per call"),
    fileKey: fileKeyField,
  }),

  delete_variables: z.object({
    variableIds: z
      .array(createVariableIdSchema())
      .min(1)
      .max(200)
      .describe("The variables to delete, 1 to 200 per call"),
    confirm: z.boolean().describe("Must be true to confirm deletion"),
    fileKey: fileKeyField,
  }),

  bind_variables: z.object({
    bindings: z
      .array(bindingItem)
      .min(1)
      .max(200)
      .describe("The bindings to apply, 1 to 200 per call"),
    fileKey: fileKeyField,
  }),
} satisfies ExtensionSchemaMap;

/** Tool name to RPC wire mapper. Spread into `rpcToArgs`. */
export const rpcToArgs = {
  create_variable_collection: (_nodeIds, params) => ({ ...params }),
  update_variable_collection: (_nodeIds, params) => ({ ...params }),
  delete_variable_collection: (_nodeIds, params) => ({ ...params }),
  create_variables: (_nodeIds, params) => ({ ...params }),
  update_variables: (_nodeIds, params) => ({ ...params }),
  delete_variables: (_nodeIds, params) => ({ ...params }),
  bind_variables: (_nodeIds, params) => ({ ...params }),
} satisfies ExtensionRpcMap;

/**
 * Registers this area's tools.
 * @param server - The MCP server instance.
 * @param node - The node coordinator for leader/follower routing.
 */
export function register(server: McpServer, node: Node): void {
  server.tool(
    "create_variable_collection",
    "Create a local variable collection to hold design tokens. Figma gives the new collection one mode and returns its defaultModeId; create_variables writes values to that mode. Adding further modes requires a paid Figma plan and is not supported. When multiple files are connected, specify fileKey.",
    schemas.create_variable_collection.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(schemas.create_variable_collection, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("create_variable_collection", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "update_variable_collection",
    "Rename a local variable collection. Nothing else about the collection changes. When multiple files are connected, specify fileKey.",
    schemas.update_variable_collection.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(schemas.update_variable_collection, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("update_variable_collection", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "delete_variable_collection",
    "Delete a local variable collection and every variable in it. This is destructive and requires confirm: true. Nodes bound to one of those variables keep their last resolved value. When multiple files are connected, specify fileKey.",
    schemas.delete_variable_collection.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(schemas.delete_variable_collection, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("delete_variable_collection", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "create_variables",
    "Create up to 200 variables in one collection and write their values to the default mode of that collection. A value is a hex color, a number, a string, a boolean, or an alias to another variable by ID or by name — an alias may point at a later item of the same call. Every item is checked before the first write: a batch with a bad item writes nothing and reports every item to correct. When multiple files are connected, specify fileKey.",
    schemas.create_variables.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(schemas.create_variables, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("create_variables", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "update_variables",
    "Change the name, value, scopes, or description of up to 200 existing variables. A value goes to the default mode of the variable's collection and must match the type the variable already has. It can be an alias to another variable by ID or by name; an aliasName resolves against the file as it stands, not against the renames in this call. Every item is checked before the first write: a batch with a bad item writes nothing and reports every item to correct. When multiple files are connected, specify fileKey.",
    schemas.update_variables.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(schemas.update_variables, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("update_variables", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "delete_variables",
    "Delete up to 200 local variables. This is destructive and requires confirm: true. Each result carries aliasedBy, the local variables that aliased the deleted one and now resolve to nothing, and nodes bound to a deleted variable keep their last resolved value. When multiple files are connected, specify fileKey.",
    schemas.delete_variables.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(schemas.delete_variables, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("delete_variables", undefined, params, fileKey)
      );
    }
  );

  server.tool(
    "bind_variables",
    "Bind variables to node fields, up to 200 per call, or pass variableId: null to remove a binding and leave the field at its last value. A COLOR variable binds into one SOLID paint of fills or strokes, chosen by paintIndex; every other field takes the variable directly. The node must support the field — itemSpacing needs an auto layout frame, for example — and the variable type must match it. Figma spreads a cornerRadius binding over the four corner radii and a strokeWeight binding over the four side weights, so get_node reports those fields rather than cornerRadius or strokeWeight; passing null for cornerRadius or strokeWeight removes the whole set again. On a text node get_node reports a text field such as fontSize as a list, one entry per styled range. Every item is checked before the first write: a batch with a bad item writes nothing and reports every item to correct. When multiple files are connected, specify fileKey.",
    schemas.bind_variables.shape,
    async (args): Promise<ToolResult> => {
      const parsed = parseToolInput(schemas.bind_variables, args);
      if (!parsed.success) return parsed.error;
      const { fileKey, ...params } = parsed.data;
      return renderResponse(() =>
        node.sendWithParams("bind_variables", undefined, params, fileKey)
      );
    }
  );
}
