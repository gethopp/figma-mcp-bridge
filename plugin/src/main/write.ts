import { serializeNode } from "./serializer";

const PLUGIN_NS = "codex";
const MANAGED_KEY = "managed";
const NODE_KEY = "key";

type RequestParams = Record<string, unknown> | undefined;

type MutationError = {
  code: string;
  message: string;
  details?: unknown;
};

type MutationResult = {
  nodeId: string;
  type: string;
  name: string;
  parentId?: string;
  key?: string;
  node: ReturnType<typeof serializeNode>;
};

type BatchOperation = {
  type: string;
  nodeId?: string;
  nodeIds?: string[];
  params?: Record<string, unknown>;
  ref?: string;
};

type BatchContext = {
  refs: Map<string, string>;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fail(code: string, message: string, details?: unknown): never {
  throw Object.assign(new Error(message), {
    mutationError: { code, message, details } satisfies MutationError,
  });
}

function toMutationError(error: unknown): MutationError {
  if (isObject(error) && "mutationError" in error) {
    return (error as { mutationError: MutationError }).mutationError;
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: String(error) };
}

function getString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("INVALID_INPUT", `${field} must be a non-empty string`);
  }
  return value;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail("INVALID_INPUT", `${field} must be a number`);
  }
  return value;
}

function hexToRGBA(value: string): RGBA {
  const hex = value.replace("#", "");
  if (hex.length !== 6 && hex.length !== 8) {
    fail("INVALID_COLOR", `Invalid color: ${value}`);
  }
  const parse = (start: number) => parseInt(hex.slice(start, start + 2), 16) / 255;
  return {
    r: parse(0),
    g: parse(2),
    b: parse(4),
    a: hex.length === 8 ? parse(6) : 1,
  };
}

function toSolidPaints(value: unknown): SolidPaint[] {
  if (!Array.isArray(value)) {
    fail("INVALID_INPUT", "Paint list must be an array");
  }
  return value.map((paint) => {
    if (!isObject(paint) || paint.type !== "SOLID") {
      fail("UNSUPPORTED_PAINT", "Only SOLID paints are supported in V1");
    }
    const rgba = hexToRGBA(getString(paint.color, "color"));
    const opacity =
      typeof paint.opacity === "number" ? paint.opacity : rgba.a ?? 1;
    return {
      type: "SOLID",
      color: { r: rgba.r, g: rgba.g, b: rgba.b },
      opacity,
    };
  });
}

function setPluginData(node: BaseNode, key?: string): void {
  if (!("setSharedPluginData" in node)) return;
  node.setSharedPluginData(PLUGIN_NS, MANAGED_KEY, "true");
  if (key) {
    node.setSharedPluginData(PLUGIN_NS, NODE_KEY, key);
  }
}

function getPluginKey(node: BaseNode): string | undefined {
  if (!("getSharedPluginData" in node)) return undefined;
  const key = node.getSharedPluginData(PLUGIN_NS, NODE_KEY);
  return key || undefined;
}

function isOnCurrentPage(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE" && current.parent) {
    current = current.parent;
  }
  return current?.type === "PAGE" && current.id === figma.currentPage.id;
}

function ensureSceneNode(node: BaseNode | null, field: string): SceneNode {
  if (!node || node.type === "DOCUMENT" || node.type === "PAGE") {
    fail("NOT_FOUND", `${field} was not found`);
  }
  if (!isOnCurrentPage(node)) {
    fail("OUT_OF_SCOPE", "Mutations are restricted to the current page");
  }
  return node as SceneNode;
}

async function getNodeById(nodeId: string, field = "nodeId"): Promise<SceneNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  return ensureSceneNode(node, field);
}

async function getParentNode(parentId?: string): Promise<(BaseNode & ChildrenMixin) | PageNode> {
  if (!parentId) return figma.currentPage;
  const node = await getNodeById(parentId, "parentId");
  if (!("appendChild" in node)) {
    fail("INVALID_PARENT", "parentId must reference a node that can contain children");
  }
  return node;
}

function setName(node: SceneNode, name: unknown, fallback: string): void {
  node.name = getOptionalString(name) ?? fallback;
}

function applyPosition(node: SceneNode, params: RequestParams): void {
  if (params?.x !== undefined && params?.y !== undefined) {
    node.x = getNumber(params.x, "x");
    node.y = getNumber(params.y, "y");
  }
}

function applySize(node: SceneNode, params: RequestParams): void {
  if (params?.width !== undefined && params?.height !== undefined) {
    if (!("resize" in node)) {
      fail("UNSUPPORTED_NODE", "resize is not supported for this node");
    }
    node.resize(getNumber(params.width, "width"), getNumber(params.height, "height"));
  }
}

function applyFills(node: SceneNode, fills: unknown): void {
  if (fills === undefined) return;
  if (!("fills" in node)) {
    fail("UNSUPPORTED_NODE", "fills are not supported for this node");
  }
  node.fills = toSolidPaints(fills);
}

function applyStrokes(node: SceneNode, strokes: unknown): void {
  if (strokes === undefined) return;
  if (!("strokes" in node)) {
    fail("UNSUPPORTED_NODE", "strokes are not supported for this node");
  }
  node.strokes = toSolidPaints(strokes);
}

function applyCornerRadius(node: SceneNode, cornerRadius: unknown): void {
  if (cornerRadius === undefined) return;
  if (!("cornerRadius" in node)) {
    fail("UNSUPPORTED_NODE", "cornerRadius is not supported for this node");
  }
  (node as SceneNode & { cornerRadius: number }).cornerRadius = getNumber(
    cornerRadius,
    "cornerRadius"
  );
}

function applyLayoutMode(node: SceneNode, layoutMode: unknown): void {
  if (layoutMode === undefined) return;
  if (!("layoutMode" in node)) {
    fail("UNSUPPORTED_NODE", "layoutMode is not supported for this node");
  }
  node.layoutMode = getString(layoutMode, "layoutMode") as FrameNode["layoutMode"];
}

function applyPadding(node: SceneNode, padding: unknown): void {
  if (padding === undefined) return;
  if (!("paddingTop" in node) || !isObject(padding)) {
    fail("UNSUPPORTED_NODE", "padding is not supported for this node");
  }
  node.paddingTop = typeof padding.top === "number" ? padding.top : 0;
  node.paddingRight = typeof padding.right === "number" ? padding.right : 0;
  node.paddingBottom = typeof padding.bottom === "number" ? padding.bottom : 0;
  node.paddingLeft = typeof padding.left === "number" ? padding.left : 0;
}

function applyItemSpacing(node: SceneNode, itemSpacing: unknown): void {
  if (itemSpacing === undefined) return;
  if (!("itemSpacing" in node)) {
    fail("UNSUPPORTED_NODE", "itemSpacing is not supported for this node");
  }
  node.itemSpacing = getNumber(itemSpacing, "itemSpacing");
}

async function loadFont(node: TextNode, style?: Record<string, unknown>): Promise<FontName> {
  const fontFamily = getOptionalString(style?.fontFamily);
  const fontStyle = getOptionalString(style?.fontStyle);

  if (typeof node.fontName === "symbol") {
    if (fontFamily || fontStyle) {
      const base = node.getRangeAllFontNames(0, node.characters.length)[0] ?? {
        family: "Inter",
        style: "Regular",
      };
      const font: FontName = {
        family: fontFamily ?? base.family,
        style: fontStyle ?? base.style,
      };
      await figma.loadFontAsync(font);
      return font;
    }

    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    const uniqueFonts = new Map(fonts.map((font) => [`${font.family}::${font.style}`, font]));
    for (const font of uniqueFonts.values()) {
      await figma.loadFontAsync(font);
    }
    return fonts[0] ?? { family: "Inter", style: "Regular" };
  }

  const font: FontName = {
    family: fontFamily ?? node.fontName.family,
    style: fontStyle ?? node.fontName.style,
  };
  await figma.loadFontAsync(font);
  return font;
}

async function applyTextStyle(node: TextNode, style: unknown): Promise<void> {
  if (style === undefined) return;
  if (!isObject(style)) {
    fail("INVALID_INPUT", "style must be an object");
  }
  const nextFont = await loadFont(node, style);
  if (getOptionalString(style.fontFamily) || getOptionalString(style.fontStyle)) {
    node.fontName = nextFont;
  }
  if (typeof style.fontSize === "number") node.fontSize = style.fontSize;
  if (typeof style.textDecoration === "string") {
    node.textDecoration = style.textDecoration as TextDecoration;
  }
  if (typeof style.textAlignHorizontal === "string") {
    node.textAlignHorizontal = style.textAlignHorizontal as typeof node.textAlignHorizontal;
  }
  if (typeof style.textAlignVertical === "string") {
    node.textAlignVertical = style.textAlignVertical as typeof node.textAlignVertical;
  }
  if (typeof style.textAutoResize === "string") {
    node.textAutoResize = style.textAutoResize as typeof node.textAutoResize;
  }
  if (isObject(style.lineHeight)) {
    node.lineHeight = {
      unit:
        typeof style.lineHeight.unit === "string"
          ? (style.lineHeight.unit as "PIXELS" | "PERCENT")
          : "PIXELS",
      value:
        typeof style.lineHeight.value === "number" ? style.lineHeight.value : 0,
    };
  }
  if (isObject(style.letterSpacing)) {
    node.letterSpacing = {
      unit:
        typeof style.letterSpacing.unit === "string"
          ? (style.letterSpacing.unit as "PIXELS" | "PERCENT")
          : "PIXELS",
      value:
        typeof style.letterSpacing.value === "number"
          ? style.letterSpacing.value
          : 0,
    };
  }
}

async function applyTextContent(node: TextNode, characters: unknown): Promise<void> {
  await loadFont(node);
  if (characters !== undefined && characters !== null && typeof characters !== "string") {
    fail("INVALID_INPUT", "characters must be a string");
  }
  node.characters = typeof characters === "string" ? characters : "";
}

function toMutationResult(node: SceneNode): MutationResult {
  return {
    nodeId: node.id,
    type: node.type,
    name: node.name,
    parentId: node.parent && node.parent.type !== "DOCUMENT" ? node.parent.id : undefined,
    key: getPluginKey(node),
    node: serializeNode(node),
  };
}

async function createFrame(params: RequestParams): Promise<MutationResult> {
  const parent = await getParentNode(getOptionalString(params?.parentId));
  const node = figma.createFrame();
  try {
    setName(node, params?.name, "Frame");
    applyPosition(node, params);
    applySize(node, params);
    applyFills(node, params?.fills);
    applyStrokes(node, params?.strokes);
    applyCornerRadius(node, params?.cornerRadius);
    applyLayoutMode(node, params?.layoutMode);
    applyPadding(node, params?.padding);
    applyItemSpacing(node, params?.itemSpacing);
    setPluginData(node, getOptionalString(params?.key));
    parent.appendChild(node);
    return toMutationResult(node);
  } catch (error) {
    node.remove();
    throw error;
  }
}

async function createText(params: RequestParams): Promise<MutationResult> {
  const parent = await getParentNode(getOptionalString(params?.parentId));
  const node = figma.createText();
  try {
    setName(node, params?.name, "Text");
    applyPosition(node, params);
    applySize(node, params);
    await applyTextStyle(node, params?.style);
    await applyTextContent(node, params?.characters);
    applyFills(node, params?.fills);
    setPluginData(node, getOptionalString(params?.key));
    parent.appendChild(node);
    return toMutationResult(node);
  } catch (error) {
    node.remove();
    throw error;
  }
}

async function createRectangle(params: RequestParams): Promise<MutationResult> {
  const parent = await getParentNode(getOptionalString(params?.parentId));
  const node = figma.createRectangle();
  try {
    setName(node, params?.name, "Rectangle");
    applyPosition(node, params);
    applySize(node, params);
    applyFills(node, params?.fills);
    applyStrokes(node, params?.strokes);
    applyCornerRadius(node, params?.cornerRadius);
    setPluginData(node, getOptionalString(params?.key));
    parent.appendChild(node);
    return toMutationResult(node);
  } catch (error) {
    node.remove();
    throw error;
  }
}

async function appendChildren(params: RequestParams): Promise<unknown> {
  const parent = await getNodeById(getString(params?.parentId, "parentId"));
  if (!("appendChild" in parent)) {
    fail("INVALID_PARENT", "parentId must reference a container node");
  }
  if (!Array.isArray(params?.childIds)) {
    fail("INVALID_INPUT", "childIds must be an array");
  }
  const children: MutationResult[] = [];
  for (const childId of params.childIds) {
    const child = await getNodeById(getString(childId, "childId"));
    parent.appendChild(child);
    children.push(toMutationResult(child));
  }
  return {
    parent: toMutationResult(parent),
    children,
  };
}

function collectNodes(root: ChildrenMixin, acc: SceneNode[]): void {
  for (const child of root.children) {
    acc.push(child);
    if ("children" in child) {
      collectNodes(child, acc);
    }
  }
}

async function findNodes(params: RequestParams): Promise<unknown> {
  const nodes: SceneNode[] = [];
  collectNodes(figma.currentPage, nodes);
  let matches = nodes;
  const nodeId = getOptionalString(params?.nodeId);
  const name = getOptionalString(params?.name);
  const key = getOptionalString(params?.key);
  const parentId = getOptionalString(params?.parentId);
  if (nodeId) matches = matches.filter((node) => node.id === nodeId);
  if (name) matches = matches.filter((node) => node.name === name);
  if (key) matches = matches.filter((node) => getPluginKey(node) === key);
  if (parentId) matches = matches.filter((node) => node.parent?.id === parentId);
  return { matches: matches.map((node) => toMutationResult(node)) };
}

async function deleteNode(params: RequestParams): Promise<unknown> {
  const node = await getNodeById(getString(params?.nodeId, "nodeId"));
  node.remove();
  return { deleted: node.id };
}

async function mutateNode(
  params: RequestParams,
  mutator: (node: SceneNode) => Promise<void> | void
): Promise<MutationResult> {
  const node = await getNodeById(getString(params?.nodeId, "nodeId"));
  await mutator(node);
  return toMutationResult(node);
}

async function executeWrite(type: string, nodeIds: string[] | undefined, params: RequestParams): Promise<unknown> {
  const merged: Record<string, unknown> = {
    ...(params ?? {}),
    nodeId: nodeIds?.[0] ?? params?.nodeId,
  };
  switch (type) {
    case "create_frame":
      return createFrame(params);
    case "create_text":
      return createText(params);
    case "create_rectangle":
      return createRectangle(params);
    case "append_children":
      return appendChildren(params);
    case "set_position":
      return mutateNode(merged, (node) => {
        node.x = getNumber(merged.x, "x");
        node.y = getNumber(merged.y, "y");
      });
    case "set_size":
      return mutateNode(merged, (node) => {
        if (!("resize" in node)) fail("UNSUPPORTED_NODE", "resize is not supported for this node");
        node.resize(getNumber(merged.width, "width"), getNumber(merged.height, "height"));
      });
    case "set_fills":
      return mutateNode(merged, (node) => applyFills(node, merged.fills));
    case "set_strokes":
      return mutateNode(merged, (node) => applyStrokes(node, merged.strokes));
    case "set_corner_radius":
      return mutateNode(merged, (node) => applyCornerRadius(node, merged.cornerRadius));
    case "set_text_content":
      return mutateNode(merged, async (node) => {
        if (node.type !== "TEXT") fail("UNSUPPORTED_NODE", "set_text_content only supports TEXT nodes");
        await applyTextContent(node, merged.characters);
      });
    case "set_text_style":
      return mutateNode(merged, async (node) => {
        if (node.type !== "TEXT") fail("UNSUPPORTED_NODE", "set_text_style only supports TEXT nodes");
        await applyTextStyle(node, merged.style);
      });
    case "set_layout_mode":
      return mutateNode(merged, (node) => applyLayoutMode(node, merged.layoutMode));
    case "set_padding":
      return mutateNode(merged, (node) => applyPadding(node, merged.padding ?? merged));
    case "set_item_spacing":
      return mutateNode(merged, (node) => applyItemSpacing(node, merged.itemSpacing));
    case "find_nodes":
      return findNodes(params);
    case "delete_node":
      return deleteNode(merged);
    default:
      fail("UNKNOWN_WRITE_TOOL", `Unknown write tool: ${type}`);
  }
}

function resolveRef(value: string | undefined, context: BatchContext): string | undefined {
  if (!value || !value.startsWith("tmp:")) return value;
  const resolved = context.refs.get(value);
  if (!resolved) {
    fail("UNKNOWN_REFERENCE", `Unknown batch reference: ${value}`);
  }
  return resolved;
}

function resolveParams(
  params: Record<string, unknown> | undefined,
  context: BatchContext
): Record<string, unknown> | undefined {
  if (!params) return params;
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (typeof value === "string") {
        return [key, resolveRef(value, context) ?? value];
      }
      if (Array.isArray(value)) {
        return [
          key,
          value.map((item) =>
            typeof item === "string" ? resolveRef(item, context) ?? item : item
          ),
        ];
      }
      return [key, value];
    })
  );
}

export async function handleWriteRequest(
  type: string,
  nodeIds: string[] | undefined,
  params: RequestParams
): Promise<unknown> {
  if (type !== "batch_mutation") {
    return executeWrite(type, nodeIds, params);
  }

  if (!Array.isArray(params?.operations) || params.operations.length === 0) {
    fail("INVALID_INPUT", "operations must be a non-empty array");
  }

  const context: BatchContext = { refs: new Map() };
  const results: unknown[] = [];

  for (let index = 0; index < params.operations.length; index++) {
    try {
      const operation = params.operations[index] as BatchOperation;
      const resolvedNodeId = resolveRef(operation.nodeId, context);
      const resolvedNodeIds = operation.nodeIds?.map((id) => resolveRef(id, context) ?? id);
      const resolvedParams = resolveParams(operation.params, context);
      const result = await executeWrite(
        operation.type,
        resolvedNodeIds ?? (resolvedNodeId ? [resolvedNodeId] : undefined),
        resolvedParams
      );
      results.push(result);

      if (isObject(result) && typeof result.nodeId === "string" && operation.ref) {
        context.refs.set(operation.ref, result.nodeId);
      }
    } catch (error) {
      return {
        executedCount: results.length,
        createdRefs: Object.fromEntries(context.refs),
        failedStepIndex: index,
        failure: toMutationError(error),
        results,
      };
    }
  }

  return {
    executedCount: results.length,
    createdRefs: Object.fromEntries(context.refs),
    results,
  };
}

export function serializeWriteError(error: unknown): MutationError {
  return toMutationError(error);
}
