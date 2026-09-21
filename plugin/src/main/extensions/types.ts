/**
 * Shape of a tool handler in an area map.
 *
 * `handleRequest` looks the request type up in the merged map before its own
 * switch, so an area file is the only place a new tool's plugin-side code has
 * to go.
 */
export type ExtensionRequest = {
  nodeIds?: string[];
  params: Record<string, unknown>;
};

export type ExtensionHandler = {
  /**
   * True when the handler writes to the file. `handleRequest` then rejects the
   * call in Dev Mode, which is read-only, before running it.
   */
  edit: boolean;
  run: (req: ExtensionRequest) => Promise<unknown>;
};

export type ExtensionHandlerMap = Record<string, ExtensionHandler>;
