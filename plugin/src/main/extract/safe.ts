/**
 * Small helpers shared by the extraction modules.
 */

/** Runs `fn` and returns undefined instead of throwing (some Figma getters throw on certain node types). */
export const safe = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

/** Figma uses a `figma.mixed` symbol for properties that differ across a node's content. */
export const isMixed = (value: unknown): value is symbol => typeof value === "symbol";

/**
 * Deep-copies a value into something `figma.ui.postMessage` can send: `figma.mixed` symbols become
 * the string "mixed". Byte arrays pass through untouched.
 */
export const sanitize = (value: unknown): unknown => {
  if (typeof value === "symbol") return "mixed";
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = sanitize(entry);
    return out;
  }
  return value;
};

/**
 * Bounds a unit of work by node count and wall-clock time. Long synchronous work blocks the plugin's
 * message loop, and Figma gives up loading page data after ~10 s, so every large read runs in chunks.
 */
export class Budget {
  private readonly started = Date.now();
  count = 0;

  constructor(
    readonly maxNodes: number,
    readonly maxMs: number
  ) {}

  get exceeded(): boolean {
    return this.count >= this.maxNodes || Date.now() - this.started > this.maxMs;
  }

  get elapsedMs(): number {
    return Date.now() - this.started;
  }
}

/** Reads a numeric request param, falling back when missing or below `min`. */
export const numberParam = (
  value: unknown,
  fallback: number,
  min = Number.NEGATIVE_INFINITY
): number =>
  typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;

/** Names of the ancestors between the page and `node`, outermost first. */
export const ancestorPath = (node: BaseNode): string[] => {
  const path: string[] = [];
  let current = node.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    path.unshift(current.name);
    current = current.parent;
  }
  return path;
};

/** Returns a copy of `record` without undefined, null, empty-array or empty-object values. */
export const compact = <T extends Record<string, unknown>>(record: T): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Uint8Array) &&
      Object.keys(value).length === 0
    )
      continue;
    out[key] = value;
  }
  return out as Partial<T>;
};
