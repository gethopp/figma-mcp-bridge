import { describe, it, expect } from "bun:test";
import { z } from "zod";

import { createSectionInput, createSectionShape } from "../src/schema";
import { createShapeWithTextInput, createShapeWithTextShape } from "../src/schema";
import { createConnectorInput } from "../src/schema";
import { setNodePropertiesInput, setNodePropertiesShape } from "../src/schema";
import {
  alignToGridInput,
  distributeInput,
  duplicateWithOffsetInput,
  fitToContentInput,
  placeRightOfInput,
  toolInputSchemas,
} from "../src/schema";

describe("create_section", () => {
  it("validates basic section input", () => {
    const input = { name: "My Section", width: 200, height: 100 };
    const result = createSectionInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects fillOpacity without fillHex", () => {
    const input = { fillOpacity: 0.5 };
    const result = createSectionInput.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts fillHex with fillOpacity", () => {
    const input = { fillHex: "#FF0000", fillOpacity: 0.5 };
    const result = createSectionInput.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("create_shape_with_text", () => {
  it("validates basic shape with text input", () => {
    const input = { shapeType: "ROUNDED_RECTANGLE", characters: "Hello", width: 100, height: 50 };
    const result = createShapeWithTextInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("validates stroke when strokeOpacity provided", () => {
    const input = { strokeHex: "#000", strokeOpacity: 0.8, width: 100, height: 50 };
    const result = createShapeWithTextInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects strokeOpacity without strokeHex", () => {
    const input = { strokeOpacity: 0.5 };
    const result = createShapeWithTextInput.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts textFillHex with textFillOpacity", () => {
    const input = { textFillHex: "#112233", textFillOpacity: 0.5 };
    const result = createShapeWithTextInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects textFillOpacity without textFillHex", () => {
    const input = { textFillOpacity: 0.5 };
    const result = createShapeWithTextInput.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("set_node_properties", () => {
  it("validates a single-node update", () => {
    const input = { nodeId: "1:2", name: "Renamed" };
    const result = setNodePropertiesInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("validates a batch update with nodeIds", () => {
    const input = { nodeIds: ["1:2", "3:4"], visible: false };
    const result = setNodePropertiesInput.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects requests with neither nodeId nor nodeIds", () => {
    const input = { name: "Renamed" };
    const result = setNodePropertiesInput.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a target without any property to update", () => {
    const input = { nodeIds: ["1:2"] };
    const result = setNodePropertiesInput.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("advertises nodeIds on the tool shape", () => {
    expect(setNodePropertiesShape.shape.nodeIds).toBeDefined();
  });
});

describe("create_connector anchors", () => {
  const base = {
    startNodeId: "1:2",
    endNodeId: "3:4",
  };

  it("accepts startAnchor with startNodeId", () => {
    const result = createConnectorInput.safeParse({ ...base, startAnchor: "bottom" });
    expect(result.success).toBe(true);
  });

  it("accepts endAnchor with endNodeId", () => {
    const result = createConnectorInput.safeParse({ ...base, endAnchor: "right" });
    expect(result.success).toBe(true);
  });

  it("rejects startAnchor without startNodeId", () => {
    const result = createConnectorInput.safeParse({
      startX: 0,
      startY: 0,
      endNodeId: "3:4",
      startAnchor: "top",
    });
    expect(result.success).toBe(false);
  });

  it("rejects endAnchor without endNodeId", () => {
    const result = createConnectorInput.safeParse({
      startNodeId: "1:2",
      endX: 10,
      endY: 10,
      endAnchor: "left",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown anchor values", () => {
    const result = createConnectorInput.safeParse({ ...base, startAnchor: "middle" });
    expect(result.success).toBe(false);
  });
});

describe("fit_to_content", () => {
  it("validates a section id with default padding", () => {
    const result = fitToContentInput.safeParse({ nodeId: "1:2" });
    expect(result.success).toBe(true);
  });

  it("validates an explicit padding", () => {
    const result = fitToContentInput.safeParse({ nodeId: "1:2", padding: 24 });
    expect(result.success).toBe(true);
  });

  it("rejects negative padding", () => {
    const result = fitToContentInput.safeParse({ nodeId: "1:2", padding: -1 });
    expect(result.success).toBe(false);
  });
});

describe("distribute_horizontally / distribute_vertically", () => {
  it("accepts three nodes", () => {
    const result = distributeInput.safeParse({ nodeIds: ["1:2", "3:4", "5:6"] });
    expect(result.success).toBe(true);
  });

  it("rejects fewer than three nodes", () => {
    const result = distributeInput.safeParse({ nodeIds: ["1:2", "3:4"] });
    expect(result.success).toBe(false);
  });

  it("is registered for both axes", () => {
    expect(toolInputSchemas.distribute_horizontally).toBeDefined();
    expect(toolInputSchemas.distribute_vertically).toBeDefined();
  });
});

describe("align_to_grid", () => {
  it("validates nodes with a grid size", () => {
    const result = alignToGridInput.safeParse({ nodeIds: ["1:2"], gridSize: 8 });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive grid size", () => {
    const result = alignToGridInput.safeParse({ nodeIds: ["1:2"], gridSize: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing grid size", () => {
    const result = alignToGridInput.safeParse({ nodeIds: ["1:2"] });
    expect(result.success).toBe(false);
  });
});

describe("place_below / place_right_of", () => {
  it("validates minimal input", () => {
    const result = placeRightOfInput.safeParse({ nodeId: "1:2", relativeToId: "3:4" });
    expect(result.success).toBe(true);
  });

  it("validates gap and center alignment", () => {
    const result = placeRightOfInput.safeParse({
      nodeId: "1:2",
      relativeToId: "3:4",
      gap: 16,
      align: "center",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing relativeToId", () => {
    const result = placeRightOfInput.safeParse({ nodeId: "1:2" });
    expect(result.success).toBe(false);
  });

  it("rejects negative gap", () => {
    const result = placeRightOfInput.safeParse({
      nodeId: "1:2",
      relativeToId: "3:4",
      gap: -4,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown align values", () => {
    const result = placeRightOfInput.safeParse({
      nodeId: "1:2",
      relativeToId: "3:4",
      align: "end",
    });
    expect(result.success).toBe(false);
  });
});

describe("duplicate_with_offset", () => {
  it("validates nodes with numeric offsets", () => {
    const result = duplicateWithOffsetInput.safeParse({
      nodeIds: ["1:2"],
      offsetX: 40,
      offsetY: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing offset", () => {
    const result = duplicateWithOffsetInput.safeParse({ nodeIds: ["1:2"], offsetX: 40 });
    expect(result.success).toBe(false);
  });

  it("rejects an empty nodeIds list", () => {
    const result = duplicateWithOffsetInput.safeParse({
      nodeIds: [],
      offsetX: 1,
      offsetY: 1,
    });
    expect(result.success).toBe(false);
  });
});
