import { getBounds } from "../serializer";
import { componentSetSummary, componentSummary } from "./components";
import { compact, safe } from "./safe";

export type PageSummaryOptions = {
  includeVariants: boolean;
  includeUsage: boolean;
  /** Time limit for counting instance usage; counting stops early and reports `truncated`. */
  usageBudgetMs: number;
};

/**
 * Everything a design-system inventory needs from one page, without serialising layers: top-level
 * frames, every component set (property definitions, variants) and standalone component, where each
 * sits, and optionally how often each component is instantiated on the page.
 */
export const pageSummary = async (page: PageNode, options: PageSummaryOptions) => {
  await page.loadAsync();
  const found = page.findAllWithCriteria({ types: ["COMPONENT_SET", "COMPONENT"] });
  const sets = found.filter((node): node is ComponentSetNode => node.type === "COMPONENT_SET");
  const standalone = found.filter(
    (node): node is ComponentNode =>
      node.type === "COMPONENT" && !(node.parent && node.parent.type === "COMPONENT_SET")
  );

  const summary: Record<string, unknown> = {
    id: page.id,
    name: page.name,
    type: "PAGE",
    topLevel: page.children.map((child) =>
      compact({
        id: child.id,
        name: child.name,
        type: child.type,
        bounds: getBounds(child),
        hidden: child.visible === false ? true : undefined,
      })
    ),
    componentSets: sets.map((set) => ({
      ...componentSetSummary(set, options.includeVariants),
      bounds: getBounds(set),
    })),
    components: standalone.map((component) => ({
      ...componentSummary(component),
      bounds: getBounds(component),
    })),
  };

  if (options.includeUsage) {
    const started = Date.now();
    const instances = page.findAllWithCriteria({ types: ["INSTANCE"] });
    const usage = new Map<string, { id: string; name: string; remote?: boolean; count: number }>();
    let counted = 0;
    for (const instance of instances) {
      if (Date.now() - started > options.usageBudgetMs) break;
      counted++;
      const main = await instance.getMainComponentAsync().catch(() => null);
      if (!main) continue;
      const set = safe(() =>
        main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null
      );
      const key = set ? set.id : main.id;
      const entry = usage.get(key) ?? {
        id: key,
        name: set ? set.name : main.name,
        remote: safe(() => main.remote),
        count: 0,
      };
      entry.count++;
      usage.set(key, entry);
    }
    summary.usage = {
      instances: instances.length,
      counted,
      truncated: counted < instances.length,
      byComponent: [...usage.values()].sort((a, b) => b.count - a.count),
    };
  }

  return summary;
};
