# AGENTS.md

Guidance for AI coding agents (and the humans driving them) contributing to Figma MCP Bridge. Read this before writing code or opening a PR. Small, focused, verified PRs get merged quickly; large or noisy ones get sent back.

## What this project is

A Figma plugin plus an MCP server that stream live document data to AI tools **without the Figma REST API**. Avoiding the REST API's rate limits is the reason this project exists.

- Never call the Figma REST API, and never ask users for a Figma personal access token. Everything goes through the Plugin API inside `plugin/`. PRs that depend on the REST API will be closed ([#59](https://github.com/gethopp/figma-mcp-bridge/pull/59)).
- The plugin runs in Figma Design, Dev Mode (read-only) and FigJam. New tools must behave correctly, or fail with a clear error, in all three.

```
plugin/src/main/      # Plugin sandbox: request dispatch (code.ts), serialization, prototype logic
plugin/src/ui/        # Plugin UI (React)
plugin/src/html-figma # Vendored third-party code, see NOTICE.md. Don't refactor it.
server/src/           # MCP server: tool registration (tools.ts), zod schemas (schema.ts), leader/follower bridge
```

## Hard rules

### 1. Do not add tests, test runners, or test scripts

The repo has no committed test suite. Don't add one as part of a feature PR. That means:

- no `tests/` folders, `*.test.ts`, `*.test.mjs`, or `*.spec.*` files;
- no new `test` script in any `package.json`;
- no changes to the root `check` script to run tests.

Smoke-test scripts are fine locally. Delete them before committing, and put what you verified in the PR description (see [Verifying your change](#verifying-your-change)).

If you think the project needs a real test suite, open an issue to discuss it first.

### 2. Do not touch `package.json` or lock files unless the change truly needs it

- This repo uses **Bun**. Never commit `package-lock.json`, `yarn.lock` or `pnpm-lock.yaml`. If one shows up after running `npm install`, delete it.
- Don't commit `bun.lock` changes caused only by reinstalling, upgrading unrelated packages, or a different Bun version.
- Don't bump `version` fields. The release workflow handles versions.
- Don't reorder, reformat or "tidy" `package.json` files, and don't add or change scripts.

The only acceptable change is adding or upgrading a dependency your feature actually needs. In that case, use `bun add <pkg>` in the right workspace (`server/` or `plugin/`), commit only the `package.json` and `bun.lock` changes for that package, and say in the PR description why the dependency is needed and why the existing ones aren't enough. Prefer no new dependency at all.

### 3. Keep the diff scoped

- One feature or fix per PR. Link the issue it closes.
- No drive-by refactors, renames, or reformatting of code you didn't need to touch.
- Don't edit `.github/workflows/`, `.husky/`, `.prettierrc`, `tsconfig.json` or `plugin/manifest.json` unless that is the point of the PR.
- Don't commit build output or local artifacts: `dist/`, `.claude/`, `.cursor/`, `.DS_Store`, screenshots, scratch scripts, plan/notes markdown files.

Before pushing, run `git diff --stat main` and make sure every file listed is one you meant to change.

## Adding or changing a tool

Every tool goes through the same path. Follow `set_node_constraints` ([#72](https://github.com/gethopp/figma-mcp-bridge/pull/72)) as a reference: a typical tool touches only these four files.

1. **`server/src/schema.ts`**: define the zod input. Reuse `createFigmaNodeIdSchema()` and `fileKeyField`, give every field a `.describe()`, and put cross-field rules in `.refine()`. Register it in `toolInputSchemas` and add its mapper to `rpcToArgs` (the compiler will complain if you forget).
2. **`server/src/tools.ts`**: register with `server.tool(...)`, validate with `parseToolInput`, and forward with `renderResponse(() => node.sendWithParams(...))`. The tool description is what the AI client reads, so state what it does, what it accepts, and where it is unavailable.
3. **`plugin/src/main/code.ts`**: add the request type to the `RequestType` union, add it to `EDIT_REQUEST_TYPES` if it writes to the document (this blocks it in Dev Mode), and handle it in `handleRequest`. Use `isFigJam()` / `requireFigJamApi()` for FigJam-specific behaviour.
4. **`README.md`**: add a row to the Available Tools table and, for write tools, a line in Editing Notes covering limits and the editors where it is unavailable.

Conventions to keep:

- Batch-capable tools accept `nodeId` **or** `nodeIds` and apply the same change to each.
- Destructive operations need an explicit opt-in (see `delete_nodes` with `confirm: true` and the `run_script` env flag).
- Return enough data for the agent to confirm the change (for example, previous and applied values) instead of a bare `ok`.
- Tools that read local files must resolve paths inside the MCP server working directory and reject anything that escapes it (see `create_svg` and `import_html_layers`).
- The leader listens on `127.0.0.1` and its endpoints have no authentication. Don't widen what it exposes.

## Code standards

The codebase is strict TypeScript, formatted with Prettier (`.prettierrc`: 2 spaces, double quotes, semicolons, 100-column width). The pre-commit hook formats staged files; run `bun install` at the repo root once so it is installed.

- **Match the surrounding code.** Use existing helpers before writing new ones, keep the existing naming (`camelCase` functions, `PascalCase` types, `UPPER_SNAKE_CASE` constants, snake_case tool names), and follow the file's existing structure.
- **Types:** no `any`. Use `unknown` at boundaries and narrow with zod or type guards. Don't use `as` casts or `@ts-ignore` to silence the Figma typings. Check the node type (`"constraints" in node`, `node.type === "TEXT"`) instead.
- **Errors:** throw `Error`s with an actionable message that names the tool and, where relevant, the node, for example `set_node_constraints is not available in FigJam`. In batch tools, report per-node failures instead of aborting the whole batch silently.
- **Async:** use `async`/`await` and await Figma's async APIs (`getNodeByIdAsync`, `loadFontAsync`, `setFillStyleIdAsync`, …). Don't add new uses of the deprecated sync variants.
- **Simplicity:** prefer `?.` and `??` over manual null checks, early returns over nested `else`, and built-ins (`Set`, `Map`, `Array` methods) over hand-rolled loops. Don't add abstractions for a single caller.
- **Comments:** only explain constraints the code can't show, such as a Figma API quirk or why a value is clamped. Don't narrate what the next line does, and don't leave "AI was here" or changelog comments.
- **Cite non-obvious behaviour.** If code relies on an undocumented Figma quirk, a magic number, or a pattern copied from elsewhere, link the source (Figma docs, forum thread, upstream repo) in a short comment or in the PR description. Code that "reads like dark magic" will be questioned ([#56](https://github.com/gethopp/figma-mcp-bridge/pull/56)).

## Verifying your change

Run the full check from the repo root before opening or updating a PR. It builds the server, type-checks and builds the plugin, and checks formatting:

```bash
bun run check
```

Then test the change for real in the **Figma desktop app**: build the plugin, import `plugin/manifest.json`, point your AI tool at your local `server/dist/index.js` (see the README's Local development section), and call the tool. Cover the editors the tool claims to support (Design, FigJam, Dev Mode) and at least one failure case.

Don't open a PR whose description says verification is still pending. Finish verifying first, or open it as a draft.

## Opening the PR

- **Title:** Conventional Commits style, matching the history: `feat: …`, `fix(server): …`, `fix(plugin): …`, `docs: …`, `ci: …`.
- **Description:** what changed and why, the issue it closes, and how you verified it. Include the tool calls you ran, trimmed responses, and screenshots where useful. Note any new dependency and why it was needed.
- **CLA:** sign the CLA when the `license/cla` check asks. PRs can't be merged without it.
- **Review bots:** address CodeRabbit comments or reply explaining why not. Don't paste its summary in place of your own description.
- **Be honest about AI use.** Using an agent is fine. Submitting code you haven't read, built and run is not. You are responsible for every line in the diff.
