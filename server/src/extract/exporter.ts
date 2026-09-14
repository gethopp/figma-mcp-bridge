import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { request, type BridgeSender } from "./client.js";
import { countTokens, toDtcg, type RawTokens } from "./dtcg.js";
import { renderIndex } from "./index-md.js";
import { displayName, isSeparatorPage, matchKey, padIndex, slugify, uniqueName } from "./names.js";
import { tilePng } from "./tiles.js";
import { exportTree, walkTree, type SubtreeParams, type TreeNode } from "./tree.js";

export const EXPORT_SECTIONS = [
  "tokens",
  "components",
  "assets",
  "layers",
  "screenshots",
  "imageFills",
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export interface ExportOptions {
  /** Absolute output directory; the export is written directly inside it. */
  outDir: string;
  fileKey?: string;
  /** Page names or ids. Default: every page except separators. */
  pages?: string[];
  sections: ExportSection[];
  /** Screenshot scale for top-level frames. */
  scale: number;
  /** Screenshots taller than this (in exported px) are also cut into tiles. */
  tileHeight: number;
  /** Node types considered as assets. */
  assetTypes: string[];
  /** Largest width/height (px) of an asset. */
  assetMaxSize: number;
  assetFormats: ("SVG" | "PNG")[];
  /** Scale for PNG assets. */
  assetScale: number;
  /** Allow image fills inside assets (logos, illustrations). */
  assetImages: boolean;
  /** Count component instances per page (slower on large files). */
  componentUsage: boolean;
  subtree: SubtreeParams;
  log?: (line: string) => void;
}

export const DEFAULT_EXPORT_OPTIONS: Omit<ExportOptions, "outDir"> = {
  sections: [...EXPORT_SECTIONS],
  scale: 1,
  tileHeight: 2000,
  assetTypes: ["COMPONENT"],
  assetMaxSize: 256,
  assetFormats: ["SVG"],
  assetScale: 2,
  assetImages: false,
  componentUsage: false,
  subtree: { depth: 1000, maxNodes: 800, budgetMs: 4000, includeHidden: false },
};

type PageRef = { id: string; name: string };

export interface ImageEntry {
  id: string;
  file?: string;
  scale?: number;
  tiles: string[];
  error?: string;
}

export interface PageEntry {
  id: string;
  name: string;
  slug: string;
  status: "ok" | "failed";
  error?: string;
  file?: string;
  requests?: number;
  topLevel: { id: string; name: string; type: string; width?: number; height?: number }[];
  summary?: PageStats;
  images: ImageEntry[];
}

export interface PageStats {
  nodes: number;
  byType: Record<string, number>;
  textLayers: number;
  characters: number;
  instances: Record<string, number>;
  variables: Record<string, number>;
  styles: Record<string, number>;
}

export interface ComponentSetInfo {
  id: string;
  name: string;
  page: string;
  variantCount?: number;
  properties: string[];
  description?: string;
}

export interface ExportManifest {
  file: string;
  exportedAt: string;
  bridge: unknown;
  options: Record<string, unknown>;
  missingPages: string[];
  tokens?: {
    files: { raw: string; dtcg: string };
    collections: { name: string; modes: string[]; variables: number; remote?: boolean }[];
    styles: { paints: number; text: number; effects: number; grids: number };
    dtcgTokens: number;
  };
  components?: {
    file: string;
    sets: number;
    components: number;
    variants: number;
    byPage: { name: string; slug: string; sets: number; components: number }[];
    list: ComponentSetInfo[];
  };
  assets?: {
    file: string;
    count: number;
    failed: number;
    byPage: { name: string; slug: string; count: number }[];
  };
  imageFills?: { dir: string; count: number; failed: number };
  pages: PageEntry[];
  errors: string[];
}

const IMAGE_TYPES = new Set([
  "FRAME",
  "SECTION",
  "COMPONENT_SET",
  "COMPONENT",
  "INSTANCE",
  "GROUP",
]);
const MAX_EXPORT_PX = 16384;
const ASSET_BATCH = 25;
const FILL_BATCH = 10;

const json = (value: unknown) => `${JSON.stringify(value, null, 1)}\n`;

async function write(outDir: string, relative: string, content: string | Buffer): Promise<void> {
  const target = path.join(outDir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

function summarise(root: TreeNode): PageStats {
  const stats: PageStats = {
    nodes: 0,
    byType: {},
    textLayers: 0,
    characters: 0,
    instances: {},
    variables: {},
    styles: {},
  };
  const bump = (counts: Record<string, number>, key: string) =>
    (counts[key] = (counts[key] ?? 0) + 1);
  walkTree(root, (node) => {
    stats.nodes++;
    bump(stats.byType, node.type);
    if (node.type === "TEXT") {
      stats.textLayers++;
      stats.characters += typeof node.characters === "string" ? node.characters.length : 0;
    }
    const main = node.mainComponent as
      { name: string; componentSet?: { name: string } } | undefined;
    if (main) bump(stats.instances, main.componentSet?.name ?? main.name);
    for (const value of Object.values((node.tokens as Record<string, string | string[]>) ?? {})) {
      for (const name of ([] as string[]).concat(value)) bump(stats.variables, name);
    }
    for (const name of Object.values((node.styleRefs as Record<string, string>) ?? {}))
      bump(stats.styles, name);
  });
  return stats;
}

function collectImageHashes(root: TreeNode, into: Set<string>): void {
  walkTree(root, (node) => {
    const styles = node.styles as { fills?: unknown; strokes?: unknown } | undefined;
    for (const paints of [styles?.fills, styles?.strokes]) {
      if (!Array.isArray(paints)) continue;
      for (const paint of paints)
        if (paint?.type === "IMAGE" && typeof paint.imageHash === "string")
          into.add(paint.imageHash);
    }
  });
}

const extensionFor = (mime: string) =>
  ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" })[mime] ??
  "bin";

/**
 * Exports a Figma file to disk through the bridge: design tokens (raw and DTCG), a component inventory,
 * vector assets, full layer trees, frame screenshots with tiles and image fills, plus `manifest.json`
 * and an `index.md` guide. Works one request at a time and records per-page failures instead of aborting.
 */
export async function exportFile(
  sender: BridgeSender,
  options: ExportOptions
): Promise<ExportManifest> {
  const log = options.log ?? (() => undefined);
  const { fileKey, outDir } = options;
  const has = (section: ExportSection) => options.sections.includes(section);

  const bridge = await request<{ extractionApi?: number }>(sender, "get_bridge_info", {
    fileKey,
    retries: 1,
  }).catch(() => null);
  if (!bridge?.extractionApi) {
    throw new Error(
      "The Figma plugin connected to this bridge doesn't support design-system extraction. Import plugin/manifest.json from this repository in Figma (Plugins → Development → Import plugin from manifest) and run it in the file."
    );
  }

  const meta = await request<{ fileName: string; pages: PageRef[] }>(sender, "get_metadata", {
    fileKey,
  });
  const contentPages = meta.pages.filter((page) => !isSeparatorPage(page.name));
  const wanted = options.pages?.filter(Boolean) ?? [];
  const matches = (page: PageRef, key: string) =>
    page.id === key || matchKey(page.name) === matchKey(key);
  const pages = wanted.length
    ? contentPages.filter((page) => wanted.some((key) => matches(page, key)))
    : contentPages;
  const slugOf = (page: PageRef) =>
    `${padIndex(contentPages.indexOf(page) + 1)}-${slugify(page.name)}`;

  const manifest: ExportManifest = {
    file: meta.fileName,
    exportedAt: new Date().toISOString(),
    bridge,
    options: {
      pages: wanted.length ? wanted : "all",
      sections: options.sections,
      scale: options.scale,
      tileHeight: options.tileHeight,
      assetTypes: options.assetTypes,
      assetMaxSize: options.assetMaxSize,
      assetFormats: options.assetFormats,
      subtree: options.subtree,
    },
    missingPages: wanted.filter((key) => !contentPages.some((page) => matches(page, key))),
    pages: [],
    errors: [],
  };
  if (manifest.missingPages.length) log(`No page matching: ${manifest.missingPages.join(", ")}`);
  log(`Exporting "${meta.fileName}": ${pages.length} of ${contentPages.length} pages → ${outDir}`);
  await mkdir(outDir, { recursive: true });

  let inventory: { file: string; exportedAt: string; pages: Record<string, unknown>[] } | undefined;

  if (has("tokens")) {
    try {
      const raw = await request<RawTokens>(sender, "get_tokens", {
        fileKey,
        params: { includeLibraries: true },
      });
      const dtcg = toDtcg(raw);
      await write(outDir, "tokens/figma-tokens.json", json(raw));
      await write(outDir, "tokens/tokens.dtcg.json", json(dtcg));
      manifest.tokens = {
        files: { raw: "tokens/figma-tokens.json", dtcg: "tokens/tokens.dtcg.json" },
        collections: [...raw.collections, ...(raw.libraryCollections ?? [])].map((collection) => ({
          name: collection.name,
          modes: collection.modes.map((mode) => mode.name),
          variables: collection.variables.length,
          remote: collection.remote || undefined,
        })),
        styles: {
          paints: raw.styles?.paints?.length ?? 0,
          text: raw.styles?.text?.length ?? 0,
          effects: raw.styles?.effects?.length ?? 0,
          grids: raw.styles?.grids?.length ?? 0,
        },
        dtcgTokens: countTokens(dtcg),
      };
      log(
        `✓ tokens: ${manifest.tokens.collections.length} collections, ${manifest.tokens.dtcgTokens} DTCG tokens`
      );
    } catch (err) {
      manifest.errors.push(`tokens: ${(err as Error).message}`);
      log(`✗ tokens: ${(err as Error).message}`);
    }
  }

  if (has("components")) {
    inventory = { file: meta.fileName, exportedAt: manifest.exportedAt, pages: [] };
    const list: ComponentSetInfo[] = [];
    const byPage: NonNullable<ExportManifest["components"]>["byPage"] = [];
    let sets = 0;
    let components = 0;
    let variants = 0;
    for (const page of pages) {
      try {
        const summary = await request<{
          componentSets: Record<string, any>[];
          components: Record<string, any>[];
          usage?: unknown;
        }>(sender, "get_page_summary", {
          nodeIds: [page.id],
          params: { includeVariants: true, includeUsage: options.componentUsage },
          fileKey,
        });
        if (!summary.componentSets.length && !summary.components.length) continue;
        inventory.pages.push({
          id: page.id,
          name: displayName(page.name),
          slug: slugOf(page),
          ...summary,
        });
        byPage.push({
          name: displayName(page.name),
          slug: slugOf(page),
          sets: summary.componentSets.length,
          components: summary.components.length,
        });
        sets += summary.componentSets.length;
        components += summary.components.length;
        for (const set of summary.componentSets) {
          variants += set.variantCount ?? 0;
          list.push({
            id: set.id,
            name: set.name,
            page: displayName(page.name),
            variantCount: set.variantCount,
            properties: Object.keys(set.propertyDefinitions ?? {}),
            description: set.description,
          });
        }
        for (const component of summary.components) {
          list.push({
            id: component.id,
            name: component.name,
            page: displayName(page.name),
            properties: Object.keys(component.propertyDefinitions ?? {}),
            description: component.description,
          });
        }
      } catch (err) {
        manifest.errors.push(`components ${displayName(page.name)}: ${(err as Error).message}`);
      }
    }
    await write(outDir, "components.json", json(inventory));
    manifest.components = { file: "components.json", sets, components, variants, byPage, list };
    log(`✓ components: ${sets} sets (${variants} variants), ${components} standalone components`);
  }

  if (has("assets")) {
    const records: Record<string, unknown>[] = [];
    const byPage: NonNullable<ExportManifest["assets"]>["byPage"] = [];
    let failed = 0;
    for (const page of pages) {
      try {
        const found: Record<string, any>[] = [];
        for (let cursor: number | null = 0; cursor !== null;) {
          const result: { assets: Record<string, any>[]; nextCursor: number | null } =
            await request(sender, "find_assets", {
              nodeIds: [page.id],
              params: {
                types: options.assetTypes,
                maxSize: options.assetMaxSize,
                includeImages: options.assetImages,
                includeExportSettings: true,
                cursor,
                limit: 300,
              },
              fileKey,
            });
          found.push(...result.assets);
          cursor = result.nextCursor;
        }
        if (!found.length) continue;

        const slug = slugOf(page);
        const taken = new Set<string>();
        const files = new Map<string, Record<string, string>>();
        const errors = new Map<string, string>();
        const fileBase = new Map<string, string>();
        for (const asset of found) {
          const folder = (asset.path as string[] | undefined)?.map(slugify).join("/") ?? "";
          fileBase.set(
            asset.id,
            uniqueName(taken, path.posix.join("assets", slug, folder, slugify(asset.name)))
          );
        }
        for (const format of options.assetFormats) {
          for (let i = 0; i < found.length; i += ASSET_BATCH) {
            const batch = found.slice(i, i + ASSET_BATCH);
            const result = await request<{ exports: Record<string, any>[] }>(
              sender,
              "export_assets",
              {
                nodeIds: batch.map((asset) => asset.id),
                params: { format, scale: options.assetScale },
                fileKey,
              }
            );
            for (const item of result.exports) {
              if (item.error) {
                errors.set(item.id, item.error);
                continue;
              }
              const relative = `${fileBase.get(item.id)}.${format.toLowerCase()}`;
              await write(
                outDir,
                relative,
                format === "SVG" ? item.svg : Buffer.from(item.base64, "base64")
              );
              files.set(item.id, {
                ...(files.get(item.id) ?? {}),
                [format.toLowerCase()]: relative,
              });
            }
          }
        }
        for (const asset of found) {
          const error = errors.get(asset.id);
          if (error) failed++;
          records.push({
            ...asset,
            page: displayName(page.name),
            files: files.get(asset.id),
            error,
          });
        }
        byPage.push({ name: displayName(page.name), slug, count: found.length });
        log(`✓ assets ${displayName(page.name)}: ${found.length}`);
      } catch (err) {
        manifest.errors.push(`assets ${displayName(page.name)}: ${(err as Error).message}`);
      }
    }
    await write(
      outDir,
      "assets.json",
      json({ file: meta.fileName, exportedAt: manifest.exportedAt, assets: records })
    );
    manifest.assets = { file: "assets.json", count: records.length, failed, byPage };
    if (!byPage.length)
      log("✓ assets: none found (adjust asset types or max size to widen the search)");
  }

  const imageHashes = new Set<string>();
  if (has("layers") || has("screenshots")) {
    for (const page of pages) {
      const slug = slugOf(page);
      const entry: PageEntry = {
        id: page.id,
        name: displayName(page.name),
        slug,
        status: "ok",
        topLevel: [],
        images: [],
      };
      const started = Date.now();
      try {
        if (has("layers")) {
          let requests = 0;
          const root = await exportTree(
            sender,
            page.id,
            fileKey,
            options.subtree,
            () => requests++
          );
          entry.file = `pages/${slug}.json`;
          await write(outDir, entry.file, json(root));
          entry.requests = requests;
          entry.summary = summarise(root);
          entry.topLevel = (root.children ?? []).map((child) => {
            const bounds = child.bounds as { width?: number; height?: number } | undefined;
            return {
              id: child.id,
              name: child.name,
              type: child.type,
              width: bounds?.width,
              height: bounds?.height,
            };
          });
          if (has("imageFills")) collectImageHashes(root, imageHashes);
        } else {
          const summary = await request<{ topLevel: Record<string, any>[] }>(
            sender,
            "get_page_summary",
            {
              nodeIds: [page.id],
              fileKey,
            }
          );
          entry.topLevel = summary.topLevel
            .filter((child) => !child.hidden)
            .map((child) => ({
              id: child.id,
              name: child.name,
              type: child.type,
              width: child.bounds?.width,
              height: child.bounds?.height,
            }));
        }

        if (has("screenshots")) {
          for (const [index, frame] of entry.topLevel.entries()) {
            if (!IMAGE_TYPES.has(frame.type) || !frame.width || !frame.height) continue;
            const scale = Number(
              Math.max(
                0.05,
                Math.min(options.scale, MAX_EXPORT_PX / Math.max(frame.width, frame.height))
              ).toFixed(3)
            );
            const base = `images/${slug}/${padIndex(index + 1)}-${slugify(frame.name)}`;
            try {
              const result = await request<{ exports: { base64: string }[] }>(
                sender,
                "get_screenshot",
                {
                  nodeIds: [frame.id],
                  params: { format: "PNG", scale },
                  fileKey,
                }
              );
              const buffer = Buffer.from(result.exports[0].base64, "base64");
              await write(outDir, `${base}.png`, buffer);
              const tiles: string[] = [];
              for (const [part, tile] of tilePng(buffer, options.tileHeight).entries()) {
                const tilePath = `${base}.part-${padIndex(part + 1)}.png`;
                await write(outDir, tilePath, tile);
                tiles.push(tilePath);
              }
              entry.images.push({ id: frame.id, file: `${base}.png`, scale, tiles });
            } catch (err) {
              entry.images.push({ id: frame.id, tiles: [], error: (err as Error).message });
            }
          }
        }
        const images = entry.images.filter((image) => image.file).length;
        log(
          `✓ ${entry.name}: ${entry.summary ? `${entry.summary.nodes} nodes, ` : ""}${entry.topLevel.length} top-level, ` +
            `${images} screenshots, ${((Date.now() - started) / 1000).toFixed(1)}s`
        );
      } catch (err) {
        entry.status = "failed";
        entry.error = (err as Error).message;
        manifest.errors.push(`page ${entry.name}: ${entry.error}`);
        log(`✗ ${entry.name}: ${entry.error}`);
      }
      manifest.pages.push(entry);
    }
  }

  if (has("imageFills") && imageHashes.size) {
    const hashes = [...imageHashes];
    let count = 0;
    let failed = 0;
    for (let i = 0; i < hashes.length; i += FILL_BATCH) {
      try {
        const result = await request<{ images: Record<string, any>[] }>(
          sender,
          "export_image_fills",
          {
            params: { hashes: hashes.slice(i, i + FILL_BATCH) },
            fileKey,
          }
        );
        for (const image of result.images) {
          if (image.error) {
            failed++;
            continue;
          }
          await write(
            outDir,
            `images/fills/${image.hash}.${extensionFor(image.mime)}`,
            Buffer.from(image.base64, "base64")
          );
          count++;
        }
      } catch (err) {
        failed += Math.min(FILL_BATCH, hashes.length - i);
        manifest.errors.push(`image fills: ${(err as Error).message}`);
      }
    }
    manifest.imageFills = { dir: "images/fills", count, failed };
    log(`✓ image fills: ${count}${failed ? ` (${failed} failed)` : ""}`);
  }

  await write(outDir, "manifest.json", json(manifest));
  await write(outDir, "index.md", renderIndex(manifest));
  log(
    `Wrote ${path.join(outDir, "index.md")}${manifest.errors.length ? ` with ${manifest.errors.length} error(s)` : ""}`
  );
  return manifest;
}
