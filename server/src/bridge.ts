import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { BridgeRequest, BridgeResponse, ConnectedFile } from "./types.js";

interface PendingRequest {
  resolve: (resp: BridgeResponse) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  ws: WebSocket;
}

interface ConnectionEntry {
  ws: WebSocket;
  fileKey: string;
  fileName: string;
  isAlive: boolean;
}

export class Bridge {
  private wss: WebSocketServer;
  private connections = new Map<string, ConnectionEntry>();
  private pending = new Map<string, PendingRequest>();
  /**
   * Per-file Figma REST tokens pushed by the plugin UI (`set_access_token`).
   * Used for server-side calls the plugin sandbox cannot make (comments).
   * Never logged — treat as secrets.
   */
  private fileTokens = new Map<string, string>();
  private counter = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("error", (err) => {
      console.error("WebSocketServer error:", err);
    });

    this.pingTimer = setInterval(() => {
      for (const [fileKey, entry] of this.connections) {
        if (!entry.isAlive) {
          entry.ws.terminate();
          this.connections.delete(fileKey);
          console.error(`Plugin dead (no pong): ${entry.fileName} (${fileKey})`);
          continue;
        }
        entry.isAlive = false;
        entry.ws.ping();
      }
    }, 30_000);
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (request.url == undefined) {
      console.error("Plugin connected without url, rejecting");
      socket.destroy();
      return;
    }

    const url = new URL(request.url, "http://localhost");
    const { fileKey, fileName = "Unknown" } = Object.fromEntries(url.searchParams);

    if (!fileKey) {
      console.error("Plugin connected without fileKey, rejecting");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.handleConnection(ws, fileKey, fileName);
    });
  }

  private handleConnection(ws: WebSocket, fileKey: string, fileName: string): void {
    // Replace existing connection for the same file
    const existing = this.connections.get(fileKey);
    if (existing) {
      existing.ws.close();
    }
    this.connections.set(fileKey, {
      ws,
      fileKey,
      fileName,
      isAlive: true,
    });
    console.error(`Plugin connected: ${fileName} (${fileKey})`);

    ws.on("pong", () => {
      const entry = this.connections.get(fileKey);
      if (entry && entry.ws === ws) entry.isAlive = true;
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as BridgeResponse & {
          token?: unknown;
        };
        // Plugin-initiated notification (no requestId): store/clear the
        // per-file REST token for server-side calls (comments).
        if (msg.type === "set_access_token") {
          if (typeof msg.token === "string" && msg.token.trim().length > 0) {
            this.fileTokens.set(fileKey, msg.token.trim());
          } else {
            this.fileTokens.delete(fileKey);
          }
          return;
        }
        const pending = this.pending.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(msg.requestId);
          pending.resolve(msg);
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
      this.rejectPendingForSocket(ws, `Plugin disconnected: ${fileName} (${fileKey})`);
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
      const current = this.connections.get(fileKey);
      if (current?.ws === ws) {
        this.connections.delete(fileKey);
      }
      this.rejectPendingForSocket(ws, `Plugin connection error (${fileName}): ${err.message}`);
    });
  }

  private rejectPendingForSocket(ws: WebSocket, reason: string): void {
    for (const [id, p] of this.pending) {
      if (p.ws === ws) {
        clearTimeout(p.timeout);
        this.pending.delete(id);
        p.reject(new Error(reason));
      }
    }
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
      throw new Error("No plugin connected. Open a Figma file and run the bridge plugin.");
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

  /**
   * Returns the REST token pushed by the plugin UI for a file, if any.
   * @param fileKey - File key the token was stored under.
   * @returns The stored token, or undefined when none was provided.
   */
  getFileToken(fileKey: string): string | undefined {
    return this.fileTokens.get(fileKey);
  }

  send(requestType: string, nodeIds?: string[], fileKey?: string): Promise<BridgeResponse> {
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
        reject(new Error("Request timed out (3 minutes)"));
      }, 180_000);

      this.pending.set(requestId, { resolve, reject, timeout, ws: conn });

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
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

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
