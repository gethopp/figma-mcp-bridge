import { LayerNode, PlainLayerNode } from "../types";
import { traverse, traverseAsync } from "../utils";
import { processLayer } from "./processLayer";

interface LayerCbArgs {
  node: SceneNode;
  layer: LayerNode;
  parent: LayerNode | null;
}

export async function addLayersToFrame(
  layers: PlainLayerNode[],
  baseFrame: PageNode | FrameNode,
  onLayerProcess?: (args: LayerCbArgs) => void
) {
  for (const rootLayer of layers) {
    await traverseAsync(rootLayer, async (layer, parent) => {
      try {
        const node = await processLayer(layer, parent, baseFrame);

        onLayerProcess?.({ node, layer, parent });
      } catch (err) {
        console.warn("Error on layer:", layer, err);
      }
    });
  }
}

export * from "./getFont";
export * from "./dropOffset";
