import type { ExtensionHandler } from "./types";

/**
 * Variable and variable-collection tools.
 *
 * Add a tool by adding one entry here. Set `edit` to true when the handler
 * writes to the file.
 */
export const variablesHandlers = {} satisfies Record<string, ExtensionHandler>;
