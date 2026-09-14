import { componentRef } from "./components";
import { ancestorPath, compact, safe } from "./safe";

const VECTOR_TYPES = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "LINE",
  "ELLIPSE",
  "POLYGON",
  "RECTANGLE",
]);

export type AssetCriteria = {
  /** Node types to consider, e.g. ["COMPONENT"] or ["COMPONENT", "FRAME", "GROUP", "INSTANCE"]. */
  types: NodeType[];
  /** Largest width or height, in px, an asset may have. */
  maxSize: number;
  /** Allow image fills inside an asset (e.g. illustrations, logos with bitmaps). */
  includeImages: boolean;
  /** Also return any node that has export settings, whatever its content. */
  includeExportSettings: boolean;
};

type ContentStats = { vectors: number; texts: number; images: number };

const contentStats = (
  node: SceneNode,
  stats: ContentStats = { vectors: 0, texts: 0, images: 0 }
) => {
  if (node.visible === false) return stats;
  if (node.type === "TEXT") {
    stats.texts++;
    return stats;
  }
  if (VECTOR_TYPES.has(node.type)) stats.vectors++;
  const fills = safe(() => (node as GeometryMixin).fills);
  if (
    Array.isArray(fills) &&
    fills.some((paint: Paint) => paint.type === "IMAGE" && paint.visible !== false)
  ) {
    stats.images++;
  }
  // Boolean operations are vectors as a whole; their operands don't need counting.
  if (node.type !== "BOOLEAN_OPERATION" && "children" in node) {
    for (const child of node.children) {
      contentStats(child, stats);
      if (stats.texts > 0) break;
    }
  }
  return stats;
};

const hasExportSettings = (node: BaseNode) =>
  (safe(() => (node as SceneNode & ExportMixin).exportSettings.length) ?? 0) > 0;

/**
 * Finds icon/logo/illustration-like assets in any file, with no naming assumptions: nodes of the given
 * types whose visible content is only vector shapes (no text, and no images unless allowed) and that
 * fit within `maxSize`, plus nodes with export settings when requested. A node inside an asset that
 * was already found is skipped. Paginated with `cursor` over the candidate list.
 */
export const findAssets = async (
  scope: PageNode | SceneNode,
  criteria: AssetCriteria,
  cursor: number,
  limit: number,
  budgetMs: number
) => {
  if (scope.type === "PAGE") await scope.loadAsync();
  const started = Date.now();
  const container = scope as ChildrenMixin;
  const byType =
    "findAllWithCriteria" in scope ? container.findAllWithCriteria({ types: criteria.types }) : [];
  const withExports =
    criteria.includeExportSettings && "findAll" in scope
      ? container.findAll(hasExportSettings)
      : [];
  const seen = new Set<string>();
  const candidates = [...byType, ...withExports].filter((node) =>
    seen.has(node.id) ? false : (seen.add(node.id), true)
  );

  const assetIds = new Set<string>();
  const insideAsset = (node: BaseNode) => {
    for (let parent = node.parent; parent && parent.id !== scope.id; parent = parent.parent) {
      if (assetIds.has(parent.id)) return true;
    }
    return false;
  };

  const assets: Record<string, unknown>[] = [];
  let index = cursor;
  for (; index < candidates.length; index++) {
    if (assets.length >= limit || Date.now() - started > budgetMs) break;
    const node = candidates[index] as SceneNode;
    if (node.visible === false || insideAsset(node)) continue;

    const exportable = hasExportSettings(node);
    const size = Math.max(node.width, node.height);
    let reason: string | undefined;
    let stats: ContentStats | undefined;
    if (size <= criteria.maxSize) {
      stats = contentStats(node);
      if (
        stats.texts === 0 &&
        stats.vectors > 0 &&
        (criteria.includeImages || stats.images === 0)
      ) {
        reason = stats.images > 0 ? "vector-and-image" : "vector-only";
      }
    }
    if (!reason && criteria.includeExportSettings && exportable) reason = "export-settings";
    if (!reason) continue;

    assetIds.add(node.id);
    assets.push(
      compact({
        id: node.id,
        name: node.name,
        type: node.type,
        width: node.width,
        height: node.height,
        path: ancestorPath(node),
        reason,
        vectors: stats?.vectors,
        images: stats?.images || undefined,
        exportSettings: exportable ? true : undefined,
        component: node.type === "COMPONENT" ? componentRef(node) : undefined,
      })
    );
  }

  return {
    scope: { id: scope.id, name: scope.name, type: scope.type },
    candidates: candidates.length,
    assets,
    nextCursor: index < candidates.length ? index : null,
    elapsedMs: Date.now() - started,
  };
};

export type AssetExportFormat = "SVG" | "PNG" | "JPG" | "PDF";

/** Exports nodes as SVG markup (string) or raster/PDF bytes (base64). */
export const exportAssets = async (
  nodeIds: string[],
  format: AssetExportFormat,
  scale: number,
  svgOutlineText: boolean,
  svgIdAttribute: boolean
) => {
  const exports: Record<string, unknown>[] = [];
  for (const id of nodeIds) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || !("exportAsync" in node)) {
      exports.push({ id, error: "Node not found or not exportable" });
      continue;
    }
    const scene = node as SceneNode;
    try {
      if (format === "SVG") {
        const svg = await scene.exportAsync({
          format: "SVG_STRING",
          svgOutlineText,
          svgIdAttribute,
        });
        exports.push({ id, name: scene.name, format, svg });
      } else {
        const settings: ExportSettings =
          format === "PDF" ? { format } : { format, constraint: { type: "SCALE", value: scale } };
        const bytes = await scene.exportAsync(settings);
        exports.push({ id, name: scene.name, format, base64: figma.base64Encode(bytes) });
      }
    } catch (error) {
      exports.push({
        id,
        name: scene.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { exports };
};

const imageMime = (bytes: Uint8Array): string => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45)
    return "image/webp";
  return "application/octet-stream";
};

/** Original bytes of images used as fills, by image hash (from `imageHash` in serialised paints). */
export const exportImageFills = async (hashes: string[]) => {
  const images: Record<string, unknown>[] = [];
  for (const hash of hashes) {
    const image = figma.getImageByHash(hash);
    if (!image) {
      images.push({ hash, error: "Image not found" });
      continue;
    }
    try {
      const bytes = await image.getBytesAsync();
      const size = await image.getSizeAsync().catch(() => null);
      images.push(
        compact({
          hash,
          mime: imageMime(bytes),
          width: size?.width,
          height: size?.height,
          base64: figma.base64Encode(bytes),
        })
      );
    } catch (error) {
      images.push({ hash, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { images };
};
