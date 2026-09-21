import { z } from "zod";

/**
 * Field builders shared by `schema.ts` and the tool schemas under
 * `extensions/`. Kept in their own module so an extension file never has to
 * import `schema.ts`, which would close an import cycle through
 * `toolInputSchemas`.
 */

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
export const createFigmaNodeIdSchema = () =>
  z
    .string()
    .regex(
      /^(\d+:\d+|I\d+:\d+(;\d+:\d+)+)$/,
      "Node ID must use colon format, e.g. '4029:12345', or instance-child format 'I12740:17806;12740:17793'"
    );

/**
 * Creates a Zod schema that validates a CSS-style hex color string.
 * @returns A Zod string schema for hex colors.
 */
export const createHexColorSchema = () =>
  z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Color must be a hex value like '#FFAA00'");

/**
 * Creates a Zod schema that validates a variable ID.
 * @returns A Zod string schema for variable IDs.
 */
export const createVariableIdSchema = () =>
  z
    .string()
    .regex(
      /^VariableID:.+$/,
      "Variable ID must start with 'VariableID:' — use an ID from get_variable_defs"
    );

export const fileKeyField = z
  .string()
  .optional()
  .describe(
    "The fileKey of the Figma file to query. Required when multiple files are connected. Use list_files to see connected files."
  );
