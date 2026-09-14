import type { ExportManifest } from "./exporter.js";

const cell = (text: unknown): string =>
  String(text ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ");

const top = (counts: Record<string, number> | undefined, n: number) =>
  Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

const COMPONENT_LIST_LIMIT = 60;

/** Renders the export's entry point for people and agents: what was exported and where to look next. */
export function renderIndex(m: ExportManifest): string {
  const okPages = m.pages.filter((page) => page.status === "ok");
  const screenshots = okPages.reduce(
    (sum, page) => sum + page.images.filter((image) => image.file).length,
    0
  );
  const lines: string[] = [
    `# Figma export: ${m.file}`,
    "",
    `Exported ${m.exportedAt}. Start here, then open only the files you need.`,
    "",
    "| Section | Contents | Where |",
    "|---|---|---|",
  ];

  if (m.tokens) {
    const variables = m.tokens.collections.reduce(
      (sum, collection) => sum + collection.variables,
      0
    );
    const styles = m.tokens.styles;
    lines.push(
      `| Tokens | ${m.tokens.collections.length} variable collections (${variables} variables), ` +
        `${styles.paints + styles.text + styles.effects + styles.grids} styles | ` +
        `[${m.tokens.files.dtcg}](${m.tokens.files.dtcg}) (W3C DTCG), [${m.tokens.files.raw}](${m.tokens.files.raw}) (raw Figma) |`
    );
  }
  if (m.components) {
    lines.push(
      `| Components | ${m.components.sets} component sets (${m.components.variants} variants), ${m.components.components} standalone components | [${m.components.file}](${m.components.file}) |`
    );
  }
  if (m.assets) {
    lines.push(
      `| Assets | ${m.assets.count} vector assets${m.assets.failed ? ` (${m.assets.failed} failed)` : ""} | [${m.assets.file}](${m.assets.file}), \`assets/\` |`
    );
  }
  if (m.pages.length) {
    const nodes = okPages.reduce((sum, page) => sum + (page.summary?.nodes ?? 0), 0);
    lines.push(
      `| Pages | ${okPages.length} of ${m.pages.length} pages${nodes ? `, ${nodes} layers` : ""}${screenshots ? `, ${screenshots} screenshots` : ""} | \`pages/\`, \`images/\` |`
    );
  }
  if (m.imageFills)
    lines.push(
      `| Image fills | ${m.imageFills.count} original images | \`${m.imageFills.dir}/\` |`
    );

  lines.push(
    "",
    "**Reading the files.** Page JSON is the full layer tree: every node has `id`, `name`, `type`, `bounds` and `styles` " +
      "(fills, strokes, effects, radius, auto layout, padding, constraints) plus `layout` for sizing, min/max and grid " +
      "details. `tokens` names the variable bound to each property and `styleRefs` the shared styles. Text nodes add " +
      "`characters`, a `font` summary and per-run `segments`. Instances add `mainComponent`, `componentProperties` and " +
      "`overrides`; components add `propertyDefinitions`. Tall screenshots also come as `.part-NN.png` tiles — read those " +
      "instead of the full image."
  );

  if (m.missingPages.length)
    lines.push("", `**Pages not found:** ${m.missingPages.map(cell).join(", ")}`);
  if (m.errors.length)
    lines.push("", "**Errors:**", ...m.errors.map((error) => `- ${cell(error)}`));

  if (m.tokens) {
    lines.push("", "## Tokens", "", "| Collection | Modes | Variables |", "|---|---|---|");
    for (const collection of m.tokens.collections) {
      lines.push(
        `| ${cell(collection.name)}${collection.remote ? " (library)" : ""} | ${collection.modes.map(cell).join(", ")} | ${collection.variables} |`
      );
    }
    const s = m.tokens.styles;
    lines.push(
      "",
      `Styles: ${s.paints} paint, ${s.text} text, ${s.effects} effect, ${s.grids} grid. ${m.tokens.dtcgTokens} tokens in the DTCG file.`
    );
  }

  if (m.components) {
    lines.push(
      "",
      "## Components",
      "",
      "| Page | Component sets | Standalone components |",
      "|---|---|---|"
    );
    for (const page of m.components.byPage)
      lines.push(`| ${cell(page.name)} | ${page.sets} | ${page.components} |`);
    const shown = m.components.list
      .filter((item) => !item.name.startsWith("_") && !item.name.startsWith("."))
      .slice(0, COMPONENT_LIST_LIMIT);
    if (shown.length) {
      lines.push("", "| Component | Page | Variants | Properties | Id |", "|---|---|---|---|---|");
      for (const item of shown) {
        const properties = item.properties.map((name) => name.replace(/#\d+:\d+$/, "")).join(", ");
        lines.push(
          `| ${cell(item.name)} | ${cell(item.page)} | ${item.variantCount ?? "—"} | ${cell(properties)} | \`${item.id}\` |`
        );
      }
      const hidden = m.components.list.length - shown.length;
      if (hidden > 0)
        lines.push(
          "",
          `${hidden} more (including private \`_\`/\`.\` components) in ${m.components.file}.`
        );
    }
  }

  if (m.assets?.byPage.length) {
    lines.push("", "## Assets", "", "| Page | Assets | Folder |", "|---|---|---|");
    for (const page of m.assets.byPage)
      lines.push(`| ${cell(page.name)} | ${page.count} | \`assets/${page.slug}/\` |`);
  }

  if (m.pages.length) {
    lines.push(
      "",
      "## Pages",
      "",
      "| Page | Top-level | Layers | Text layers | Instances | JSON |",
      "|---|---|---|---|---|---|"
    );
    for (const page of m.pages) {
      if (page.status !== "ok") {
        lines.push(`| ${cell(page.name)} | — | failed: ${cell(page.error)} | | | |`);
        continue;
      }
      const instances = Object.values(page.summary?.instances ?? {}).reduce(
        (sum, count) => sum + count,
        0
      );
      lines.push(
        `| ${cell(page.name)} | ${page.topLevel.length} | ${page.summary?.nodes ?? "—"} | ${page.summary?.textLayers ?? "—"} | ` +
          `${page.summary ? instances : "—"} | ${page.file ? `[${page.file}](${page.file})` : "—"} |`
      );
    }

    for (const page of okPages) {
      lines.push(
        "",
        `### ${page.name}`,
        "",
        "| Frame | Type | Size | Screenshot |",
        "|---|---|---|---|"
      );
      for (const frame of page.topLevel) {
        const image = page.images.find((item) => item.id === frame.id);
        const shot = image?.file
          ? `[png](${image.file})${image.tiles.length ? ` · ${image.tiles.length} tiles` : ""}`
          : image?.error
            ? "failed"
            : "—";
        lines.push(
          `| ${cell(frame.name)} \`${frame.id}\` | ${frame.type} | ${Math.round(frame.width ?? 0)}×${Math.round(frame.height ?? 0)} | ${shot} |`
        );
      }
      const used: [string, [string, number][]][] = [
        ["Components used", top(page.summary?.instances, 12)],
        ["Variables used", top(page.summary?.variables, 15)],
        ["Styles used", top(page.summary?.styles, 10)],
      ];
      for (const [label, items] of used) {
        if (items.length)
          lines.push(
            "",
            `**${label}:** ${items.map(([name, count]) => `${cell(name)} ×${count}`).join(" · ")}`
          );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
