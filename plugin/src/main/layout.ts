/** Read-only geometry, deliberately independent of screenshot export. */
export async function getLayoutTree(rootId: string, maxNodes = 2000) {
  const root = await figma.getNodeByIdAsync(rootId);
  if (!root || root.type === "DOCUMENT" || root.type === "PAGE")
    throw new Error("Scene root required");
  const nodes: unknown[] = [];
  let truncated = false;
  function visit(node: SceneNode, depth: number) {
    if (nodes.length >= maxNodes || depth > 100) {
      truncated = true;
      return;
    }
    nodes.push({
      id: node.id,
      parentId: node.parent?.id,
      name: node.name,
      type: node.type,
      visible: node.visible,
      localSize: { width: node.width, height: node.height },
      absoluteTransform: node.absoluteTransform,
      absoluteBoundingBox: node.absoluteBoundingBox,
      absoluteRenderBounds: node.absoluteRenderBounds,
      clipsContent: "clipsContent" in node ? node.clipsContent : false,
    });
    if ("children" in node) for (const child of node.children) visit(child, depth + 1);
  }
  visit(root, 0);
  return {
    schemaVersion: 1,
    snapshotId: new Date().toISOString(),
    atomicWithScreenshot: false,
    fileKey: figma.fileKey ?? null,
    fileName: figma.root.name,
    pageId: figma.currentPage.id,
    rootId,
    truncated,
    nodes,
    capture: {
      coordinateSpace: "document-absolute",
      window: root.absoluteBoundingBox,
      exportSettings: {
        format: "PNG",
        contentsOnly: true,
        useAbsoluteBounds: true,
        constraint: { type: "SCALE", value: 1 },
      },
      dimensionsAreMeasuredFromImage: false,
      clipping:
        "Rectangles are layout AABBs; ancestor masks and painted visibility are not evaluated.",
    },
  };
}
