import { safe } from "./safe";

export type VariableRef = {
  id: string;
  name: string;
  collection?: string;
  remote?: boolean;
};

export type StyleRef = {
  id: string;
  name: string;
  type: string;
  remote: boolean;
};

const STYLE_ID_PROPS = [
  ["fill", "fillStyleId"],
  ["stroke", "strokeStyleId"],
  ["text", "textStyleId"],
  ["effect", "effectStyleId"],
  ["grid", "gridStyleId"],
  ["background", "backgroundStyleId"],
] as const;

const isAlias = (value: unknown): value is VariableAlias =>
  !!value && typeof value === "object" && typeof (value as VariableAlias).id === "string";

/**
 * Resolves variable and style ids to names, caching across a request. Works for local and library
 * (remote) variables and styles that the file uses.
 */
export class RefResolver {
  private readonly variables = new Map<string, VariableRef>();
  private readonly collections = new Map<string, string>();
  private readonly styles = new Map<string, StyleRef | null>();
  private localsLoaded = false;

  private async loadLocalVariables(): Promise<void> {
    if (this.localsLoaded) return;
    this.localsLoaded = true;
    const [collections, variables] = await Promise.all([
      figma.variables.getLocalVariableCollectionsAsync(),
      figma.variables.getLocalVariablesAsync(),
    ]);
    for (const collection of collections) this.collections.set(collection.id, collection.name);
    for (const variable of variables) {
      this.variables.set(variable.id, {
        id: variable.id,
        name: variable.name,
        collection: this.collections.get(variable.variableCollectionId),
        remote: false,
      });
    }
  }

  async variable(id: string): Promise<VariableRef> {
    await this.loadLocalVariables();
    const cached = this.variables.get(id);
    if (cached) return cached;

    let ref: VariableRef = { id, name: id, remote: true };
    try {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (variable) {
        let collection = this.collections.get(variable.variableCollectionId);
        if (!collection) {
          const found = await figma.variables
            .getVariableCollectionByIdAsync(variable.variableCollectionId)
            .catch(() => null);
          if (found) {
            collection = found.name;
            this.collections.set(found.id, found.name);
          }
        }
        ref = { id, name: variable.name, collection, remote: variable.remote };
      }
    } catch {
      // A library variable that isn't available to this file: keep the id as its name.
    }
    this.variables.set(id, ref);
    return ref;
  }

  async style(id: string): Promise<StyleRef | null> {
    if (this.styles.has(id)) return this.styles.get(id) ?? null;
    let ref: StyleRef | null = null;
    try {
      const style = await figma.getStyleByIdAsync(id);
      if (style) ref = { id: style.id, name: style.name, type: style.type, remote: style.remote };
    } catch {
      ref = null;
    }
    this.styles.set(id, ref);
    return ref;
  }

  /**
   * Names of the variables bound to each property of a node, style, paint, effect or text segment,
   * e.g. `{ paddingTop: "spacing/md", fills: ["color/bg/primary"] }`. Nested maps are flattened as
   * `field.key`.
   */
  async boundVariables(target: unknown): Promise<Record<string, string | string[]> | undefined> {
    const bound = safe(() => (target as { boundVariables?: unknown }).boundVariables);
    if (!bound || typeof bound !== "object") return undefined;

    const out: Record<string, string | string[]> = {};
    for (const [field, value] of Object.entries(bound as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const names: string[] = [];
        for (const alias of value)
          if (isAlias(alias)) names.push((await this.variable(alias.id)).name);
        if (names.length) out[field] = names;
      } else if (isAlias(value)) {
        out[field] = (await this.variable(value.id)).name;
      } else if (value && typeof value === "object") {
        const nested = await this.boundVariables({ boundVariables: value });
        if (nested)
          for (const [key, names] of Object.entries(nested)) out[`${field}.${key}`] = names;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** Names of the shared styles applied to a node, e.g. `{ text: "Body/Regular", effect: "Shadow/sm" }`. */
  async styleRefs(node: BaseNode): Promise<Record<string, string> | undefined> {
    const out: Record<string, string> = {};
    for (const [key, prop] of STYLE_ID_PROPS) {
      const id = safe(() => (node as unknown as Record<string, unknown>)[prop]);
      if (typeof id === "symbol") {
        out[key] = "mixed";
      } else if (typeof id === "string" && id) {
        const style = await this.style(id);
        if (style) out[key] = style.name;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }
}
