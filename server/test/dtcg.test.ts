import assert from "node:assert/strict";
import { test } from "node:test";
import { countTokens, STYLES_GROUP, toDtcg, type RawTokens } from "../src/extract/dtcg.js";

const tokens: RawTokens = {
  collections: [
    {
      id: "c1",
      name: "Primitives",
      defaultModeId: "m1",
      modes: [{ modeId: "m1", name: "Value" }],
      variables: [
        {
          id: "v1",
          name: "blue/500",
          resolvedType: "COLOR",
          scopes: ["ALL_FILLS"],
          valuesByMode: { m1: { type: "COLOR", r: 0, g: 0.5, b: 1, a: 1 } },
        },
        {
          id: "v2",
          name: "space/4",
          resolvedType: "FLOAT",
          scopes: ["GAP", "WIDTH_HEIGHT"],
          codeSyntax: { WEB: "--space-4" },
          valuesByMode: { m1: 16 },
        },
        {
          id: "v3",
          name: "weight/bold",
          resolvedType: "FLOAT",
          scopes: ["FONT_WEIGHT"],
          valuesByMode: { m1: 700 },
        },
        {
          id: "v4",
          name: "font/body",
          resolvedType: "STRING",
          scopes: ["FONT_FAMILY"],
          valuesByMode: { m1: "Inter" },
        },
        {
          id: "v5",
          name: "ratio",
          resolvedType: "FLOAT",
          scopes: ["ALL_SCOPES"],
          valuesByMode: { m1: 1.5 },
        },
      ],
    },
    {
      id: "c2",
      name: "Theme",
      defaultModeId: "light",
      modes: [
        { modeId: "light", name: "Light" },
        { modeId: "dark", name: "Dark" },
      ],
      variables: [
        {
          id: "v10",
          name: "bg/brand",
          resolvedType: "COLOR",
          valuesByMode: {
            light: { type: "VARIABLE_ALIAS", id: "v1" },
            dark: { type: "VARIABLE_ALIAS", id: "missing" },
          },
        },
      ],
    },
  ],
  styles: {
    text: [
      {
        id: "s1",
        name: "Body/Medium",
        fontName: { family: "Inter", style: "Semi Bold" },
        fontSize: 16,
        lineHeight: { unit: "PIXELS", value: 24 },
        letterSpacing: { unit: "PERCENT", value: -2 },
        textCase: "ORIGINAL",
        textDecoration: "NONE",
      },
    ],
    effects: [
      {
        id: "s2",
        name: "Shadow/sm",
        effects: [
          {
            type: "DROP_SHADOW",
            visible: true,
            color: { r: 0, g: 0, b: 0, a: 0.1 },
            offset: { x: 0, y: 1 },
            radius: 2,
            spread: -1,
          },
        ],
      },
      {
        id: "s3",
        name: "Blur/md",
        effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 16 }],
      },
    ],
    paints: [
      {
        id: "s4",
        name: "Brand",
        paints: [{ type: "SOLID", visible: true, opacity: 0.5, color: { r: 1, g: 0, b: 0 } }],
      },
    ],
    grids: [],
  },
};

test("variables become typed DTCG tokens grouped by collection and path", () => {
  const out = toDtcg(tokens) as any;
  assert.deepEqual(out.Primitives.blue["500"].$value, {
    colorSpace: "srgb",
    components: [0, 0.5, 1],
    alpha: 1,
    hex: "#0080ff",
  });
  assert.equal(out.Primitives.blue["500"].$type, "color");
  assert.deepEqual(out.Primitives.space["4"], {
    $type: "dimension",
    $value: { value: 16, unit: "px" },
    $extensions: {
      "com.figma": {
        variableId: "v2",
        collection: "Primitives",
        resolvedType: "FLOAT",
        scopes: ["GAP", "WIDTH_HEIGHT"],
        codeSyntax: { WEB: "--space-4" },
      },
    },
  });
  assert.equal(out.Primitives.weight.bold.$type, "fontWeight");
  assert.equal(out.Primitives.font.body.$type, "fontFamily");
  assert.equal(out.Primitives.ratio.$type, "number");
});

test("aliases become references, every mode is kept, unresolved aliases are reported", () => {
  const token = (toDtcg(tokens) as any).Theme.bg.brand;
  assert.equal(token.$value, "{Primitives.blue.500}");
  assert.deepEqual(token.$extensions["com.figma"].modes, {
    Light: "{Primitives.blue.500}",
    Dark: null,
  });
  assert.deepEqual(token.$extensions["com.figma"].unresolvedAliases, ["missing"]);
});

test("styles become typography, shadow and color tokens; inexpressible styles keep Figma data", () => {
  const styles = (toDtcg(tokens) as any)[STYLES_GROUP];
  assert.deepEqual(styles.typography.Body.Medium.$value, {
    fontFamily: "Inter",
    fontWeight: 600,
    fontSize: { value: 16, unit: "px" },
    letterSpacing: { value: -0.32, unit: "px" },
    lineHeight: 1.5,
  });
  assert.equal(styles.effects.Shadow.sm.$type, "shadow");
  assert.deepEqual(styles.effects.Shadow.sm.$value[0].offsetY, { value: 1, unit: "px" });
  assert.equal(styles.effects.Blur.md.$value, null);
  assert.equal(styles.effects.Blur.md.$extensions["com.figma"].effects[0].radius, 16);
  assert.equal(styles.paints.Brand.$value.alpha, 0.5);
});

test("a token and a group with the same name coexist through $root", () => {
  const out = toDtcg({
    collections: [
      {
        id: "c",
        name: "Size",
        modes: [{ modeId: "m", name: "Value" }],
        variables: [
          { id: "a", name: "radius", resolvedType: "FLOAT", valuesByMode: { m: 4 } },
          { id: "b", name: "radius/lg", resolvedType: "FLOAT", valuesByMode: { m: 8 } },
        ],
      },
    ],
  }) as any;
  assert.equal(out.Size.radius.$root.$value, 4);
  assert.equal(out.Size.radius.lg.$value, 8);
  assert.equal(countTokens(out), 2);
});
