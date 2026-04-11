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

/** Returns true when a value is a plain object suitable for RPC param inspection. */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Throws a structured mutation error that can be serialized back to the server. */
function fail(code: string, message: string, details?: unknown): never {
  throw Object.assign(new Error(message), {
    mutationError: { code, message, details } satisfies MutationError,
  });
}

/** Normalizes unknown failures into the wire-format mutation error shape. */
function toMutationError(error: unknown): MutationError {
  if (isObject(error) && "mutationError" in error) {
    return (error as { mutationError: MutationError }).mutationError;
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: String(error) };
}

/** Reads a required string field from untyped RPC params. */
function getString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("INVALID_INPUT", `${field} must be a non-empty string`);
  }
  return value;
}

/** Returns a non-empty string when present, otherwise undefined. */
function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Reads a required numeric field from untyped RPC params. */
function getNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail("INVALID_INPUT", `${field} must be a number`);
  }
  return value;
}

/** Reads a positive numeric field from untyped RPC params. */
function getPositiveNumber(value: unknown, field: string): number {
  const number = getNumber(value, field);
  if (number <= 0) {
    fail("INVALID_INPUT", `${field} must be greater than 0`);
  }
  return number;
}

/** Reads a non-negative numeric field from untyped RPC params. */
function getNonnegativeNumber(value: unknown, field: string): number {
  const number = getNumber(value, field);
  if (number < 0) {
    fail("INVALID_INPUT", `${field} must be greater than or equal to 0`);
  }
  return number;
}

/** Reads a Figma node id string in colon-separated format. */
function getFigmaNodeId(value: unknown, field: string): string {
  const nodeId = getString(value, field);
  if (!/^\d+:\d+$/.test(nodeId)) {
    fail("INVALID_INPUT", `${field} must use colon format, e.g. '4029:12345'`);
  }
  return nodeId;
}

/** Reads an optional Figma node id string in colon-separated format. */
function getOptionalFigmaNodeId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return getFigmaNodeId(value, field);
}

/** Reads an optional non-empty string when present. */
function getOptionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return getString(value, field);
}

/** Validates an enum string field against the allowed literals. */
function validateEnum(value: unknown, field: string, allowed: readonly string[]): void {
  const literal = getString(value, field);
  if (!allowed.includes(literal)) {
    fail("INVALID_INPUT", `${field} must be one of: ${allowed.join(", ")}`);
  }
}

/** Validates the shared text style payload shape. */
function validateTextStyle(value: unknown): void {
  if (!isObject(value)) {
    fail("INVALID_INPUT", "style must be an object");
  }
  getOptionalNonEmptyString(value.fontFamily, "style.fontFamily");
  getOptionalNonEmptyString(value.fontStyle, "style.fontStyle");
  if (value.fontSize !== undefined) getPositiveNumber(value.fontSize, "style.fontSize");
  if (value.textDecoration !== undefined) {
    validateEnum(value.textDecoration, "style.textDecoration", [
      "NONE",
      "UNDERLINE",
      "STRIKETHROUGH",
    ]);
  }
  if (value.textAlignHorizontal !== undefined) {
    validateEnum(value.textAlignHorizontal, "style.textAlignHorizontal", [
      "LEFT",
      "CENTER",
      "RIGHT",
      "JUSTIFIED",
    ]);
  }
  if (value.textAlignVertical !== undefined) {
    validateEnum(value.textAlignVertical, "style.textAlignVertical", ["TOP", "CENTER", "BOTTOM"]);
  }
  if (value.textAutoResize !== undefined) {
    validateEnum(value.textAutoResize, "style.textAutoResize", [
      "NONE",
      "WIDTH_AND_HEIGHT",
      "HEIGHT",
      "TRUNCATE",
    ]);
  }
  if (value.lineHeight !== undefined) {
    if (!isObject(value.lineHeight)) {
      fail("INVALID_INPUT", "style.lineHeight must be an object");
    }
    if (value.lineHeight.unit !== undefined) {
      validateEnum(value.lineHeight.unit, "style.lineHeight.unit", ["PIXELS", "PERCENT"]);
    }
    if (value.lineHeight.value !== undefined) {
      getNonnegativeNumber(value.lineHeight.value, "style.lineHeight.value");
    }
  }
  if (value.letterSpacing !== undefined) {
    if (!isObject(value.letterSpacing)) {
      fail("INVALID_INPUT", "style.letterSpacing must be an object");
    }
    if (value.letterSpacing.unit !== undefined) {
      validateEnum(value.letterSpacing.unit, "style.letterSpacing.unit", ["PIXELS", "PERCENT"]);
    }
    if (value.letterSpacing.value !== undefined) {
      getNumber(value.letterSpacing.value, "style.letterSpacing.value");
    }
  }
}

/** Validates the shared padding object shape. */
function validatePaddingObject(value: unknown, field: string): void {
  if (!isObject(value)) {
    fail("INVALID_INPUT", `${field} must be an object`);
  }
  if (value.top !== undefined) getNonnegativeNumber(value.top, `${field}.top`);
  if (value.right !== undefined) getNonnegativeNumber(value.right, `${field}.right`);
  if (value.bottom !== undefined) getNonnegativeNumber(value.bottom, `${field}.bottom`);
  if (value.left !== undefined) getNonnegativeNumber(value.left, `${field}.left`);
}

/** Validates the shared create-node base params shape. */
function validateCreateNodeBase(params: Record<string, unknown>): void {
  getOptionalFigmaNodeId(params.parentId, "parentId");
  getOptionalNonEmptyString(params.name, "name");
  if (params.x !== undefined) getNumber(params.x, "x");
  if (params.y !== undefined) getNumber(params.y, "y");
  if (params.width !== undefined) getPositiveNumber(params.width, "width");
  if (params.height !== undefined) getPositiveNumber(params.height, "height");
  getOptionalNonEmptyString(params.key, "key");
}

/** Validates resolved write params before executeWrite mutates the document. */
function validateWriteToolParams(
  type: string,
  nodeIds: string[] | undefined,
  params: RequestParams
): void {
  const merged: Record<string, unknown> = {
    ...(params ?? {}),
    nodeId: nodeIds?.[0] ?? params?.nodeId,
  };

  switch (type) {
    case "create_frame":
      if (params) validateCreateNodeBase(params);
      if (params?.fills !== undefined) toSolidPaints(params.fills);
      if (params?.strokes !== undefined) toSolidPaints(params.strokes);
      if (params?.cornerRadius !== undefined) {
        getNonnegativeNumber(params.cornerRadius, "cornerRadius");
      }
      if (params?.layoutMode !== undefined) {
        validateEnum(params.layoutMode, "layoutMode", ["NONE", "HORIZONTAL", "VERTICAL"]);
      }
      if (params?.itemSpacing !== undefined) getNumber(params.itemSpacing, "itemSpacing");
      if (params?.padding !== undefined) validatePaddingObject(params.padding, "padding");
      return;
    case "create_text":
      if (params) validateCreateNodeBase(params);
      if (params?.characters !== undefined && typeof params.characters !== "string") {
        fail("INVALID_INPUT", "characters must be a string");
      }
      if (params?.style !== undefined) validateTextStyle(params.style);
      if (params?.fills !== undefined) toSolidPaints(params.fills);
      return;
    case "create_rectangle":
      if (params) validateCreateNodeBase(params);
      if (params?.fills !== undefined) toSolidPaints(params.fills);
      if (params?.strokes !== undefined) toSolidPaints(params.strokes);
      if (params?.cornerRadius !== undefined) {
        getNonnegativeNumber(params.cornerRadius, "cornerRadius");
      }
      return;
    case "append_children":
      getFigmaNodeId(params?.parentId, "parentId");
      if (!Array.isArray(params?.childIds) || params.childIds.length === 0) {
        fail("INVALID_INPUT", "childIds must be a non-empty array");
      }
      params.childIds.forEach((childId, index) => getFigmaNodeId(childId, `childIds[${index}]`));
      return;
    case "set_position":
      getFigmaNodeId(merged.nodeId, "nodeId");
      getNumber(merged.x, "x");
      getNumber(merged.y, "y");
      return;
    case "set_size":
      getFigmaNodeId(merged.nodeId, "nodeId");
      getPositiveNumber(merged.width, "width");
      getPositiveNumber(merged.height, "height");
      return;
    case "set_fills":
      getFigmaNodeId(merged.nodeId, "nodeId");
      toSolidPaints(merged.fills);
      return;
    case "set_strokes":
      getFigmaNodeId(merged.nodeId, "nodeId");
      toSolidPaints(merged.strokes);
      return;
    case "set_corner_radius":
      getFigmaNodeId(merged.nodeId, "nodeId");
      getNonnegativeNumber(merged.cornerRadius, "cornerRadius");
      return;
    case "set_text_content":
      getFigmaNodeId(merged.nodeId, "nodeId");
      if (typeof merged.characters !== "string") {
        fail("INVALID_INPUT", "characters must be a string");
      }
      return;
    case "set_text_style":
      getFigmaNodeId(merged.nodeId, "nodeId");
      validateTextStyle(merged.style);
      return;
    case "set_layout_mode":
      getFigmaNodeId(merged.nodeId, "nodeId");
      validateEnum(merged.layoutMode, "layoutMode", ["NONE", "HORIZONTAL", "VERTICAL"]);
      return;
    case "set_padding":
      getFigmaNodeId(merged.nodeId, "nodeId");
      if (
        merged.top === undefined &&
        merged.right === undefined &&
        merged.bottom === undefined &&
        merged.left === undefined
      ) {
        return;
      }
      if (merged.top !== undefined) getNonnegativeNumber(merged.top, "top");
      if (merged.right !== undefined) getNonnegativeNumber(merged.right, "right");
      if (merged.bottom !== undefined) getNonnegativeNumber(merged.bottom, "bottom");
      if (merged.left !== undefined) getNonnegativeNumber(merged.left, "left");
      return;
    case "set_item_spacing":
      getFigmaNodeId(merged.nodeId, "nodeId");
      getNumber(merged.itemSpacing, "itemSpacing");
      return;
    case "find_nodes":
      getOptionalNonEmptyString(params?.query, "query");
      getOptionalFigmaNodeId(params?.nodeId, "nodeId");
      getOptionalNonEmptyString(params?.name, "name");
      getOptionalNonEmptyString(params?.key, "key");
      getOptionalFigmaNodeId(params?.parentId, "parentId");
      return;
    case "delete_node":
      getFigmaNodeId(merged.nodeId, "nodeId");
      return;
    default:
      return;
  }
}

/** Converts a hex color string into the RGBA values expected by the Figma API. */
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

/** Validates and converts V1 paint input into solid Figma paints. */
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

/** Marks nodes created or managed through the write tools with shared plugin data. */
function setPluginData(node: BaseNode, key?: string): void {
  if (!("setSharedPluginData" in node)) return;
  node.setSharedPluginData(PLUGIN_NS, MANAGED_KEY, "true");
  if (key) {
    node.setSharedPluginData(PLUGIN_NS, NODE_KEY, key);
  }
}

/** Reads the stable plugin-managed key associated with a node, if any. */
function getPluginKey(node: BaseNode): string | undefined {
  if (!("getSharedPluginData" in node)) return undefined;
  const key = node.getSharedPluginData(PLUGIN_NS, NODE_KEY);
  return key || undefined;
}

/** Checks whether a node belongs to the active page. */
function isOnCurrentPage(node: BaseNode): boolean {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE" && current.parent) {
    current = current.parent;
  }
  return current?.type === "PAGE" && current.id === figma.currentPage.id;
}

/** Ensures an async lookup resolved to a mutable scene node on the current page. */
function ensureSceneNode(node: BaseNode | null, field: string): SceneNode {
  if (!node || node.type === "DOCUMENT" || node.type === "PAGE") {
    fail("NOT_FOUND", `${field} was not found`);
  }
  if (!isOnCurrentPage(node)) {
    fail("OUT_OF_SCOPE", "Mutations are restricted to the current page");
  }
  return node as SceneNode;
}

/** Fetches a scene node by id and validates the current-page mutation boundary. */
async function getNodeById(nodeId: string, field = "nodeId"): Promise<SceneNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  return ensureSceneNode(node, field);
}

/** Resolves the parent container for create operations, defaulting to the current page. */
async function getParentNode(parentId?: string): Promise<(BaseNode & ChildrenMixin) | PageNode> {
  if (!parentId) return figma.currentPage;
  const node = await getNodeById(parentId, "parentId");
  if (!("appendChild" in node)) {
    fail("INVALID_PARENT", "parentId must reference a node that can contain children");
  }
  return node;
}

/** Applies an explicit name or falls back to the default node label. */
function setName(node: SceneNode, name: unknown, fallback: string): void {
  node.name = getOptionalString(name) ?? fallback;
}

/** Applies x and y coordinates when both are provided. */
function applyPosition(node: SceneNode, params: RequestParams): void {
  if (params?.x !== undefined && params?.y !== undefined) {
    node.x = getNumber(params.x, "x");
    node.y = getNumber(params.y, "y");
  }
}

/** Applies width and height when the node supports resize. */
function applySize(node: SceneNode, params: RequestParams): void {
  if (params?.width !== undefined && params?.height !== undefined) {
    if (!("resize" in node)) {
      fail("UNSUPPORTED_NODE", "resize is not supported for this node");
    }
    node.resize(getNumber(params.width, "width"), getNumber(params.height, "height"));
  }
}

/** Applies solid fill paints to nodes that expose fills. */
function applyFills(node: SceneNode, fills: unknown): void {
  if (fills === undefined) return;
  if (!("fills" in node)) {
    fail("UNSUPPORTED_NODE", "fills are not supported for this node");
  }
  node.fills = toSolidPaints(fills);
}

/** Applies solid stroke paints to nodes that expose strokes. */
function applyStrokes(node: SceneNode, strokes: unknown): void {
  if (strokes === undefined) return;
  if (!("strokes" in node)) {
    fail("UNSUPPORTED_NODE", "strokes are not supported for this node");
  }
  node.strokes = toSolidPaints(strokes);
}

/** Applies a uniform corner radius to supported nodes. */
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

/** Applies the requested auto-layout mode to supported container nodes. */
function applyLayoutMode(node: SceneNode, layoutMode: unknown): void {
  if (layoutMode === undefined) return;
  if (!("layoutMode" in node)) {
    fail("UNSUPPORTED_NODE", "layoutMode is not supported for this node");
  }
  node.layoutMode = getString(layoutMode, "layoutMode") as FrameNode["layoutMode"];
}

/** Applies auto-layout padding values, defaulting omitted edges to zero. */
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

/** Applies auto-layout item spacing to supported container nodes. */
function applyItemSpacing(node: SceneNode, itemSpacing: unknown): void {
  if (itemSpacing === undefined) return;
  if (!("itemSpacing" in node)) {
    fail("UNSUPPORTED_NODE", "itemSpacing is not supported for this node");
  }
  node.itemSpacing = getNumber(itemSpacing, "itemSpacing");
}

/** Loads the fonts needed for subsequent text mutations and returns the active font. */
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

/** Applies supported text style fields after ensuring the required fonts are loaded. */
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

/** Replaces text node characters after loading the active font. */
async function applyTextContent(node: TextNode, characters: unknown): Promise<void> {
  await loadFont(node);
  if (characters !== undefined && characters !== null && typeof characters !== "string") {
    fail("INVALID_INPUT", "characters must be a string");
  }
  node.characters = typeof characters === "string" ? characters : "";
}

/** Builds the normalized mutation payload returned by write operations. */
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

/** Creates a frame on the current page and applies supported initial properties. */
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

/** Creates a text node on the current page and applies content and style inputs. */
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

/** Creates a rectangle on the current page and applies supported visual properties. */
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

/** Re-parents existing child nodes under the requested container. */
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

/** Recursively collects scene nodes below a container for search operations. */
function collectNodes(root: ChildrenMixin, acc: SceneNode[]): void {
  for (const child of root.children) {
    acc.push(child);
    if ("children" in child) {
      collectNodes(child, acc);
    }
  }
}

/** Finds current-page nodes by id, name, plugin key, or parent id. */
async function findNodes(params: RequestParams): Promise<unknown> {
  const nodes: SceneNode[] = [];
  collectNodes(figma.currentPage, nodes);
  let matches = nodes;
  const rawQuery = getOptionalString(params?.query);
  let queryFilters: Record<string, unknown> | undefined;
  let nameSubstring: string | undefined;

  if (rawQuery) {
    try {
      const parsed = JSON.parse(rawQuery);
      if (isObject(parsed)) {
        queryFilters = parsed;
      } else {
        nameSubstring = rawQuery;
      }
    } catch {
      nameSubstring = rawQuery;
    }
  }

  const nodeId = getOptionalString(params?.nodeId) ?? getOptionalString(queryFilters?.nodeId);
  const name = getOptionalString(params?.name) ?? getOptionalString(queryFilters?.name);
  const key = getOptionalString(params?.key) ?? getOptionalString(queryFilters?.key);
  const parentId =
    getOptionalString(params?.parentId) ?? getOptionalString(queryFilters?.parentId);
  if (nodeId) matches = matches.filter((node) => node.id === nodeId);
  if (name) matches = matches.filter((node) => node.name === name);
  if (key) matches = matches.filter((node) => getPluginKey(node) === key);
  if (parentId) matches = matches.filter((node) => node.parent?.id === parentId);
  if (nameSubstring) {
    matches = matches.filter((node) => node.name.includes(nameSubstring));
  }
  return { matches: matches.map((node) => toMutationResult(node)) };
}

/** Deletes a current-page node and reports its id. */
async function deleteNode(params: RequestParams): Promise<unknown> {
  const node = await getNodeById(getString(params?.nodeId, "nodeId"));
  node.remove();
  return { deleted: node.id };
}

/** Loads a node, runs a mutator, and returns the normalized mutation result. */
async function mutateNode(
  params: RequestParams,
  mutator: (node: SceneNode) => Promise<void> | void
): Promise<MutationResult> {
  const node = await getNodeById(getString(params?.nodeId, "nodeId"));
  await mutator(node);
  return toMutationResult(node);
}

/** Dispatches a single write tool invocation to its concrete implementation. */
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

/** Resolves temporary batch references like `tmp:card` into concrete node ids. */
function resolveRef(value: string | undefined, context: BatchContext): string | undefined {
  if (!value || !value.startsWith("tmp:")) return value;
  const resolved = context.refs.get(value);
  if (!resolved) {
    fail("UNKNOWN_REFERENCE", `Unknown batch reference: ${value}`);
  }
  return resolved;
}

/** Resolves temporary references inside an operation's params object. */
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

/** Handles both single write requests and ordered batch mutations from the server. */
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
      validateWriteToolParams(
        operation.type,
        resolvedNodeIds ?? (resolvedNodeId ? [resolvedNodeId] : undefined),
        resolvedParams
      );
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

/** Serializes plugin-side write failures into the transport error shape. */
export function serializeWriteError(error: unknown): MutationError {
  return toMutationError(error);
}
