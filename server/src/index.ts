#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Node } from "./node.js";
import { Election } from "./election.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

const PORT = 1994;

async function main(): Promise<void> {
  const node = new Node(PORT);
  const election = new Election(PORT, node);
  await election.start();

  // Graceful shutdown
  const shutdown = () => {
    console.error("Shutting down...");
    election.stop();
    node.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Create MCP server (stdio transport)
  const server = new McpServer({
    name: "figma-bridge",
    version: VERSION,
  });

  registerTools(server, node);

  console.error(`Starting MCP server (role: ${node.roleName})`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
