import { randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { isInitializeRequest, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { Node } from "./node.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

type Session = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
};

/** Max concurrent remote MCP sessions; further initializes get a 503. */
const MAX_SESSIONS = 20;
/** Idle sessions older than this are closed on the next initialize. */
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface RemoteMcpServerOptions {
  host: string;
  port: number;
  mcpPath?: string;
  /**
   * Bridge (leader-election) port used for follower-to-leader RPC.
   * Must be the FIGMA_BRIDGE_PORT value, not this HTTP port — the comment
   * tools use it to reach the leader when this process is a follower.
   */
  bridgePort: number;
}

export class RemoteMcpServer {
  private readonly node: Node;
  private readonly host: string;
  private readonly port: number;
  private readonly bridgePort: number;
  private readonly mcpPath: string;
  private readonly sessions = new Map<string, Session>();
  /** Initializations in flight (reserved but not yet stored). */
  private pendingInitializations = 0;
  private server: http.Server | null = null;

  constructor(node: Node, options: RemoteMcpServerOptions) {
    this.node = node;
    this.host = options.host;
    this.port = options.port;
    this.bridgePort = options.bridgePort;
    this.mcpPath = options.mcpPath ?? "/mcp";
  }

  async start(): Promise<void> {
    if (this.server) return;

    const server = http.createServer((req, res) => {
      // Never leave a client hanging: end the response on unexpected errors.
      void this.handleRequest(req, res).catch((error) => {
        console.error("Remote MCP request error:", error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        } else {
          try {
            res.end();
          } catch {
            // Socket already gone — nothing left to do.
          }
        }
      });
    });

    server.on("error", (error) => {
      console.error("Remote MCP HTTP server error:", error);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.port, this.host);
    });

    this.server = server;
    console.error(`Remote MCP server listening on http://${this.host}:${this.port}${this.mcpPath}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;

    await Promise.allSettled(
      [...this.sessions.values()].map(async ({ server: mcpServer, transport }) => {
        await transport.close();
        await mcpServer.close();
      })
    );

    this.sessions.clear();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;

    if (req.method === "GET" && pathname === "/health") {
      this.sendJson(res, 200, {
        status: "ok",
        version: VERSION,
        mcp: this.mcpPath,
      });
      return;
    }

    if (pathname !== this.mcpPath) {
      this.sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (req.method === "DELETE") {
      await this.handleDelete(req, res);
      return;
    }

    if (req.method !== "POST" && req.method !== "GET") {
      res.writeHead(405, { Allow: "GET, POST, DELETE" });
      res.end("Method not allowed");
      return;
    }

    if (req.method === "GET") {
      await this.handleGet(req, res);
      return;
    }

    const body = await this.readJsonBody(req, res);
    if (body === undefined) return;

    const sessionId = this.getSessionId(req);
    let session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (!session) {
      if (!isInitializeRequest(body)) {
        this.sendJson(res, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: MCP session is not initialized",
          },
          id: null,
        });
        return;
      }

      this.evictExpiredSessions();
      if (this.sessions.size + this.pendingInitializations >= MAX_SESSIONS) {
        this.sendJson(res, 503, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Too many active sessions" },
          id: null,
        });
        return;
      }

      // Reserve the slot before the first await so a burst of concurrent
      // initializes cannot overshoot the cap.
      this.pendingInitializations++;
      try {
        session = this.createSession();
        await session.server.connect(session.transport);

        // Delete-only: closing the server here would recurse, since
        // server.close() closes the transport, which re-invokes onclose.
        // The explicit paths (DELETE, eviction, shutdown) close both.
        session.transport.onclose = () => {
          const id = session?.transport.sessionId;
          if (id) this.sessions.delete(id);
        };

        await session.transport.handleRequest(req, res, body);

        if (session.transport.sessionId) {
          this.sessions.set(session.transport.sessionId, session);
        }
      } finally {
        this.pendingInitializations--;
      }
      return;
    }

    session.lastSeen = Date.now();
    await session.transport.handleRequest(req, res, body);

    if (session.transport.sessionId) {
      this.sessions.set(session.transport.sessionId, session);
    }
  }

  private createSession(): Session {
    const server = new McpServer({
      name: "figma-bridge",
      version: VERSION,
    });

    registerTools(server, this.node, this.bridgePort);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    return { server, transport, lastSeen: Date.now() };
  }

  /**
   * Closes sessions idle longer than SESSION_TTL_MS. Runs on initialize so
   * abandoned sessions cannot accumulate without bound.
   */
  private evictExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastSeen <= SESSION_TTL_MS) continue;
      this.sessions.delete(id);
      void Promise.resolve(session.transport.close()).catch(() => undefined);
      void Promise.resolve(session.server.close()).catch(() => undefined);
    }
  }

  private async handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = this.getSessionId(req);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (!session) {
      this.sendJson(res, 404, {
        jsonrpc: "2.0",
        error: { code: -32001, message: "MCP session not found" },
        id: null,
      });
      return;
    }

    await session.transport.handleRequest(req, res);
  }

  private async handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = this.getSessionId(req);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (!session) {
      this.sendJson(res, 404, { error: "MCP session not found" });
      return;
    }

    this.sessions.delete(sessionId!);
    await session.transport.handleRequest(req, res);
    await session.server.close();
  }

  private getSessionId(req: IncomingMessage): string | undefined {
    const value = req.headers["mcp-session-id"];
    return Array.isArray(value) ? value[0] : value;
  }

  private async readJsonBody(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<JSONRPCMessage | undefined> {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxBodySize = 10 * 1024 * 1024;

    try {
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;

        if (size > maxBodySize) {
          this.sendJson(res, 413, { error: "Request body too large" });
          return undefined;
        }

        chunks.push(buffer);
      }

      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JSONRPCMessage;
    } catch {
      this.sendJson(res, 400, { error: "Invalid JSON body" });
      return undefined;
    }
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }
}
