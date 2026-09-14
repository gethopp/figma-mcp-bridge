import { ancestorPath, compact, safe } from "./safe";

export type PropertyDefinitions = Record<
  string,
  {
    type: ComponentPropertyType;
    defaultValue: string | boolean;
    variantOptions?: string[];
    preferredValues?: InstanceSwapPreferredValue[];
  }
>;

export const propertyDefinitions = (
  node: ComponentNode | ComponentSetNode
): PropertyDefinitions | undefined =>
  safe(() => {
    const out: PropertyDefinitions = {};
    for (const [name, def] of Object.entries(node.componentPropertyDefinitions)) {
      out[name] = {
        type: def.type,
        defaultValue: def.defaultValue,
        variantOptions: def.variantOptions,
        preferredValues: def.preferredValues,
      };
    }
    return out;
  });

const documentationLinks = (node: ComponentNode | ComponentSetNode): string[] | undefined =>
  safe(() => node.documentationLinks.map((link) => link.uri).filter(Boolean));

const parentSet = (component: ComponentNode): ComponentSetNode | null =>
  safe(() =>
    component.parent && component.parent.type === "COMPONENT_SET" ? component.parent : null
  ) ?? null;

/** A compact reference to a component, used on instances. */
export const componentRef = (component: ComponentNode) => {
  const set = parentSet(component);
  return compact({
    id: component.id,
    name: component.name,
    key: safe(() => component.key),
    remote: safe(() => component.remote),
    componentSet: set
      ? compact({ id: set.id, name: set.name, key: safe(() => set.key) })
      : undefined,
    variantProperties: set ? (safe(() => component.variantProperties) ?? undefined) : undefined,
  });
};

/** Full description of a component. Variants carry `variantProperties`; standalone components carry definitions. */
export const componentSummary = (component: ComponentNode) => {
  const set = parentSet(component);
  return compact({
    ...componentRef(component),
    type: "COMPONENT",
    description: safe(() => component.description) || undefined,
    documentationLinks: documentationLinks(component),
    propertyDefinitions: set ? undefined : propertyDefinitions(component),
    path: ancestorPath(component),
  });
};

export const componentSetSummary = (set: ComponentSetNode, withVariants: boolean) =>
  compact({
    id: set.id,
    name: set.name,
    type: "COMPONENT_SET",
    key: safe(() => set.key),
    remote: safe(() => set.remote),
    description: safe(() => set.description) || undefined,
    documentationLinks: documentationLinks(set),
    propertyDefinitions: propertyDefinitions(set),
    variantCount: set.children.length,
    defaultVariantId: safe(() => set.defaultVariant.id),
    path: ancestorPath(set),
    variants: withVariants
      ? set.children.map((variant) =>
          compact({
            id: variant.id,
            name: variant.name,
            variantProperties:
              safe(() => (variant as ComponentNode).variantProperties) ?? undefined,
            description: safe(() => (variant as ComponentNode).description) || undefined,
          })
        )
      : undefined,
  });

/** Which component an instance comes from, its current property values and which layers it overrides. */
export const instanceInfo = async (instance: InstanceNode) => {
  let mainComponent: ReturnType<typeof componentRef> | undefined;
  try {
    const main = await instance.getMainComponentAsync();
    if (main) mainComponent = componentRef(main);
  } catch {
    mainComponent = undefined;
  }
  const componentProperties = safe(() => {
    const out: Record<string, { type: ComponentPropertyType; value: string | boolean }> = {};
    for (const [name, prop] of Object.entries(instance.componentProperties)) {
      out[name] = { type: prop.type, value: prop.value };
    }
    return out;
  });
  const overrides = safe(() =>
    instance.overrides.map((override) => ({ id: override.id, fields: override.overriddenFields }))
  );
  return compact({ mainComponent, componentProperties, overrides });
};
