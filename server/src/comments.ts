/**
 * Server-side Figma Comments support.
 *
 * The Figma Plugin API cannot read file comments (they are file metadata,
 * only exposed via the REST API), so these helpers call
 * `GET /v1/files/:key/comments` directly from the MCP server using a
 * personal access token (`FIGMA_ACCESS_TOKEN`).
 *
 * Comment `client_meta` carries the pin location:
 *   - Vector:            { x, y } (absolute canvas)
 *   - FrameOffset:       { node_id, node_offset: { x, y } }
 *   - Region / FrameOffsetRegion add a region box.
 * Filtering by frame/node therefore means matching `client_meta.node_id`
 * against the requested node IDs (replies inherit the thread's location).
 */

export interface FigmaCommentUser {
  id: string;
  handle: string;
  img_url: string;
}

export interface FigmaComment {
  id: string;
  file_key: string;
  parent_id: string;
  user: FigmaCommentUser;
  created_at: string;
  resolved_at: string | null;
  message: string;
  client_meta: {
    x?: number;
    y?: number;
    node_id?: string;
    node_offset?: { x: number; y: number };
    region_x?: number;
    region_y?: number;
    region_width?: number;
    region_height?: number;
  } | null;
  order_id?: number;
  reactions?: unknown[];
}

export interface FormattedComment {
  id: string;
  message: string;
  author: string;
  createdAt: string;
  resolvedAt: string | null;
  isResolved: boolean;
  parentId: string | null;
  isReply: boolean;
  orderId?: number;
  nodeId: string | null;
  position: { x: number; y: number } | null;
}

export interface CommentThread {
  rootComment: FormattedComment;
  replies: FormattedComment[];
}

export interface GetCommentsOptions {
  fileKey: string;
  /** Include resolved comments (default true). */
  includeResolved?: boolean;
  /** Only return comments pinned to these node IDs (frames). Replies included. */
  nodeIds?: string[];
  /** Max comments to return after filtering (default 50). */
  limit?: number;
  /** Return comment bodies as markdown (default false). */
  asMd?: boolean;
}

export interface GetCommentsResult {
  fileKey: string;
  total: number;
  unresolvedCount: number;
  resolvedCount: number;
  threads: CommentThread[];
}

const FIGMA_API_BASE = "https://api.figma.com";
const DEFAULT_LIMIT = 50;

/**
 * Resolves the Figma personal access token from the environment.
 * @returns The configured token.
 */
export function getCommentsAccessToken(): string {
  const token =
    process.env.FIGMA_ACCESS_TOKEN ??
    process.env.FIGMA_TOKEN ??
    process.env.FIGMA_PERSONAL_ACCESS_TOKEN ??
    "";
  if (!token.trim()) {
    throw new Error(
      "Figma comments require a personal access token (scopes: file_comments:read, files:read). Save it in the plugin UI's API token field, or set FIGMA_ACCESS_TOKEN and retry."
    );
  }
  return token.trim();
}

/**
 * Checks whether a bridge fileKey is a session fallback rather than a real
 * Figma file key (used for unsaved files or when `figma.fileKey` is hidden).
 * @param fileKey - Bridge file key to inspect.
 * @returns True when the key cannot be used against the REST API.
 */
export function isFallbackFileKey(fileKey: string): boolean {
  return fileKey.startsWith("unsaved-");
}

/**
 * Resolves which file key to use for a REST comments call.
 * @param connectedFiles - Files currently connected via the bridge.
 * @param requestedKey - Explicit fileKey param (may be undefined).
 * @returns The file key to query.
 */
export function resolveCommentsFileKey(
  connectedFiles: Array<{ fileKey: string; fileName: string }>,
  requestedKey?: string
): string {
  if (requestedKey) return requestedKey;
  if (connectedFiles.length === 0) {
    throw new Error(
      "No plugin connected. Open a Figma file and run the bridge plugin, or pass fileKey explicitly (from the Figma file URL)."
    );
  }
  if (connectedFiles.length === 1) {
    return connectedFiles[0].fileKey;
  }
  throw new Error(
    `Multiple files connected. Specify a fileKey to choose which file to query. Connected files: ${connectedFiles
      .map((f) => `"${f.fileName}" (fileKey: ${f.fileKey})`)
      .join(", ")}. Use the list_files tool to see all connected files.`
  );
}

/**
 * Fetches raw comments for a file via the Figma REST API.
 * @param fileKey - Real Figma file key (from the file URL).
 * @param token - Personal access token with file_comments:read.
 * @param asMd - Return bodies as markdown equivalents.
 * @returns Raw comment list.
 */
export async function fetchRawComments(
  fileKey: string,
  token: string,
  asMd = false
): Promise<FigmaComment[]> {
  const url = `${FIGMA_API_BASE}/v1/files/${encodeURIComponent(fileKey)}/comments${
    asMd ? "?as_md=true" : ""
  }`;
  const response = await fetch(url, {
    headers: { "X-Figma-Token": token },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 403) {
    throw new Error(
      "Figma rejected the comments request (403). Check that FIGMA_ACCESS_TOKEN is valid and has the file_comments:read scope."
    );
  }
  if (response.status === 404) {
    throw new Error(
      `Figma file not found for comments lookup: "${fileKey}". Pass the file key from the Figma file URL.`
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch Figma comments: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as { comments?: FigmaComment[] };
  return body.comments ?? [];
}

/**
 * Formats a raw REST comment into the bridge's comment shape.
 * @param comment - Raw Figma REST comment.
 * @returns Formatted comment.
 */
export function formatComment(comment: FigmaComment): FormattedComment {
  const meta = comment.client_meta;
  const nodeId = typeof meta?.node_id === "string" ? meta.node_id : null;
  const position =
    meta && typeof meta.x === "number" && typeof meta.y === "number"
      ? { x: meta.x, y: meta.y }
      : meta?.node_offset
        ? { x: meta.node_offset.x, y: meta.node_offset.y }
        : null;
  return {
    id: comment.id,
    message: comment.message,
    author: comment.user?.handle ?? "unknown",
    createdAt: comment.created_at,
    resolvedAt: comment.resolved_at ?? null,
    isResolved: Boolean(comment.resolved_at),
    parentId: comment.parent_id || null,
    isReply: Boolean(comment.parent_id),
    orderId: comment.order_id,
    nodeId,
    position,
  };
}

/**
 * Groups flat comments into threads (root + replies).
 * @param comments - Formatted comments (already filtered/limited).
 * @param allComments - Full formatted list, used to attach replies whose root was filtered out.
 * @returns Threads ordered with unresolved first, then by creation time.
 */
export function groupIntoThreads(
  comments: FormattedComment[],
  allComments: FormattedComment[] = comments
): CommentThread[] {
  const repliesByParent = new Map<string, FormattedComment[]>();
  for (const comment of allComments) {
    if (!comment.parentId) continue;
    const list = repliesByParent.get(comment.parentId) ?? [];
    list.push(comment);
    repliesByParent.set(comment.parentId, list);
  }
  const roots = comments.filter((c) => !c.isReply);
  const threads = roots.map((root) => ({
    rootComment: root,
    replies: repliesByParent.get(root.id) ?? [],
  }));
  threads.sort((a, b) => {
    if (a.rootComment.isResolved !== b.rootComment.isResolved) {
      return a.rootComment.isResolved ? 1 : -1;
    }
    return a.rootComment.createdAt.localeCompare(b.rootComment.createdAt);
  });
  return threads;
}

/**
 * Fetches, filters, and threads comments for a file.
 * Node filtering matches `client_meta.node_id`; replies are kept whenever
 * their root thread matches (or when no node filter is given).
 * @param options - Fetch/filter options (fileKey required).
 * @param token - Optional token override (defaults to env).
 * @returns Threaded, filtered comments.
 */
export async function getComments(
  options: GetCommentsOptions,
  token?: string
): Promise<GetCommentsResult> {
  const accessToken = token ?? getCommentsAccessToken();
  if (isFallbackFileKey(options.fileKey)) {
    throw new Error(
      `Comments need the real Figma file key from the file URL, but got session key "${options.fileKey}". Pass the fileKey explicitly (copy it from https://www.figma.com/design/<fileKey>/...).`
    );
  }
  const raw = await fetchRawComments(options.fileKey, accessToken, options.asMd ?? false);
  const formatted = raw.map(formatComment);

  const unresolvedCount = formatted.filter((c) => !c.isResolved).length;
  const resolvedCount = formatted.length - unresolvedCount;

  let filtered = formatted;
  if (options.includeResolved === false) {
    // Keep replies whose parent thread is unresolved so threads stay intact.
    const unresolvedRoots = new Set(
      formatted.filter((c) => !c.isReply && !c.isResolved).map((c) => c.id)
    );
    filtered = filtered.filter(
      (c) => !c.isResolved || (c.isReply && c.parentId !== null && unresolvedRoots.has(c.parentId))
    );
  }

  const nodeFilter = options.nodeIds?.filter((id) => id.length > 0) ?? [];
  if (nodeFilter.length > 0) {
    const wanted = new Set(nodeFilter);
    const matchingRoots = new Set(
      filtered
        .filter((c) => !c.isReply && c.nodeId !== null && wanted.has(c.nodeId))
        .map((c) => c.id)
    );
    filtered = filtered.filter(
      (c) =>
        (c.nodeId !== null && wanted.has(c.nodeId)) ||
        (c.isReply && c.parentId !== null && matchingRoots.has(c.parentId)) ||
        // Some pins only carry absolute x/y (no node_id): keep them out of a
        // node-scoped query rather than mis-attributing them.
        false
    );
  }

  // Emit whole threads within the budget so `total` always equals the
  // number of comments actually returned (roots + attached replies).
  const budget = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const emitted: CommentThread[] = [];
  let total = 0;
  for (const thread of groupIntoThreads(filtered)) {
    if (total >= budget) break;
    const replies = thread.replies.slice(0, Math.max(0, budget - total - 1));
    emitted.push({ rootComment: thread.rootComment, replies });
    total += 1 + replies.length;
  }

  return {
    fileKey: options.fileKey,
    total,
    unresolvedCount,
    resolvedCount,
    threads: emitted,
  };
}
