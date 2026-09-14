import { componentSetSummary, componentSummary, instanceInfo } from "./components";
import { RefResolver } from "./refs";
import { textDetails } from "./text";

/**
 * Adds design-system context to trees produced by the base serializer (get_node, get_selection,
 * get_document, get_design_context): bound variable names (`tokens`), shared styles (`styleRefs`),
 * instance → main component links and property values, component metadata and per-segment text styling.
 * Stops after `budgetMs` and marks the result `enrichmentTruncated` so large reads stay responsive.
 */
export const enrichSerialized = async <T>(data: T, budgetMs = 6000): Promise<T> => {
  const refs = new RefResolver();
  const started = Date.now();
  const roots = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
  const stack = [...roots];
  let truncated = false;

  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.children)) stack.push(...(item.children as Record<string, unknown>[]));
    if (typeof item.id !== "string") continue;
    if (Date.now() - started > budgetMs) {
      truncated = true;
      break;
    }

    const node = await figma.getNodeByIdAsync(item.id);
    if (!node || node.type === "DOCUMENT") continue;

    const tokens = await refs.boundVariables(node);
    if (tokens) item.tokens = tokens;
    const styleRefs = await refs.styleRefs(node);
    if (styleRefs) item.styleRefs = styleRefs;

    if (node.type === "INSTANCE") {
      Object.assign(item, await instanceInfo(node));
    } else if (node.type === "COMPONENT") {
      const { id: _id, name: _name, type: _type, ...meta } = componentSummary(node);
      Object.assign(item, meta);
    } else if (node.type === "COMPONENT_SET") {
      const { id: _id, name: _name, type: _type, ...meta } = componentSetSummary(node, false);
      Object.assign(item, meta);
    } else if (node.type === "TEXT") {
      Object.assign(item, await textDetails(node, refs));
    }
  }

  if (truncated)
    for (const root of roots) if (root && typeof root === "object") root.enrichmentTruncated = true;
  return data;
};
