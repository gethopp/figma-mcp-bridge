import { nodeRecord } from "./node";
import type { RefResolver } from "./refs";
import { Budget } from "./safe";

export type SubtreeOptions = {
  /** Maximum depth below the root to expand. */
  depth: number;
  /** Stop expanding after this many nodes. */
  maxNodes: number;
  /** Stop expanding after this many milliseconds. */
  budgetMs: number;
  includeHidden: boolean;
};

type Stub = { id: string; name: string; type: string; stub: true };

/**
 * Serialises a subtree with `nodeRecord`, bounded by depth, node count and time. Anything not reached
 * comes back as a stub (`stub: true`, with `childCount` when the node itself was recorded) that the
 * caller fetches with another request. The request root and its direct children are always expanded,
 * so repeated requests always make progress.
 */
export const exportSubtree = async (
  root: SceneNode | PageNode,
  refs: RefResolver,
  options: SubtreeOptions
) => {
  if (root.type === "PAGE") await root.loadAsync();
  const budget = new Budget(options.maxNodes, options.budgetMs);

  const visit = async (
    node: SceneNode | PageNode,
    depth: number
  ): Promise<Record<string, unknown>> => {
    const record = await nodeRecord(node, refs);
    budget.count++;
    const kids =
      "children" in node
        ? (node.children as readonly SceneNode[]).filter(
            (child) => options.includeHidden || child.visible !== false
          )
        : [];
    if (!kids.length) return record;
    if (depth > 0 && (depth >= options.depth || budget.exceeded)) {
      record.childCount = kids.length;
      record.stub = true;
      return record;
    }
    const children: Array<Record<string, unknown> | Stub> = [];
    for (const child of kids) {
      children.push(
        depth > 0 && budget.exceeded
          ? { id: child.id, name: child.name, type: child.type, stub: true }
          : await visit(child, depth + 1)
      );
    }
    record.children = children;
    return record;
  };

  const tree = await visit(root, 0);
  return { root: tree, nodes: budget.count, elapsedMs: budget.elapsedMs };
};
