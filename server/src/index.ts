#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Node } from "./node.js";
import { Election } from "./election.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";
import { RemoteMcpServer } from "./remote-mcp.js";

// Overridable so a fork/test instance can run beside a stock 1994 bridge
// without joining its leader election. The plugin must be built with the
// matching VITE_FIGMA_BRIDGE_WS URL (which must also be listed in the
// plugin manifest's networkAccess.allowedDomains).
function resolvePort(): number {
  const raw = process.env.FIGMA_BRIDGE_PORT;
  if (raw === undefined) return 1994;
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // An explicitly set but invalid value must not silently join the stock
    // bridge on 1994 — fail loudly instead.
    console.error(`Invalid FIGMA_BRIDGE_PORT "${raw}" — expected an integer between 1 and 65535`);
    process.exit(1);
  }
  return port;
}

function resolveOptionalPort(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;

  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid ${name} "${raw}" — expected an integer between 1 and 65535`);
    process.exit(1);
  }
  return port;
}

const PORT = resolvePort();

/**
 * Checks whether a startup error is a taken-port error.
 * @param err - Error thrown while binding a listener.
 * @returns True when another process already owns the port.
 */
function isAddrInUse(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "EADDRINUSE";
}

async function main(): Promise<void> {
  const node = new Node(PORT);
  const election = new Election(PORT, node);

  const remoteMcpPort = resolveOptionalPort("FIGMA_MCP_HTTP_PORT");
  // Loopback by default: the HTTP endpoint has no auth, so remote exposure
  // requires explicitly setting FIGMA_MCP_HTTP_HOST (preferably behind an
  // authenticating proxy, since it serves the full write tool surface).
  // An empty value counts as unset — Node would otherwise bind all interfaces.
  const rawHttpHost = process.env.FIGMA_MCP_HTTP_HOST;
  const remoteMcpHost =
    rawHttpHost !== undefined && rawHttpHost.trim() !== "" ? rawHttpHost.trim() : "127.0.0.1";
  let remoteMcp: RemoteMcpServer | null = null;

  if (remoteMcpPort !== null) {
    remoteMcp = new RemoteMcpServer(node, {
      host: remoteMcpHost,
      port: remoteMcpPort,
      bridgePort: PORT,
    });
    try {
      await remoteMcp.start();
    } catch (err) {
      // A taken HTTP port must not kill the stdio bridge — it just means
      // another instance already serves remote clients.
      if (isAddrInUse(err)) {
        console.error(
          `Remote MCP HTTP port ${remoteMcpPort} already in use — continuing with stdio only`
        );
        remoteMcp = null;
      } else {
        throw err;
      }
    }
  }

  await election.start();

  let transport: StdioServerTransport | null = null;
  let shuttingDown = false;

  const shutdown = async (reason: string, code: number = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`Shutting down (${reason})...`);

    const force = setTimeout(() => {
      console.error("Shutdown timeout exceeded, forcing exit");
      process.exit(code);
    }, 5000);
    force.unref();

    election.stop();

    if (remoteMcp) {
      await remoteMcp.stop();
    }

    node.stop();

    if (transport) {
      try {
        await transport.close();
      } catch (err) {
        console.error("Transport close error:", err);
      }
    }

    process.exit(code);
  };

  process.stdin.on("end", () => void shutdown("stdin end"));
  process.stdin.on("close", () => void shutdown("stdin close"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));

  process.on("uncaughtException", async (err) => {
    console.error("Uncaught exception:", err);
    await shutdown("uncaughtException", 1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
  });

  const server = new McpServer({
    name: "figma-bridge",
    version: VERSION,
  });

  registerTools(server, node, PORT);

  console.error(`Starting MCP server (role: ${node.roleName})`);

  transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
