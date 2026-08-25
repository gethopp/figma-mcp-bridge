import { LayerNode, Unit } from "./types";

export const hasChildren = <T>(node: T) =>
  // @ts-expect-error
  node && Array.isArray(node.children);

export function traverse(
  layer: LayerNode,
  cb: (layer: LayerNode, parent: LayerNode | null) => void,
  parent: LayerNode | null = null
) {
  if (layer) {
    cb(layer, parent);
    if (hasChildren<LayerNode>(layer)) {
      // @ts-expect-error
      layer.children.forEach((child) => traverse(child as LayerNode, cb, layer));
    }
  }
}

export function traverseMap<T>(
  layer: T,
  cb: (layer: T, parent: T | null) => T | undefined,
  parent: T | null = null
) {
  if (layer) {
    const newLayer = cb(layer, parent);
    // @ts-expect-error
    if (newLayer?.children?.length) {
      // @ts-expect-error
      newLayer.children = newLayer.children.map((child) => traverseMap(child, cb, layer));
    }
    return newLayer;
  }
}

export async function traverseAsync<T>(
  layer: T,
  cb: (layer: T, parent: T | null) => void,
  parent: T | null = null
) {
  if (layer) {
    await cb(layer, parent);
    if (hasChildren(layer)) {
      // @ts-ignore
      for (let child of layer.children.reverse()) {
        await traverseAsync(child as T, cb, layer);
      }
    }
  }
}

export function size(obj: object) {
  return Object.keys(obj).length;
}

export const capitalize = (str: string) => str[0].toUpperCase() + str.substring(1);

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function getRgb(colorString?: string | null): ParsedColor | null {
  if (!colorString) {
    return null;
  }
  const [_1, r, g, b, _2, a] = (colorString!.match(
    /rgba?\(([\d\.]+), ([\d\.]+), ([\d\.]+)(, ([\d\.]+))?\)/
  )! || []) as string[];

  const none = a && parseFloat(a) === 0;

  if (r && g && b && !none) {
    return {
      r: parseInt(r) / 255,
      g: parseInt(g) / 255,
      b: parseInt(b) / 255,
      a: a ? parseFloat(a) : 1,
    };
  }
  return null;
}

export const fastClone = (data: any) =>
  typeof data === "symbol" ? null : JSON.parse(JSON.stringify(data));

export const toNum = (v: string): number => {
  // if (!/px$/.test(v) && v !== '0') return v;
  if (!/px$/.test(v) && v !== "0") return 0;
  const n = parseFloat(v);
  // return !isNaN(n) ? n : v;
  return !isNaN(n) ? n : 0;
};

export const toPercent = (v: string): number => {
  // if (!/px$/.test(v) && v !== '0') return v;
  if (!/%$/.test(v) && v !== "0") return 0;
  const n = parseInt(v);
  // return !isNaN(n) ? n : v;
  return !isNaN(n) ? n / 100 : 0;
};

export const parseUnits = (str?: string | null, relative?: number): null | Unit => {
  if (!str) {
    return null;
  }
  let value = toNum(str);
  if (relative && !value) {
    const percent = toPercent(str);

    if (!percent) return null;

    value = relative * percent;
  }
  // const match = str.match(/([\d\.]+)px/);
  // const val = match && match[1];
  if (value) {
    return {
      unit: "PIXELS",
      value,
    };
  }
  return null;
};

const LENGTH_REG = /^[0-9]+[a-zA-Z%]+?$/;

const isLength = (v: string) => v === "0" || LENGTH_REG.test(v);

interface ParsedBoxShadow {
  inset: boolean;
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadRadius: number;
  color: ParsedColor;
}

const parseMultipleCSSValues = (str: string) => {
  const parts = [];
  let lastSplitIndex = 0;
  let skobka = false;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === "," && !skobka) {
      parts.push(str.slice(lastSplitIndex, i));
      lastSplitIndex = i + 1;
    } else if (str[i] === "(") {
      skobka = true;
    } else if (str[i] === ")") {
      skobka = false;
    }
  }
  parts.push(str.slice(lastSplitIndex));

  return parts.map((s) => s.trim());
};

export const parseBoxShadowValue = (str: string): ParsedBoxShadow => {
  // TODO: this is broken for multiple box shadows
  if (str.startsWith("rgb")) {
    // Werid computed style thing that puts the color in the front not back
    const colorMatch = str.match(/(rgba?\(.+?\))(.+)/);
    if (colorMatch) {
      str = (colorMatch[2] + " " + colorMatch[1]).trim();
    }
  }

  const PARTS_REG = /\s(?![^(]*\))/;
  const parts = str.split(PARTS_REG);
  const inset = parts.includes("inset");
  const last = parts.slice(-1)[0];
  const color = !isLength(last) ? last : "rgba(0, 0, 0, 1)";

  const nums = parts
    .filter((n) => n !== "inset")
    .filter((n) => n !== color)
    .map(toNum);

  const [offsetX, offsetY, blurRadius, spreadRadius] = nums;

  const parsedColor = getRgb(color);

  if (!parsedColor) {
    console.error("Parse color error: " + color);
  }

  return {
    inset,
    offsetX,
    offsetY,
    blurRadius,
    spreadRadius,
    color: parsedColor || { r: 0, g: 0, b: 0, a: 1 },
  };
};

export const getOpacity = (styles: CSSStyleDeclaration) => {
  return Number(styles.opacity);
};

export const parseBoxShadowValues = (str: string): ParsedBoxShadow[] => {
  const values = parseMultipleCSSValues(str);

  return values.map((s) => parseBoxShadowValue(s));
};

export function getImageFills(layer: RectangleNode | TextNode) {
  const images = Array.isArray(layer.fills) && layer.fills.filter((item) => item.type === "IMAGE");
  return images;
}

export const defaultPlaceholderColor = getRgb("rgba(178, 178, 178, 1)");
