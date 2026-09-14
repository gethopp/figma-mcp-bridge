/**
 * Converts the plugin's `get_tokens` result into a W3C Design Tokens Community Group (DTCG) document.
 *
 * - Variables become tokens grouped by collection, then by the "/"-separated variable name.
 * - The collection's default mode is `$value`; every mode (when there are several) is kept under
 *   `$extensions["com.figma"].modes`. Aliases become `{group.token}` references.
 * - Types come from Figma's resolved type and scopes: COLOR → color, FLOAT used only for sizes →
 *   dimension (px), FONT_WEIGHT → fontWeight, STRING scoped to font families → fontFamily, other
 *   numbers → number. Figma ids, keys, scopes and code syntax are kept in `$extensions`.
 * - Styles go under the `figma-styles` group: text → typography, drop/inner shadows → shadow, single
 *   solid paints → color, single linear/radial gradients → gradient. Styles DTCG can't express (image
 *   paints, blurs, grids, stacked paints) keep their Figma data in `$extensions`.
 */

type Rgba = { r: number; g: number; b: number; a?: number };
type Alias = { type: "VARIABLE_ALIAS"; id: string };

export interface RawVariable {
  id: string;
  name: string;
  key?: string;
  description?: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  scopes?: string[];
  codeSyntax?: Record<string, string>;
  valuesByMode: Record<string, unknown>;
}

export interface RawCollection {
  id: string;
  name: string;
  remote?: boolean;
  defaultModeId?: string;
  modes: { modeId: string; name: string }[];
  variables: RawVariable[];
}

export interface RawTokens {
  collections: RawCollection[];
  libraryCollections?: RawCollection[];
  styles?: {
    paints?: Record<string, any>[];
    text?: Record<string, any>[];
    effects?: Record<string, any>[];
    grids?: Record<string, any>[];
  };
}

type Group = { [key: string]: Group | unknown };

export const STYLES_GROUP = "figma-styles";

const DIMENSION_SCOPES = new Set([
  "CORNER_RADIUS",
  "WIDTH_HEIGHT",
  "GAP",
  "STROKE_FLOAT",
  "EFFECT_FLOAT",
  "FONT_SIZE",
  "LINE_HEIGHT",
  "LETTER_SPACING",
  "PARAGRAPH_SPACING",
  "PARAGRAPH_INDENT",
]);

const FONT_WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra\s*light|ultra\s*light/i, 200],
  [/light/i, 300],
  [/semi\s*bold|demi\s*bold/i, 600],
  [/extra\s*bold|ultra\s*bold/i, 800],
  [/black|heavy/i, 900],
  [/medium/i, 500],
  [/bold/i, 700],
  [/regular|normal|book|roman/i, 400],
];

const round = (value: number, places = 4): number => Number(value.toFixed(places));

const isAlias = (value: unknown): value is Alias =>
  !!value && typeof value === "object" && (value as Alias).type === "VARIABLE_ALIAS";

const isColor = (value: unknown): value is Rgba =>
  !!value && typeof value === "object" && "r" in value && "g" in value && "b" in value;

/** Drops undefined values and empty objects. */
function compact<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    )
      continue;
    out[key] = value;
  }
  return out as T;
}

export const toHex = (color: Rgba): string => {
  const channel = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
};

export const colorValue = (color: Rgba, opacity = 1) => ({
  colorSpace: "srgb",
  components: [round(color.r), round(color.g), round(color.b)],
  alpha: round((color.a ?? 1) * opacity),
  hex: toHex(color),
});

const px = (value: number) => ({ value: round(value, 3), unit: "px" });

/** DTCG token names can't contain `{`, `}` or `.`. */
const tokenKey = (segment: string): string =>
  segment.replace(/[{}]/g, "").replace(/\./g, "_").trim() || "_";

const splitPath = (...parts: string[]): string[] =>
  parts.flatMap((part) => part.split("/")).map(tokenKey);

const typeFor = (variable: RawVariable): { type?: string; convert: (raw: unknown) => unknown } => {
  const scopes = variable.scopes ?? [];
  switch (variable.resolvedType) {
    case "COLOR":
      return { type: "color", convert: (raw) => (isColor(raw) ? colorValue(raw) : raw) };
    case "FLOAT":
      if (scopes.includes("FONT_WEIGHT")) return { type: "fontWeight", convert: (raw) => raw };
      if (scopes.length > 0 && scopes.every((scope) => DIMENSION_SCOPES.has(scope))) {
        return { type: "dimension", convert: (raw) => (typeof raw === "number" ? px(raw) : raw) };
      }
      return { type: "number", convert: (raw) => raw };
    case "STRING":
      return scopes.includes("FONT_FAMILY")
        ? { type: "fontFamily", convert: (raw) => raw }
        : { convert: (raw) => raw };
    default:
      return { convert: (raw) => raw };
  }
};

/** Places a token at `path`, using DTCG's `$root` when a group already occupies that name. */
function place(root: Group, path: string[], token: Record<string, unknown>): void {
  let group = root;
  for (const segment of path.slice(0, -1)) {
    const existing = group[segment];
    if (existing && typeof existing === "object" && "$value" in (existing as object)) {
      group[segment] = { $root: existing };
    } else if (!existing) {
      group[segment] = {};
    }
    group = group[segment] as Group;
  }
  const last = path[path.length - 1];
  const existing = group[last];
  if (existing && typeof existing === "object" && !("$value" in (existing as object))) {
    (existing as Group).$root = token;
  } else {
    group[last] = token;
  }
}

const lineHeightRatio = (lineHeight: any, fontSize: number): number => {
  if (lineHeight?.unit === "PIXELS" && fontSize > 0) return round(lineHeight.value / fontSize, 3);
  if (lineHeight?.unit === "PERCENT") return round(lineHeight.value / 100, 3);
  return 1.2;
};

const letterSpacingPx = (letterSpacing: any, fontSize: number) =>
  letterSpacing?.unit === "PERCENT"
    ? px((letterSpacing.value / 100) * fontSize)
    : px(letterSpacing?.value ?? 0);

const fontWeight = (style: string | undefined): number =>
  FONT_WEIGHTS.find(([pattern]) => pattern.test(style ?? ""))?.[1] ?? 400;

function addStyles(root: Group, styles: NonNullable<RawTokens["styles"]>): void {
  for (const style of styles.text ?? []) {
    const fontSize = typeof style.fontSize === "number" ? style.fontSize : 16;
    place(root, splitPath(STYLES_GROUP, "typography", style.name), {
      $type: "typography",
      $value: {
        fontFamily: style.fontName?.family,
        fontWeight: fontWeight(style.fontName?.style),
        fontSize: px(fontSize),
        letterSpacing: letterSpacingPx(style.letterSpacing, fontSize),
        lineHeight: lineHeightRatio(style.lineHeight, fontSize),
      },
      ...(style.description ? { $description: style.description } : {}),
      $extensions: {
        "com.figma": compact({
          styleId: style.id,
          key: style.key,
          fontStyle: style.fontName?.style,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          paragraphSpacing: style.paragraphSpacing || undefined,
          textCase: style.textCase !== "ORIGINAL" ? style.textCase : undefined,
          textDecoration: style.textDecoration !== "NONE" ? style.textDecoration : undefined,
          boundVariables: style.boundVariables,
        }),
      },
    });
  }

  for (const style of styles.effects ?? []) {
    const effects: any[] = (style.effects ?? []).filter((effect: any) => effect.visible !== false);
    const shadows = effects.filter(
      (effect) => effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW"
    );
    const figma = compact({
      styleId: style.id,
      key: style.key,
      effects: shadows.length === effects.length ? undefined : effects,
      boundVariables: style.effectVariables,
    });
    place(
      root,
      splitPath(STYLES_GROUP, "effects", style.name),
      shadows.length > 0
        ? {
            $type: "shadow",
            $value: shadows.map((shadow) => ({
              color: colorValue(shadow.color),
              offsetX: px(shadow.offset?.x ?? 0),
              offsetY: px(shadow.offset?.y ?? 0),
              blur: px(shadow.radius ?? 0),
              spread: px(shadow.spread ?? 0),
              inset: shadow.type === "INNER_SHADOW",
            })),
            ...(style.description ? { $description: style.description } : {}),
            $extensions: { "com.figma": figma },
          }
        : { $value: null, $extensions: { "com.figma": { ...figma, effects } } }
    );
  }

  for (const style of styles.paints ?? []) {
    const paints: any[] = (style.paints ?? []).filter((paint: any) => paint.visible !== false);
    const single = paints.length === 1 ? paints[0] : undefined;
    const figma = compact({
      styleId: style.id,
      key: style.key,
      boundVariables: style.paintVariables,
    });
    let token: Record<string, unknown>;
    if (single?.type === "SOLID") {
      token = {
        $type: "color",
        $value: colorValue(single.color, single.opacity ?? 1),
        $extensions: { "com.figma": figma },
      };
    } else if (single?.type === "GRADIENT_LINEAR" || single?.type === "GRADIENT_RADIAL") {
      token = {
        $type: "gradient",
        $value: (single.gradientStops ?? []).map((stop: any) => ({
          color: colorValue(stop.color, single.opacity ?? 1),
          position: round(stop.position, 4),
        })),
        $extensions: {
          "com.figma": {
            ...figma,
            gradientType: single.type,
            gradientTransform: single.gradientTransform,
          },
        },
      };
    } else {
      token = { $value: null, $extensions: { "com.figma": { ...figma, paints } } };
    }
    if (style.description) token.$description = style.description;
    place(root, splitPath(STYLES_GROUP, "paints", style.name), token);
  }

  for (const style of styles.grids ?? []) {
    place(root, splitPath(STYLES_GROUP, "grids", style.name), {
      $value: null,
      $extensions: {
        "com.figma": compact({
          styleId: style.id,
          key: style.key,
          layoutGrids: style.layoutGrids,
          boundVariables: style.gridVariables,
        }),
      },
    });
  }
}

export function toDtcg(raw: RawTokens): Group {
  const collections = [...raw.collections, ...(raw.libraryCollections ?? [])];
  const paths = new Map<string, string[]>();
  for (const collection of collections) {
    for (const variable of collection.variables)
      paths.set(variable.id, splitPath(collection.name, variable.name));
  }

  const root: Group = {};
  for (const collection of collections) {
    const defaultMode = collection.defaultModeId ?? collection.modes[0]?.modeId;
    for (const variable of collection.variables) {
      const { type, convert } = typeFor(variable);
      const unresolved: string[] = [];
      const valueOf = (raw: unknown): unknown => {
        if (!isAlias(raw)) return convert(raw);
        const target = paths.get(raw.id);
        if (target) return `{${target.join(".")}}`;
        unresolved.push(raw.id);
        return null;
      };
      const modes =
        collection.modes.length > 1
          ? Object.fromEntries(
              collection.modes.map((mode) => [
                mode.name,
                valueOf(variable.valuesByMode[mode.modeId]),
              ])
            )
          : undefined;
      const token = compact({
        $type: type,
        $value: valueOf(defaultMode ? variable.valuesByMode[defaultMode] : undefined),
        $description: variable.description || undefined,
        $extensions: {
          "com.figma": compact({
            variableId: variable.id,
            key: variable.key,
            collection: collection.name,
            resolvedType: variable.resolvedType,
            scopes: variable.scopes,
            codeSyntax:
              variable.codeSyntax && Object.keys(variable.codeSyntax).length
                ? variable.codeSyntax
                : undefined,
            modes,
            remote: collection.remote || undefined,
            unresolvedAliases: unresolved.length ? [...new Set(unresolved)] : undefined,
          }),
        },
      });
      place(root, paths.get(variable.id)!, token);
    }
  }

  if (raw.styles) addStyles(root, raw.styles);
  return root;
}

/** Counts tokens (objects with `$value`) in a DTCG document. */
export function countTokens(group: unknown): number {
  if (!group || typeof group !== "object") return 0;
  if ("$value" in (group as object)) return 1;
  return Object.values(group as Group).reduce<number>((sum, child) => sum + countTokens(child), 0);
}
