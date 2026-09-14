import { request, type BridgeSender } from "./client.js";

export interface TreeNode {
  id: string;
  name: string;
  type: string;
  stub?: boolean;
  children?: TreeNode[];
  [key: string]: unknown;
}

export interface SubtreeParams {
  depth?: number;
  maxNodes?: number;
  budgetMs?: number;
  includeHidden?: boolean;
}

/**
 * Reads a complete node tree through `export_subtree`. The plugin answers in bounded chunks and marks
 * what it didn't reach with `stub: true`; each stub is fetched in turn and spliced in, one request at a
 * time, until nothing is left. Omit `nodeId` for the current page.
 */
export async function exportTree(
  sender: BridgeSender,
  nodeId: string | undefined,
  fileKey: string | undefined,
  params: SubtreeParams,
  onRequest?: () => void
): Promise<TreeNode> {
  const fetchRoot = async (id: string | undefined): Promise<TreeNode> => {
    onRequest?.();
    const result = await request<{ root: TreeNode }>(sender, "export_subtree", {
      nodeIds: id ? [id] : undefined,
      params: { ...params },
      fileKey,
    });
    return result.root;
  };

  const expand = async (node: TreeNode): Promise<void> => {
    if (!node.children) return;
    for (let i = 0; i < node.children.length; i++) {
      if (node.children[i].stub) node.children[i] = await fetchRoot(node.children[i].id);
      await expand(node.children[i]);
    }
  };

  const root = await fetchRoot(nodeId);
  await expand(root);
  return root;
}

/** Visits every node in a tree, depth first. */
export function walkTree(node: TreeNode, visit: (node: TreeNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkTree(child, visit);
}
