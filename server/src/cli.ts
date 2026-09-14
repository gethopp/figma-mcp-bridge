import path from "node:path";
import { Election } from "./election.js";
import { sleep } from "./extract/client.js";
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_SECTIONS,
  exportFile,
  type ExportSection,
} from "./extract/exporter.js";
import { Follower } from "./follower.js";
import { Node } from "./node.js";
import { Role, type ConnectedFile } from "./types.js";

const HELP = `Usage: figma-mcp-bridge export [options]

Exports the Figma file open in the bridge plugin to disk: design tokens (raw + W3C DTCG), component
inventory, vector assets, layer trees, frame screenshots (with tiles) and image fills, plus index.md.
Works with or without an MCP client running: it joins an existing bridge or starts one.

Options:
  --out <dir>             Output directory (default: figma-export/<file-name>)
  --file <name>           Figma file to export when several are connected
  --pages <a,b,…>         Page names or ids (default: all pages except separators)
  --only <sections>       Comma-separated: ${EXPORT_SECTIONS.join(", ")}
  --skip <sections>       Sections to leave out, e.g. --skip screenshots,imageFills
  --scale <n>             Screenshot scale (default ${DEFAULT_EXPORT_OPTIONS.scale})
  --tile-height <px>      Tile tall screenshots at this height (default ${DEFAULT_EXPORT_OPTIONS.tileHeight})
  --asset-types <types>   Node types to scan for assets (default ${DEFAULT_EXPORT_OPTIONS.assetTypes.join(",")}), e.g. COMPONENT,FRAME,GROUP,INSTANCE
  --asset-max-size <px>   Largest asset width/height (default ${DEFAULT_EXPORT_OPTIONS.assetMaxSize})
  --asset-formats <f>     SVG, PNG or SVG,PNG (default ${DEFAULT_EXPORT_OPTIONS.assetFormats.join(",")})
  --asset-images          Allow image fills inside assets (logos, illustrations)
  --usage                 Count component instances per page
  --include-hidden        Include hidden layers in page trees
  --wait <seconds>        How long to wait for the Figma plugin to connect (default 60)
  -h, --help              Show this help

Environment: FIGMA_BRIDGE_PORT (default 1995).`;

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-")) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.replace(/^-+/, "");
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(name, next);
      i++;
    } else {
      flags.add(name);
    }
  }
  return { values, flags };
}

const list = (value: string | undefined) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function sections(only: string[] | undefined, skip: string[] | undefined): ExportSection[] {
  for (const name of [...(only ?? []), ...(skip ?? [])]) {
    if (!EXPORT_SECTIONS.includes(name as ExportSection))
      throw new Error(`Unknown section "${name}". Use: ${EXPORT_SECTIONS.join(", ")}`);
  }
  const base = only?.length ? (only as ExportSection[]) : [...EXPORT_SECTIONS];
  return base.filter((section) => !skip?.includes(section));
}

async function connectedFiles(node: Node, port: number): Promise<ConnectedFile[]> {
  const local = node.listConnectedFiles();
  if (local) return local;
  if (node.role !== Role.Follower) return [];
  return new Follower(`http://localhost:${port}`).listConnectedFiles().catch(() => []);
}

/** Runs `figma-mcp-bridge export`. Returns the process exit code. */
export async function runExportCli(argv: string[], port: number): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (args.flags.has("h") || args.flags.has("help")) {
    console.log(HELP);
    return 0;
  }

  const number = (name: string, fallback: number) => {
    const raw = args.values.get(name);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`--${name} must be a positive number`);
    return value;
  };

  const node = new Node(port);
  const election = new Election(port, node);
  try {
    const exportSections = sections(list(args.values.get("only")), list(args.values.get("skip")));
    const waitSeconds = number("wait", 60);
    await election.start();

    let files: ConnectedFile[] = [];
    const deadline = Date.now() + waitSeconds * 1000;
    let hinted = false;
    while (Date.now() < deadline) {
      files = await connectedFiles(node, port);
      if (files.length) break;
      if (!hinted) {
        console.error(
          `Waiting for the Figma plugin on port ${port}… run "Figma MCP Bridge" in the file you want to export.`
        );
        hinted = true;
      }
      await sleep(1000);
    }
    if (!files.length) throw new Error(`No Figma file connected after ${waitSeconds}s.`);

    const wantedFile = args.values.get("file");
    const file = wantedFile
      ? files.find((candidate) => candidate.fileName === wantedFile)
      : files.length === 1
        ? files[0]
        : undefined;
    if (!file) {
      throw new Error(
        `Choose a file with --file: ${files.map((candidate) => `"${candidate.fileName}"`).join(", ")}`
      );
    }

    const assetFormats = (
      list(args.values.get("asset-formats")) ?? DEFAULT_EXPORT_OPTIONS.assetFormats
    ).map((format) => format.toUpperCase());
    for (const format of assetFormats)
      if (format !== "SVG" && format !== "PNG")
        throw new Error(`Unsupported asset format: ${format}`);

    const outDir = path.resolve(
      args.values.get("out") ??
        path.join("figma-export", file.fileName.replace(/[\\/:*?"<>|]+/g, "-"))
    );
    const manifest = await exportFile(node, {
      ...DEFAULT_EXPORT_OPTIONS,
      outDir,
      fileKey: file.fileKey,
      pages: list(args.values.get("pages")),
      sections: exportSections,
      scale: number("scale", DEFAULT_EXPORT_OPTIONS.scale),
      tileHeight: number("tile-height", DEFAULT_EXPORT_OPTIONS.tileHeight),
      assetTypes: (list(args.values.get("asset-types")) ?? DEFAULT_EXPORT_OPTIONS.assetTypes).map(
        (type) => type.toUpperCase()
      ),
      assetMaxSize: number("asset-max-size", DEFAULT_EXPORT_OPTIONS.assetMaxSize),
      assetFormats: assetFormats as ("SVG" | "PNG")[],
      assetImages: args.flags.has("asset-images"),
      componentUsage: args.flags.has("usage"),
      subtree: {
        ...DEFAULT_EXPORT_OPTIONS.subtree,
        includeHidden: args.flags.has("include-hidden"),
      },
      log: (line) => console.log(line),
    });
    return manifest.errors.length ? 1 : 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  } finally {
    election.stop();
    node.stop();
  }
}
