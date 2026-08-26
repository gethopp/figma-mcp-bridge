import { getImageFills } from "../utils";
import { processImages } from "./images";
import { getMatchingFont } from "./getFont";
import { assign } from "./helpers";
import { LayerNode, PlainLayerNode, WithRef } from "../types";

const processDefaultElement = (layer: LayerNode, node: SceneNode): SceneNode => {
  node.x = layer.x as number;
  node.y = layer.y as number;
  node.resize(layer.width || 1, layer.height || 1);
  assign(node, layer);
  // rects.push(frame);
  return node;
};

const createNodeFromLayer = (layer: LayerNode) => {
  if (layer.type === "FRAME" || layer.type === "GROUP") {
    return figma.createFrame();
  }

  if (layer.type === "SVG" && layer.svg) {
    return figma.createNodeFromSvg(layer.svg);
  }

  if (layer.type === "RECTANGLE") {
    return figma.createRectangle();
  }

  if (layer.type === "TEXT") {
    return figma.createText();
  }

  if (layer.type === "COMPONENT") {
    return figma.createComponent();
  }
};

const SIMPLE_TYPES = ["FRAME", "GROUP", "SVG", "RECTANGLE", "COMPONENT"];

export const processLayer = async (
  layer: PlainLayerNode,
  parent: WithRef<LayerNode> | null,
  baseFrame: PageNode | FrameNode
) => {
  const parentFrame = (parent?.ref as FrameNode) || baseFrame;

  if (typeof layer.x !== "number" || typeof layer.y !== "number") {
    throw Error("Layer coords not defined");
  }

  const node = createNodeFromLayer(layer);

  if (!node) {
    throw Error(`${layer.type} not implemented`);
  }

  if (SIMPLE_TYPES.includes(layer.type as string)) {
    parentFrame.appendChild(processDefaultElement(layer, node));
  }
  // @ts-expect-error
  layer.ref = node;

  if (layer.type === "RECTANGLE") {
    if (getImageFills(layer as RectangleNode)) {
      await processImages(layer as RectangleNode);
    }
  }

  if (layer.type === "TEXT") {
    const text = node as TextNode;

    if (layer.fontFamily) {
      text.fontName = await getMatchingFont(layer.fontFamily, layer.fontWeight);

      delete layer.fontFamily;
    }
    // Consumed above. TextNode.fontWeight is derived from fontName and
    // read-only, so leaving it here would only make assign() warn.
    delete layer.fontWeight;

    assign(text, layer);
    text.resize(layer.width || 1, layer.height || 1);

    text.textAutoResize = "HEIGHT";

    let adjustments = 0;
    if (layer.lineHeight) {
      text.lineHeight = layer.lineHeight;
    }
    // Adjust text width
    while (typeof layer.height === "number" && text.height > layer.height) {
      if (adjustments++ > 5) {
        console.warn("Too many font adjustments", text, layer);

        break;
      }

      try {
        text.resize(text.width + 1, text.height);
      } catch (err) {
        console.warn("Error on resize text:", layer, text, err);
      }
    }

    parentFrame.appendChild(text);
  }

  return node;
};
