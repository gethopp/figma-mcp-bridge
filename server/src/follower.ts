import type { BridgeResponse, ConnectedFile, RPCRequest, RPCResponse } from "./types.js";

/**
 * Follower proxies MCP tool calls to the leader via HTTP /rpc.
 */
export class Follower {
  constructor(private leaderUrl: string) {}

  send(
    requestType: string,
    nodeIds?: string[],
    fileKey?: string
  ): Promise<BridgeResponse> {
    return this.sendWithParams(requestType, nodeIds, undefined, fileKey);
  }

  async sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    fileKey?: string
  ): Promise<BridgeResponse> {
    const rpcReq: RPCRequest = { tool: requestType };
    if (nodeIds && nodeIds.length > 0) rpcReq.nodeIds = nodeIds;
    if (params && Object.keys(params).length > 0) rpcReq.params = params;
    if (fileKey) rpcReq.fileKey = fileKey;

    const response = await fetch(`${this.leaderUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcReq),
      signal: AbortSignal.timeout(35_000),
    });

    if (!response.ok) {
      throw new Error(`Leader returned status ${response.status}`);
    }

    const rpcResp = (await response.json()) as RPCResponse;

    if (rpcResp.error) {
      throw new Error(rpcResp.error);
    }

    return {
      type: requestType,
      requestId: "",
      data: rpcResp.data,
    };
  }

  async listConnectedFiles(): Promise<ConnectedFile[]> {
    const response = await fetch(`${this.leaderUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "list_files" } as RPCRequest),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`Leader returned status ${response.status}`);
    }

    const rpcResp = (await response.json()) as RPCResponse;
    if (rpcResp.error) {
      throw new Error(rpcResp.error);
    }

    return (rpcResp.data as ConnectedFile[]) ?? [];
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.leaderUrl}/ping`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
