import type { RefResolver } from "./refs";
import { compact, safe, sanitize } from "./safe";

const serializeValue = (value: VariableValue): unknown => {
  if (value && typeof value === "object") {
    if ("type" in value && value.type === "VARIABLE_ALIAS")
      return { type: "VARIABLE_ALIAS", id: value.id };
    if ("r" in value && "g" in value && "b" in value) {
      return { type: "COLOR", r: value.r, g: value.g, b: value.b, a: "a" in value ? value.a : 1 };
    }
  }
  return value;
};

const serializeVariable = (variable: Variable) =>
  compact({
    id: variable.id,
    name: variable.name,
    key: safe(() => variable.key),
    description: variable.description || undefined,
    resolvedType: variable.resolvedType,
    remote: variable.remote,
    hiddenFromPublishing: safe(() => variable.hiddenFromPublishing) || undefined,
    scopes: safe(() => [...variable.scopes]),
    codeSyntax: safe(() => ({ ...variable.codeSyntax })),
    valuesByMode: Object.fromEntries(
      Object.entries(variable.valuesByMode).map(([modeId, value]) => [
        modeId,
        serializeValue(value),
      ])
    ),
  });

const serializeCollection = (collection: VariableCollection, variables: Variable[]) =>
  compact({
    id: collection.id,
    name: collection.name,
    key: safe(() => collection.key),
    remote: collection.remote,
    hiddenFromPublishing: safe(() => collection.hiddenFromPublishing) || undefined,
    defaultModeId: collection.defaultModeId,
    modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
    variables: variables.map(serializeVariable),
  });

const aliasIds = (variables: Variable[]): string[] => {
  const ids: string[] = [];
  for (const variable of variables) {
    for (const value of Object.values(variable.valuesByMode)) {
      if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        value.type === "VARIABLE_ALIAS"
      ) {
        ids.push(value.id);
      }
    }
  }
  return ids;
};

/**
 * Library (remote) variables that local variables alias, followed transitively, grouped by collection.
 * Only variables the file actually references are reachable from the plugin API.
 */
const libraryCollections = async (localVariables: Variable[]) => {
  const known = new Set(localVariables.map((variable) => variable.id));
  const remote = new Map<string, Variable>();
  let queue = aliasIds(localVariables).filter((id) => !known.has(id));
  while (queue.length) {
    const next: Variable[] = [];
    for (const id of queue) {
      if (known.has(id)) continue;
      known.add(id);
      const variable = await figma.variables.getVariableByIdAsync(id).catch(() => null);
      if (variable) {
        remote.set(id, variable);
        next.push(variable);
      }
    }
    queue = aliasIds(next).filter((id) => !known.has(id));
  }

  const byCollection = new Map<string, Variable[]>();
  for (const variable of remote.values()) {
    const list = byCollection.get(variable.variableCollectionId) ?? [];
    list.push(variable);
    byCollection.set(variable.variableCollectionId, list);
  }
  const collections: unknown[] = [];
  for (const [collectionId, variables] of byCollection) {
    const collection = await figma.variables
      .getVariableCollectionByIdAsync(collectionId)
      .catch(() => null);
    collections.push(
      collection
        ? serializeCollection(collection, variables)
        : {
            id: collectionId,
            name: "(unavailable library collection)",
            remote: true,
            variables: variables.map(serializeVariable),
          }
    );
  }
  return collections;
};

const styleBase = async (style: BaseStyle, refs: RefResolver) =>
  compact({
    id: style.id,
    name: style.name,
    key: safe(() => style.key),
    remote: style.remote,
    description: style.description || undefined,
    documentationLinks: safe(() => style.documentationLinks.map((link) => link.uri)),
    boundVariables: await refs.boundVariables(style),
  });

/** Bound variable names per paint / effect / grid, index-aligned with the style's list. */
const listBoundVariables = async (items: readonly unknown[], refs: RefResolver) => {
  const names = [];
  for (const item of items) names.push((await refs.boundVariables(item)) ?? null);
  return names.some(Boolean) ? names : undefined;
};

/**
 * All design tokens a file defines: local variable collections (modes, scopes, code syntax, aliases),
 * the library variables they alias, and every local paint, text, effect and grid style with the
 * variables bound inside it.
 */
export const getTokens = async (refs: RefResolver, includeLibraries: boolean) => {
  const [collections, variables, paints, texts, effects, grids] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.getLocalGridStylesAsync(),
  ]);
  const byCollection = new Map<string, Variable[]>();
  for (const variable of variables) {
    const list = byCollection.get(variable.variableCollectionId) ?? [];
    list.push(variable);
    byCollection.set(variable.variableCollectionId, list);
  }

  const styles = {
    paints: [] as unknown[],
    text: [] as unknown[],
    effects: [] as unknown[],
    grids: [] as unknown[],
  };
  for (const style of paints) {
    styles.paints.push({
      ...(await styleBase(style, refs)),
      paints: sanitize(style.paints),
      paintVariables: await listBoundVariables(style.paints, refs),
    });
  }
  for (const style of texts) {
    styles.text.push({
      ...(await styleBase(style, refs)),
      ...(sanitize(
        compact({
          fontName: style.fontName,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          paragraphSpacing: style.paragraphSpacing,
          paragraphIndent: style.paragraphIndent,
          listSpacing: safe(() => style.listSpacing),
          textCase: style.textCase,
          textDecoration: style.textDecoration,
          leadingTrim: safe(() => style.leadingTrim),
          hangingPunctuation: safe(() => style.hangingPunctuation),
          hangingList: safe(() => style.hangingList),
        })
      ) as Record<string, unknown>),
    });
  }
  for (const style of effects) {
    styles.effects.push({
      ...(await styleBase(style, refs)),
      effects: sanitize(style.effects),
      effectVariables: await listBoundVariables(style.effects, refs),
    });
  }
  for (const style of grids) {
    styles.grids.push({
      ...(await styleBase(style, refs)),
      layoutGrids: sanitize(style.layoutGrids),
      gridVariables: await listBoundVariables(style.layoutGrids, refs),
    });
  }

  return {
    collections: collections.map((collection) =>
      serializeCollection(collection, byCollection.get(collection.id) ?? [])
    ),
    libraryCollections: includeLibraries ? await libraryCollections(variables) : undefined,
    styles,
  };
};
