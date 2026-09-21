import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fileKey = process.env.FIGMA_SMOKE_FILE_KEY;
const parentId = process.env.FIGMA_SMOKE_PARENT_ID;

if (!fileKey) {
  throw new Error("FIGMA_SMOKE_FILE_KEY is required for the live Figma smoke test");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  stderr: "pipe",
});
const client = new Client({ name: "create-svg-smoke", version: "1.0.0" });
let createdNodeId;

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (!listed.tools.some((tool) => tool.name === "create_svg")) {
    throw new Error("create_svg was not advertised by the latest server build");
  }

  const result = await client.callTool({
    name: "create_svg",
    arguments: {
      fileKey,
      ...(parentId ? { parentId } : {}),
      name: "QA · latest-server create_svg · temporary",
      x: 40000,
      y: 0,
      width: 96,
      height: 96,
      source:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="#C9B48A" stroke-width="2"/><path d="M7 12h10" stroke="#C9B48A" stroke-width="2"/></svg>',
    },
  });
  if (result.isError) {
    throw new Error(JSON.stringify(result.content));
  }

  const textResult = result.content.find((item) => item.type === "text")?.text;
  const payload = textResult ? JSON.parse(textResult) : undefined;
  createdNodeId = payload?.nodeId;
  if (!createdNodeId || payload.nodeType !== "FRAME" || payload.childCount < 1) {
    throw new Error(`Unexpected create_svg result: ${textResult}`);
  }

  console.log(JSON.stringify(result));
} finally {
  if (createdNodeId) {
    await client.callTool({
      name: "delete_nodes",
      arguments: { fileKey, nodeIds: [createdNodeId], confirm: true },
    });
  }
  await client.close();
}
