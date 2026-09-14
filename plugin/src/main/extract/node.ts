import { getBounds, serializePaints, serializeStyles, serializeText } from "../serializer";
import { componentSetSummary, componentSummary, instanceInfo } from "./components";
import type { RefResolver } from "./refs";
import { compact, isMixed, safe, sanitize } from "./safe";
import { textDetails } from "./text";

/**
 * Layout properties beyond the base serializer: sizing modes, min/max, absolute positioning, grid layout,
 * per-side strokes and layout grids. Only properties the node actually has are included.
 */
const LAYOUT_PROPS = [
  "layoutMode",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "layoutPositioning",
  "layoutAlign",
  "layoutGrow",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "itemReverseZIndex",
  "strokesIncludedInLayout",
  "gridRowCount",
  "gridColumnCount",
  "gridRowGap",
  "gridColumnGap",
  "gridRowSizes",
  "gridColumnSizes",
  "gridRowAnchorIndex",
  "gridColumnAnchorIndex",
  "gridRowSpan",
  "gridColumnSpan",
  "gridChildHorizontalAlign",
  "gridChildVerticalAlign",
  "strokeTopWeight",
  "strokeRightWeight",
  "strokeBottomWeight",
  "strokeLeftWeight",
  "strokeCap",
  "strokeJoin",
  "layoutGrids",
] as const;

const layoutDetails = (node: BaseNode): Record<string, unknown> | undefined => {
  const out: Record<string, unknown> = {};
  const source = node as unknown as Record<string, unknown>;
  for (const prop of LAYOUT_PROPS) {
    if (!(prop in node)) continue;
    const value = safe(() => source[prop]);
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[prop] = isMixed(value) ? "mixed" : sanitize(value);
  }
  return Object.keys(out).length ? out : undefined;
};

const reactionDetails = (node: BaseNode) =>
  safe(() =>
    (node as SceneNode & ReactionMixin).reactions.map((reaction) =>
      sanitize({
        trigger: reaction.trigger,
        actions: reaction.actions ?? (reaction.action ? [reaction.action] : []),
      })
    )
  );

const annotationDetails = (node: BaseNode) =>
  safe(() =>
    (node as SceneNode & { annotations: readonly Annotation[] }).annotations.map((annotation) =>
      compact({
        label: annotation.label,
        labelMarkdown: annotation.labelMarkdown,
        properties: annotation.properties?.map((property) => property.type),
        categoryId: annotation.categoryId,
      })
    )
  );

/**
 * One node, fully described but without children: geometry and styles, text content and per-segment
 * styling, the variables bound to each property, shared styles, component metadata, instance links,
 * layout details, prototype reactions, annotations and export settings.
 */
export const nodeRecord = async (
  node: SceneNode | PageNode,
  refs: RefResolver
): Promise<Record<string, unknown>> => {
  let record: Record<string, unknown> = { id: node.id, name: node.name, type: node.type };

  if (node.type === "PAGE") {
    const backgrounds = safe(() => serializePaints(node.backgrounds));
    if (backgrounds) record.backgrounds = backgrounds;
  } else {
    record.bounds = getBounds(node);
    record.styles = safe(() => serializeStyles(node)) ?? {};
    if (node.type === "TEXT") {
      record =
        (safe(() => serializeText(node, record as never)) as Record<string, unknown>) ?? record;
      Object.assign(record, await textDetails(node, refs));
      // The base serializer reports "mixed" whenever fontName is a symbol; use the segment summary instead.
      const font = record.font as Record<string, unknown> | undefined;
      const styles = record.styles as Record<string, unknown>;
      if (font && styles.fontFamily === "mixed" && font.family !== "mixed")
        styles.fontFamily = font.family;
      if (font && styles.fontStyle === "mixed" && font.style !== "mixed")
        styles.fontStyle = font.style;
    }
    if (node.visible === false) record.hidden = true;
    if (safe(() => node.locked)) record.locked = true;
  }

  const tokens = await refs.boundVariables(node);
  if (tokens) record.tokens = tokens;
  const styleRefs = await refs.styleRefs(node);
  if (styleRefs) record.styleRefs = styleRefs;

  if (node.type === "INSTANCE") {
    Object.assign(record, await instanceInfo(node));
  } else if (node.type === "COMPONENT") {
    const { id: _id, name: _name, type: _type, path: _path, ...meta } = componentSummary(node);
    Object.assign(record, meta);
  } else if (node.type === "COMPONENT_SET") {
    const {
      id: _id,
      name: _name,
      type: _type,
      path: _path,
      ...meta
    } = componentSetSummary(node, false);
    Object.assign(record, meta);
  }

  const layout = layoutDetails(node);
  if (layout) record.layout = layout;
  const reactions = reactionDetails(node);
  if (reactions?.length) record.reactions = reactions;
  const annotations = annotationDetails(node);
  if (annotations?.length) record.annotations = annotations;
  const exportSettings = safe(() => (node as SceneNode & ExportMixin).exportSettings);
  if (exportSettings?.length) record.exportSettings = sanitize(exportSettings);
  if (safe(() => (node as SceneNode & { isMask?: boolean }).isMask)) record.isMask = true;

  return record;
};
