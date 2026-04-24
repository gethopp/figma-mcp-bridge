import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { BridgeRequest, BridgeResponse, ConnectedFile } from "./types.js";

interface PendingRequest {
  resolve: (resp: BridgeResponse) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ConnectionEntry {
  ws: WebSocket;
  fileKey: string;
  fileName: string;
}

export class Bridge {
  private wss: WebSocketServer;
  private connections = new Map<string, ConnectionEntry>();
  private pending = new Map<string, PendingRequest>();
  private counter = 0;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (request.url == undefined) {
      console.error("Plugin connected without url, rejecting");
      socket.destroy();
      return;
    }

    const url = new URL(request.url, "http://localhost");
    const { fileKey, fileName = "Unknown" } = Object.fromEntries(
      url.searchParams
    );

    if (!fileKey) {
      console.error("Plugin connected without fileKey, rejecting");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.handleConnection(ws, fileKey, fileName);
    });
  }

  private handleConnection(
    ws: WebSocket,
    fileKey: string,
    fileName: string
  ): void {
    // Replace existing connection for the same file
    const existing = this.connections.get(fileKey);
    if (existing) {
      existing.ws.close();
    }
    this.connections.set(fileKey, { ws, fileKey, fileName });
    console.error(`Plugin connected: ${fileName} (${fileKey})`);

    ws.on("message", (data) => {
      try {
        const resp: BridgeResponse = JSON.parse(data.toString());
        const pending = this.pending.get(resp.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(resp.requestId);
          pending.resolve(resp);
        }
      } catch {
        console.error("Invalid response from plugin");
      }
    });

    ws.on("close", () => {
      const current = this.connections.get(fileKey);
      if (current?.ws === ws) {
        this.connections.delete(fileKey);
        console.error(`Plugin disconnected: ${fileName} (${fileKey})`);
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
      const current = this.connections.get(fileKey);
      if (current?.ws === ws) {
        this.connections.delete(fileKey);
      }
    });
  }

  /**
   * Resolve which connection to use.
   * - If fileKey is provided, use that specific connection.
   * - If only one file is connected and no fileKey given, use it (backward compat).
   * - If multiple files connected and no fileKey, throw with a helpful message.
   */
  private resolveConnection(fileKey?: string): WebSocket {
    if (fileKey) {
      const entry = this.connections.get(fileKey);
      if (!entry) {
        const available = this.listConnectedFiles();
        const hint =
          available.length > 0
            ? ` Connected files: ${available.map((f) => `"${f.fileName}" (fileKey: ${f.fileKey})`).join(", ")}`
            : " No files are currently connected.";
        throw new Error(`No plugin connected for fileKey "${fileKey}".${hint}`);
      }
      return entry.ws;
    }

    if (this.connections.size === 0) {
      throw new Error(
        "No plugin connected. Open a Figma file and run the bridge plugin."
      );
    }

    if (this.connections.size === 1) {
      const entry = this.connections.values().next().value!;
      return entry.ws;
    }

    const files = this.listConnectedFiles();
    throw new Error(
      `Multiple files connected. Specify a fileKey to choose which file to query. Connected files: ${files.map((f) => `"${f.fileName}" (fileKey: ${f.fileKey})`).join(", ")}. Use the list_files tool to see all connected files.`
    );
  }

  listConnectedFiles(): ConnectedFile[] {
    return [...this.connections.values()].map((entry) => ({
      fileKey: entry.fileKey,
      fileName: entry.fileName,
    }));
  }

  send(
    requestType: string,
    nodeIds?: string[],
    fileKey?: string
  ): Promise<BridgeResponse> {
    return this.sendWithParams(requestType, nodeIds, undefined, fileKey);
  }

  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    fileKey?: string
  ): Promise<BridgeResponse> {
    return new Promise((resolve, reject) => {
      let conn: WebSocket;
      try {
        conn = this.resolveConnection(fileKey);
      } catch (err) {
        reject(err);
        return;
      }

      if (conn.readyState !== WebSocket.OPEN) {
        reject(new Error("Plugin not connected"));
        return;
      }

      const requestId = this.nextId();
      const request: BridgeRequest = {
        type: requestType,
        requestId,
      };
      if (nodeIds && nodeIds.length > 0) {
        request.nodeIds = nodeIds;
      }
      if (params && Object.keys(params).length > 0) {
        request.params = params;
      }

      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Request timed out"));
      }, 30_000);

      this.pending.set(requestId, { resolve, reject, timeout });

      conn.send(JSON.stringify(request), (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pending.delete(requestId);
          reject(err);
        }
      });
    });
  }

  private nextId(): string {
    this.counter++;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    return `req-${hh}${mm}${ss}-${this.counter}`;
  }

  close(): void {
    // Reject all pending requests
    for (const [id, { reject, timeout }] of this.pending) {
      clearTimeout(timeout);
      reject(new Error("Bridge closed"));
    }
    this.pending.clear();

    for (const [, entry] of this.connections) {
      entry.ws.close();
    }
    this.connections.clear();
    this.wss.close();
  }
}
