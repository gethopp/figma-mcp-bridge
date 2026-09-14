import type { BridgeResponse } from "../types.js";

/** Anything that can forward a request to the Figma plugin: the leader bridge, a follower or a Node. */
export interface BridgeSender {
  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    fileKey?: string
  ): Promise<BridgeResponse>;
}

/**
 * Errors worth retrying: Figma gives up loading page or variable data after ~10 s ("Unable to establish
 * connection to Figma"), and the plugin's WebSocket can drop and reconnect mid-export.
 */
const RETRYABLE =
  /Unable to establish connection|timed out|not connected|disconnected|ECONNREFUSED|fetch failed|No plugin connected/i;

export interface RequestOptions {
  nodeIds?: string[];
  params?: Record<string, unknown>;
  fileKey?: string;
  /** Retries after the first attempt (default 4). */
  retries?: number;
  /** Base backoff delay, doubled per attempt (default 1000 ms). */
  retryDelayMs?: number;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Sends one request to the plugin, retrying transient failures, and returns its data or throws. */
export async function request<T>(
  sender: BridgeSender,
  type: string,
  options: RequestOptions = {}
): Promise<T> {
  const retries = options.retries ?? 4;
  const delay = options.retryDelayMs ?? 1000;
  for (let attempt = 0; ; attempt++) {
    let message: string;
    try {
      const response = await sender.sendWithParams(
        type,
        options.nodeIds,
        options.params,
        options.fileKey
      );
      if (!response.error) return response.data as T;
      message = response.error;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    if (attempt >= retries || !RETRYABLE.test(message)) {
      const target = options.nodeIds?.length ? ` ${options.nodeIds.join(",")}` : "";
      throw new Error(`${type}${target}: ${message}`);
    }
    await sleep(delay * 2 ** attempt);
  }
}
