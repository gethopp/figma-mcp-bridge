import { serializeNode } from "./serializer";

type RequestType =
  | "get_document"
  | "get_selection"
  | "get_node"
  | "get_styles"
  | "get_metadata"
  | "get_design_context"
  | "get_variable_defs"
  | "get_screenshot";

type ServerRequest = {
  type: RequestType;
  requestId: string;
  nodeIds?: string[];
  params?: {
    format?: "PNG" | "SVG" | "JPG" | "PDF";
    scale?: number;
    depth?: number;
  };
};

type PluginResponse = {
  type: RequestType;
  requestId: string;
  data?: unknown;
  error?: string;
};

const sendStatus = () => {
  figma.ui.postMessage({
    type: "plugin-status",
    payload: {
      fileName: figma.root.name,
      selectionCount: figma.currentPage.selection.length,
    },
  });
};

const serializeVariableValue = (value: VariableValue): unknown => {
  if (typeof value === "object" && value !== null) {
    if ("type" in value && value.type === "VARIABLE_ALIAS") {
      return { type: "VARIABLE_ALIAS", id: value.id };
    }
    if ("r" in value && "g" in value && "b" in value) {
      // It's an RGB or RGBA color
      const color = value as RGBA;
      return {
        type: "COLOR",
        r: color.r,
        g: color.g,
        b: color.b,
        a: "a" in color ? color.a : 1,
      };
    }
  }
  return value;
};

const handleRequest = async (
  request: ServerRequest
): Promise<PluginResponse> => {
  try {
    switch (request.type) {
      case "get_document":
        return {
          type: request.type,
          requestId: request.requestId,
          data: serializeNode(figma.currentPage),
        };
      case "get_selection":
        return {
          type: request.type,
          requestId: request.requestId,
          data: figma.currentPage.selection.map((node) => serializeNode(node)),
        };
      case "get_node": {
        const nodeId = request.nodeIds && request.nodeIds[0];
        if (!nodeId) {
          throw new Error("nodeIds is required for get_node");
        }
        const node = await figma.getNodeByIdAsync(nodeId);
        if (!node || node.type === "DOCUMENT") {
          throw new Error(`Node not found: ${nodeId}`);
        }
        return {
          type: request.type,
          requestId: request.requestId,
          data: serializeNode(node as SceneNode),
        };
      }
      case "get_styles": {
        const [paintStyles, textStyles, effectStyles, gridStyles] =
          await Promise.all([
            figma.getLocalPaintStylesAsync(),
            figma.getLocalTextStylesAsync(),
            figma.getLocalEffectStylesAsync(),
            figma.getLocalGridStylesAsync(),
          ]);
        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            paints: paintStyles.map((style) => ({
              id: style.id,
              name: style.name,
              paints: style.paints,
            })),
            text: textStyles.map((style) => ({
              id: style.id,
              name: style.name,
              fontSize: style.fontSize,
              fontName: style.fontName,
            })),
            effects: effectStyles.map((style) => ({
              id: style.id,
              name: style.name,
              effects: style.effects,
            })),
            grids: gridStyles.map((style) => ({
              id: style.id,
              name: style.name,
              layoutGrids: style.layoutGrids,
            })),
          },
        };
      }
      case "get_metadata": {
        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            fileName: figma.root.name,
            currentPageId: figma.currentPage.id,
            currentPageName: figma.currentPage.name,
            pageCount: figma.root.children.length,
            pages: figma.root.children.map((page) => ({
              id: page.id,
              name: page.name,
            })),
          },
        };
      }
      case "get_design_context": {
        const depth = request.params?.depth ?? 2;
        const serializeWithDepth = async (
          node: unknown,
          currentDepth: number
        ): Promise<ReturnType<typeof serializeNode>> => {
          const serialized = serializeNode(node);
          if (currentDepth >= depth && serialized.children) {
            // Truncate children at depth limit, but show count
            return {
              ...serialized,
              children: undefined,
              childCount:
                (node as ChildrenMixin & SceneNode).children?.length ?? 0,
            } as ReturnType<typeof serializeNode> & { childCount: number };
          }
          if (serialized.children) {
            const childNodes = await Promise.all(
              serialized.children.map((child) =>
                figma.getNodeByIdAsync(child.id)
              )
            );
            const serializedChildren = await Promise.all(
              childNodes
                .filter(
                  (n): n is SceneNode => n !== null && n.type !== "DOCUMENT"
                )
                .map((n) => serializeWithDepth(n, currentDepth + 1))
            );
            return {
              ...serialized,
              children: serializedChildren,
            };
          }
          return serialized;
        };

        const selection = figma.currentPage.selection;
        const contextNodes =
          selection.length > 0
            ? await Promise.all(
                selection.map((node) => serializeWithDepth(node, 0))
              )
            : [
                await serializeWithDepth(
                  figma.currentPage as unknown as SceneNode,
                  0
                ),
              ];

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            fileName: figma.root.name,
            currentPage: {
              id: figma.currentPage.id,
              name: figma.currentPage.name,
            },
            selectionCount: selection.length,
            context: contextNodes,
          },
        };
      }
      case "get_variable_defs": {
        const collections =
          await figma.variables.getLocalVariableCollectionsAsync();
        const variableData = await Promise.all(
          collections.map(async (collection) => {
            const variables = await Promise.all(
              collection.variableIds.map((id) =>
                figma.variables.getVariableByIdAsync(id)
              )
            );
            return {
              id: collection.id,
              name: collection.name,
              modes: collection.modes.map((mode) => ({
                modeId: mode.modeId,
                name: mode.name,
              })),
              variables: variables
                .filter((v): v is Variable => v !== null)
                .map((variable) => ({
                  id: variable.id,
                  name: variable.name,
                  resolvedType: variable.resolvedType,
                  valuesByMode: Object.fromEntries(
                    Object.entries(variable.valuesByMode).map(
                      ([modeId, value]) => [
                        modeId,
                        serializeVariableValue(value),
                      ]
                    )
                  ),
                })),
            };
          })
        );
        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            collections: variableData,
          },
        };
      }
      case "get_screenshot": {
        const format = request.params?.format ?? "PNG";
        const scale = request.params?.scale ?? 2;

        // Determine which node(s) to export
        let targetNodes: SceneNode[];
        if (request.nodeIds && request.nodeIds.length > 0) {
          const nodes = await Promise.all(
            request.nodeIds.map((id) => figma.getNodeByIdAsync(id))
          );
          targetNodes = nodes.filter(
            (node): node is SceneNode =>
              node !== null && node.type !== "DOCUMENT" && node.type !== "PAGE"
          );
        } else {
          targetNodes = [...figma.currentPage.selection];
        }

        if (targetNodes.length === 0) {
          throw new Error(
            "No nodes to export. Select nodes or provide nodeIds."
          );
        }

        const exports = await Promise.all(
          targetNodes.map(async (node) => {
            const settings: ExportSettings =
              format === "SVG"
                ? { format: "SVG" }
                : format === "PDF"
                  ? { format: "PDF" }
                  : format === "JPG"
                    ? {
                        format: "JPG",
                        constraint: { type: "SCALE", value: scale },
                      }
                    : {
                        format: "PNG",
                        constraint: { type: "SCALE", value: scale },
                      };

            const bytes = await node.exportAsync(settings);
            const base64 = figma.base64Encode(bytes);
            return {
              nodeId: node.id,
              nodeName: node.name,
              format,
              base64,
              width: node.width,
              height: node.height,
            };
          })
        );

        return {
          type: request.type,
          requestId: request.requestId,
          data: {
            exports,
          },
        };
      }
      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  } catch (error) {
    return {
      type: request.type,
      requestId: request.requestId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

figma.showUI(__html__, { width: 320, height: 180 });
sendStatus();

figma.on("selectionchange", () => {
  sendStatus();
});

figma.ui.onmessage = async (message) => {
  if (message.type === "ui-ready") {
    sendStatus();
    return;
  }

  if (message.type === "server-request") {
    const response = await handleRequest(message.payload as ServerRequest);
    try {
      figma.ui.postMessage(response);
    } catch (err) {
      figma.ui.postMessage({
        type: response.type,
        requestId: response.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
