import type { z } from "zod";
import type { BridgeResponse } from "./types.js";

/**
 * Helpers shared by `tools.ts` and the tool registrations under `extensions/`.
 * Kept in their own module so an extension file never has to import
 * `tools.ts`, which would close an import cycle through `registerTools`.
 */

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Wraps a bridge call and converts the result into a tool result.
 * @param fn - Bridge call to execute.
 * @returns Tool result with the bridge response or an error message.
 */
export async function renderResponse(fn: () => Promise<BridgeResponse>): Promise<ToolResult> {
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
export function parseToolInput<T>(
  // Input type is left open so transforming schemas (whose output differs from
  // their input, e.g. the alias-normalising set_* inputs) can be passed in.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
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
