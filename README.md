# Figma MCP Bridge

[![Pairing with Hopp](https://gethopp.app/git/hopp-shield.svg?ref=hopp-repo)](https://gethopp.app)

- [Demo](#demo)
- [Quick Start](#quick-start)
- [Available Tools](#available-tools)
- [Local development](#local-development)
- [Structure](#structure)
- [How it works](#how-it-works)

<br/>

<img src="https://raw.githubusercontent.com/gethopp/figma-mcp-bridge/main/logo.png" alt="Figma MCP Bridge" align="center" />

<br/>

While other amazing Figma MCP servers like [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP/) exist, one issues is the [API limiting](https://github.com/GLips/Figma-Context-MCP/issues/258) for free users.

The limit for free accounts is 6 requests per month, yes **per month**.

Figma MCP Bridge is a solution to this problem. It is a plugin + MCP server that streams live Figma document data to AI tools without hitting Figma API rate limits, so its Figma MCP for the rest of us ✊

## Demo

[Watch a demo of building a UI in Cursor with Figma MCP Bridge](https://youtu.be/ouygIhFBx0g)

[![Watch the video](https://img.youtube.com/vi/ouygIhFBx0g/maxresdefault.jpg)](https://youtu.be/ouygIhFBx0g)


## Quick Start

### 1. Add the MCP server to your favourite AI tool

Add the following to your AI tool's MCP configuration (e.g. Cursor, Windsurf, Claude Desktop):

```json
{
  "figma-bridge": {
    "command": "npx",
    "args": ["-y", "@gethopp/figma-mcp-bridge"]
  }
}
```

That's it — no binaries to download or install.

### 2. Add the Figma plugin

Download the plugin from the [latest release](https://github.com/gethopp/figma-mcp-bridge/releases) page, then in Figma go to `Plugins > Development > Import plugin from manifest` and select the `manifest.json` file from the `plugin/` folder.

### 3. Start using it 🎉

Open a Figma file, run the plugin, and start prompting your AI tool. The MCP server will automatically connect to the plugin.

If you want to know more about how it works, read the [How it works](#how-it-works) section.

## Available Tools

| Tool | Description |
|------|-------------|
| `get_document` | Get the current Figma page document tree |
| `get_selection` | Get the currently selected nodes in Figma |
| `get_node` | Get a specific Figma node by ID (colon format, e.g. `4029:12345`) |
| `get_styles` | Get all local paint, text, effect, and grid styles |
| `get_metadata` | Get file name, pages, and current page info |
| `get_design_context` | Get a depth-limited tree optimized for understanding design context |
| `get_variable_defs` | Get all variable collections, modes, and values (design tokens) |
| `get_screenshot` | Export nodes as PNG/SVG/JPG/PDF (base64-encoded) |
| `save_screenshots` | Export and save screenshots directly to the local filesystem |
| `create_frame` | Create a frame on the current page |
| `create_text` | Create a text node on the current page |
| `create_rectangle` | Create a rectangle on the current page |
| `append_children` | Re-parent existing child nodes under a parent |
| `find_nodes` | Find nodes on the current page by ID, name, key, or parent |
| `set_position` | Set node position |
| `set_size` | Set node size |
| `set_fills` | Set node fills using supported solid paints |
| `set_strokes` | Set node strokes using supported solid paints |
| `set_corner_radius` | Set uniform corner radius |
| `set_text_content` | Set text content |
| `set_text_style` | Set text style |
| `set_layout_mode` | Set auto-layout mode |
| `set_padding` | Set auto-layout padding |
| `set_item_spacing` | Set auto-layout item spacing |
| `delete_node` | Delete a node |
| `batch_mutation` | Execute up to 100 write operations in order, with temporary refs for multi-step generation |

Write tools are intentionally scoped to the current page and a deterministic subset of Figma mutations so AI-driven edits remain easier to validate and safer to automate.

Within `batch_mutation`, temporary references must use the `tmp:` prefix, for example `ref: "tmp:modal"` and `nodeId: "tmp:modal"`. Bare labels like `"modal"` are treated as literal node IDs and are not resolved as batch refs.

## Local development

#### 1. Clone this repository locally

```bash
git clone git@github.com:gethopp/figma-mcp-bridge.git
```

#### 2. Build the server

```bash
cd server && npm install && npm run build
```

#### 3. Build the plugin

```bash
cd plugin && bun install && bun run build
```

#### 4. Add the MCP server to your favourite AI tool

For local development, add the following to your AI tool's MCP config:

```json
{
  "figma-bridge": {
    "command": "node",
    "args": ["/path/to/figma-mcp-bridge/server/dist/index.js"]
  }
}
```

## Structure

```text
Figma-MCP-Bridge/
|-- plugin/                    # Figma plugin (TypeScript/React)
|   `-- src/
|       |-- ui/                # Plugin UI shown inside Figma
|       `-- main/
|           |-- code.ts        # Plugin runtime entry point and RPC dispatch
|           |-- serializer.ts  # Read-side node/style serialization
|           `-- write.ts       # Write-side mutation engine and batch execution
`-- server/                    # MCP server (TypeScript/Node.js)
    `-- src/
        |-- index.ts           # Entry point
        |-- bridge.ts          # WebSocket bridge to Figma plugin
        |-- leader.ts          # Leader: HTTP server + bridge
        |-- follower.ts        # Follower: proxies to leader via HTTP
        |-- node.ts            # Dynamic leader/follower role switching
        |-- election.ts        # Leader election & health monitoring
        |-- schema.ts          # Zod schemas for read/write tool inputs
        |-- tools.ts           # MCP tool registration for read/write operations
        `-- types.ts           # Shared transport types
```

## How it works

There are two main components to the Figma MCP Bridge:

### 1. The Figma Plugin

The Figma plugin is the user interface for the Figma MCP Bridge. You run this inside the Figma file you want to use the MCP server for, and its responsible for getting you all the information you need.

### 2. The MCP Server

The MCP server is the core of the Figma MCP Bridge. As the Figma plugin connects with the MCP server via a WebSocket connection, the MCP server is responsible for:
- Handling WebSocket connections from the Figma plugin
- Forwarding tool calls to the Figma plugin
- Routing responses back to the Figma plugin
- Handling leader election (as we can have only one WS connection to an MCP server at a time)


```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FIGMA (Browser)                                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Figma Plugin                                  │  │
│  │                    (TypeScript/React)                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ WebSocket
                                      │ (ws://localhost:1994/ws)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRIMARY MCP SERVER                                 │
│                         (Leader on :1994)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Bridge                                    Endpoints:               │    │
│  │  • Manages WebSocket conn                  • /ws    (plugin)        │    │
│  │  • Forwards requests to plugin             • /ping  (health)        │    │
│  │  • Routes responses back                   • /rpc   (followers)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                           ▲                              ▲
                           │ HTTP /rpc                    │ HTTP /rpc
                           │ POST requests                │ POST requests
                           │                              │
         ┌─────────────────┴───────────┐    ┌─────────────┴───────────────┐
         │    FOLLOWER MCP SERVER 1    │    │    FOLLOWER MCP SERVER 2    │
         │                             │    │                             │
         │  • Pings leader /ping       │    │  • Pings leader /ping       │
         │  • Forwards tool calls      │    │  • Forwards tool calls      │
         │    via HTTP /rpc            │    │    via HTTP /rpc            │
         │  • If leader dies →         │    │  • If leader dies →         │
         │    attempts takeover        │    │    attempts takeover        │
         └─────────────────────────────┘    └─────────────────────────────┘
                    ▲                                      ▲
                    │                                      │
                    │ MCP Protocol                         │ MCP Protocol
                    │ (stdio)                              │ (stdio)
                    ▼                                      ▼
         ┌─────────────────────────────┐    ┌─────────────────────────────┐
         │      AI Tool / IDE 1        │    │      AI Tool / IDE 2        │
         │      (e.g., Cursor)         │    │      (e.g., Cursor)         │
         └─────────────────────────────┘    └─────────────────────────────┘
```
