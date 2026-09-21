import type { ExtensionHandler } from "./types";
import { variablesHandlers } from "./variables";

export type { ExtensionHandler, ExtensionHandlerMap, ExtensionRequest } from "./types";

/**
 * Every extension tool, merged from the area maps. `handleRequest` dispatches
 * through this before its own switch.
 *
 * Declared without a type annotation so the key literals survive; annotating it
 * as Record<string, ExtensionHandler> would widen `ExtensionRequestType` to
 * `string` and stop the server's tool names from being checked against it.
 */
export const extensionHandlers = {
  ...variablesHandlers,
};

/** Union of the extension tool names, for the RequestType union in `code.ts`. */
export type ExtensionRequestType = keyof typeof extensionHandlers;

/**
 * Looks a request type up in the merged map.
 * @param type - The incoming request type.
 * @returns The handler, or undefined when the type is not an extension tool.
 */
export const getExtensionHandler = (type: string): ExtensionHandler | undefined =>
  (extensionHandlers as Record<string, ExtensionHandler>)[type];
