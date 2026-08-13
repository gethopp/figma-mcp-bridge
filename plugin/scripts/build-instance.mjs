import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [instance, rawPort, pluginName] = process.argv.slice(2);

if (!instance || !/^[a-z0-9-]+$/.test(instance)) {
  throw new Error("instance must use lowercase letters, numbers, and hyphens");
}

if (!rawPort || !/^\d+$/.test(rawPort)) {
  throw new Error("port must be an integer");
}

const port = Number(rawPort);
if (port < 1 || port > 65535) {
  throw new Error("port must be between 1 and 65535");
}

const outputDirectory = `dist/${instance}`;
const environment = {
  ...process.env,
  FIGMA_BRIDGE_PORT: String(port),
  FIGMA_PLUGIN_OUT_DIR: outputDirectory
};
const vite = resolve("node_modules/vite/bin/vite.js");

for (const arguments_ of [["build"], ["build", "-c", "vite.config.main.ts"]]) {
  const result = spawnSync(process.execPath, [vite, ...arguments_], {
    cwd: resolve("."),
    env: environment,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const manifest = {
  name: pluginName || `Figma MCP Bridge ${instance}`,
  id: `figma-mcp-bridge-${instance}`,
  api: "1.0.0",
  main: "code.js",
  ui: "index.html",
  permissions: [],
  networkAccess: {
    allowedDomains: [`ws://localhost:${port}`],
    reasoning: "Connects to the local MCP server through WebSocket"
  },
  documentAccess: "dynamic-page",
  editorType: ["figma", "dev"],
  capabilities: ["inspect"]
};

await mkdir(resolve(outputDirectory), { recursive: true });
await writeFile(
  resolve(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(`Built ${manifest.name} for port ${port}: ${outputDirectory}/manifest.json`);
