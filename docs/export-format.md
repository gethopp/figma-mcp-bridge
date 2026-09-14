# Export format

What `figma-mcp-bridge export` (and the `export_file` MCP tool) writes, file by file, and how the pieces relate. Written so an agent can use an export without calling Figma.

Everything is read from the Figma file through the bridge plugin at export time. The export is a **snapshot**: it never changes Figma, and it doesn't update when Figma changes. Re-export to refresh.

## Layout

```
<out>/
├── index.md                      entry point: what was exported, counts, links
├── manifest.json                 machine-readable version of index.md + export options + errors
├── tokens/
│   ├── figma-tokens.json         design tokens exactly as Figma stores them (lossless)
│   └── tokens.dtcg.json          the same tokens converted to W3C Design Tokens (DTCG)
├── components.json               component inventory: sets, variants, properties, usage
├── assets.json                   detected icons/logos/illustrations and their files
├── assets/<NN-page>/<path>/…     exported asset files (.svg, optionally .png)
├── pages/<NN-page>.json          full layer tree per page
├── images/<NN-page>/NN-<frame>.png           screenshot per top-level frame
├── images/<NN-page>/NN-<frame>.part-NN.png   tiles of tall screenshots
└── images/fills/<imageHash>.<ext>            original images used as fills
```

`NN` is the page's position among the file's content pages (separator pages such as `———` are skipped), so names stay stable when exporting a subset of pages. Sections can be switched off (`--only`, `--skip`), so some files may be absent; `manifest.json` records what was requested.

## Design tokens: which file is authoritative

| Source                                             | Role                                                                                                                                   | Lossless?                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Figma variables and styles** (in the Figma file) | Where tokens are **defined and edited**.                                                                                               | —                                             |
| `tokens/figma-tokens.json`                         | Snapshot of those definitions: ids, keys, every mode, aliases by id, scopes, code syntax, styles with the variables bound inside them. | **Yes** — nothing is converted.               |
| `tokens/tokens.dtcg.json`                          | **Derived** from `figma-tokens.json` for tools that read W3C DTCG (e.g. Style Dictionary).                                             | No — see [DTCG conversion](#tokensdtcgjson).  |
| `pages/*.json` → `tokens` / `styleRefs`            | **Usage**: which variable or style each layer property uses. Defines nothing.                                                          | Names only (see [limitations](#limitations)). |
| `components.json`, `assets.json`, screenshots      | Don't contain token definitions.                                                                                                       | —                                             |

Rules that follow from the implementation:

- Values only ever flow **Figma → export**. Editing an exported file changes nothing in Figma, and the next export overwrites it.
- `tokens.dtcg.json` can always be regenerated from `figma-tokens.json`; the reverse isn't true.
- Every DTCG token keeps its Figma identity in `$extensions["com.figma"]` (`variableId`, `key`, `styleId`), so it can be traced back to the definition.
- Hex values in `pages/*.json` (`styles.fills[].color`, etc.) are **resolved values** for that layer as rendered, not definitions. When a layer property is bound to a variable, `tokens` names it.
- Only variables **defined in the file** are exported as definitions. Variables from connected libraries appear under `libraryCollections` only when a local variable aliases them.

## `tokens/figma-tokens.json`

```jsonc
{
  "collections": [
    {
      "id": "VariableCollectionId:5256:372339",
      "name": "1. Color modes",
      "key": "…",                       // library key
      "remote": false,
      "defaultModeId": "5256:0",
      "modes": [{ "modeId": "5256:0", "name": "Light mode" }, { "modeId": "5353:0", "name": "Dark mode" }],
      "variables": [
        {
          "id": "VariableID:5263:372565",
          "name": "Colors/Text/text-primary (900)",  // "/" = Figma group hierarchy
          "key": "…",
          "description": "…",                          // omitted when empty
          "resolvedType": "COLOR",                     // COLOR | FLOAT | STRING | BOOLEAN
          "remote": false,
          "scopes": ["TEXT_FILL"],                     // where Figma allows it to be used
          "codeSyntax": { "WEB": "var(--text-primary)" }, // only when set in Figma
          "valuesByMode": {
            "5256:0": { "type": "VARIABLE_ALIAS", "id": "VariableID:5248:377706" },
            "5353:0": { "type": "VARIABLE_ALIAS", "id": "VariableID:5248:377696" }
          }
        }
      ]
    }
  ],
  "libraryCollections": [ /* same shape; library variables reached through local aliases */ ],
  "styles": {
    "paints":  [{ "id", "name", "key", "remote", "description?", "documentationLinks?", "boundVariables?",
                  "paints": [ /* Figma Paint objects */ ], "paintVariables?": [ { "color": "<variable name>" } | null ] }],
    "text":    [{ "id", "name", …, "fontName": { "family", "style" }, "fontSize", "lineHeight", "letterSpacing",
                  "paragraphSpacing", "paragraphIndent", "textCase", "textDecoration", "leadingTrim?",
                  "boundVariables?": { "fontSize": "<variable name>", "fontFamily": "…", … } }],
    "effects": [{ "id", "name", …, "effects": [ /* Figma Effect objects */ ], "effectVariables?": [ { "color": "…" } ] }],
    "grids":   [{ "id", "name", …, "layoutGrids": [ … ], "gridVariables?": [ … ] }]
  }
}
```

Value shapes in `valuesByMode`:

| `resolvedType` | Value                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `COLOR`        | `{ "type": "COLOR", "r": 0–1, "g": 0–1, "b": 0–1, "a": 0–1 }`                                                                         |
| `FLOAT`        | number (px for sizes; unitless otherwise — check `scopes`)                                                                            |
| `STRING`       | string (e.g. font family, font style name)                                                                                            |
| `BOOLEAN`      | boolean                                                                                                                               |
| any            | alias: `{ "type": "VARIABLE_ALIAS", "id": "<variable id>" }` — resolve through `collections[].variables[].id` or `libraryCollections` |

Resolving an alias: look up the target id, take its value **in the target collection's mode**. When the alias crosses collections, Figma picks the target mode from the consuming layer; without a layer, use the target collection's `defaultModeId`.

`paintVariables` / `effectVariables` / `gridVariables` are index-aligned with `paints` / `effects` / `layoutGrids`; `null` means that entry isn't bound. Style-level `boundVariables` and these lists give variable **names**, not ids.

## `tokens/tokens.dtcg.json`

A [W3C DTCG](https://www.designtokens.org/) document generated from `figma-tokens.json`.

- **Grouping:** `<collection name>` → variable name split on `/`. `.`, `{` and `}` in names are replaced (`.` → `_`), because DTCG reserves them. A variable and a group with the same name coexist via DTCG's `$root`.
- **Value:** `$value` is the collection's **default mode**. When a collection has several modes, all of them are in `$extensions["com.figma"].modes` as `{ "<mode name>": value }`.
- **Aliases** become references: `"{1_ Color modes.Colors.Text.text-primary (900)}"`. An alias to a variable not in the export becomes `null` and is listed in `$extensions["com.figma"].unresolvedAliases`.
- **Types** (`$type`), derived from Figma type and scopes:

  | Figma                                                                                                                                | DTCG                                                                       |
  | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
  | `COLOR`                                                                                                                              | `color`: `{ "colorSpace": "srgb", "components": [r,g,b], "alpha", "hex" }` |
  | `FLOAT` whose scopes are all size-like (radius, width/height, gap, stroke, effect, font size, line height, letter/paragraph spacing) | `dimension`: `{ "value", "unit": "px" }`                                   |
  | `FLOAT` scoped to font weight                                                                                                        | `fontWeight`                                                               |
  | `FLOAT` otherwise (including "all scopes")                                                                                           | `number`                                                                   |
  | `STRING` scoped to font family                                                                                                       | `fontFamily`                                                               |
  | other `STRING`, `BOOLEAN`                                                                                                            | no `$type`; raw value                                                      |

- **Extensions** on every variable token: `variableId`, `key`, `collection`, `resolvedType`, `scopes`, `codeSyntax`, `modes`, `remote`, `unresolvedAliases`.
- **Styles** live under the top-level `figma-styles` group:
  - `figma-styles.typography.*` → `typography` tokens: `fontFamily`, `fontWeight` (inferred from the style name: Regular 400, Medium 500, Semi Bold 600, Bold 700…), `fontSize` px, `letterSpacing` px (percent converted using font size), `lineHeight` as a ratio (px or percent converted; Figma "auto" becomes 1.2). The original Figma values and bound variable names are in `$extensions["com.figma"]`.
  - `figma-styles.effects.*` → `shadow` tokens (drop and inner shadows, in Figma order). Blur-only effects have `$value: null` with the Figma effects in extensions.
  - `figma-styles.paints.*` → a single solid paint becomes `color` (paint opacity folded into alpha); a single linear/radial gradient becomes `gradient`; image paints and stacked paints have `$value: null` with the Figma paints in extensions.
  - `figma-styles.grids.*` → `$value: null`, layout grids in extensions.
- **Composite style tokens hold literal values**, not references to variables, even when the Figma style binds variables — the bound variable names are in `$extensions["com.figma"].boundVariables`.

## `components.json`

```jsonc
{
  "file": "Design system",
  "exportedAt": "…",
  "pages": [
    {
      "id": "18:1350", "name": "Avatars", "slug": "13-avatars",
      "componentSets": [
        {
          "id": "11008:45389", "name": "Avatar", "type": "COMPONENT_SET",
          "key": "…", "remote": false, "description": "…", "documentationLinks": ["https://…"],
          "propertyDefinitions": {
            "Size":                { "type": "VARIANT", "defaultValue": "xs", "variantOptions": ["xs","sm","md","lg","xl","2xl"] },
            "Status icon#11008:0": { "type": "BOOLEAN", "defaultValue": true },
            "Label#3285:0":        { "type": "TEXT", "defaultValue": "…" },
            "Icon#3473:104":       { "type": "INSTANCE_SWAP", "defaultValue": "<component id>", "preferredValues": [ … ] }
          },
          "variantCount": 36,
          "defaultVariantId": "11008:45543",
          "path": ["Section", "Frame"],          // ancestors between page and set
          "bounds": { "x", "y", "width", "height" },
          "variants": [{ "id": "11008:45390", "name": "Size=xl, Border=False, …", "variantProperties": { "Size": "xl", … } }]
        }
      ],
      "components": [ /* standalone components (not in a set): same fields, propertyDefinitions on the component */ ],
      "usage": { "instances": 551, "counted": 551, "truncated": false,
                 "byComponent": [{ "id": "<set or component id>", "name": "…", "remote": false, "count": 407 }] }  // only with --usage
    }
  ]
}
```

Property names other than variants carry Figma's `#<id>` suffix; strip it for display. Names starting with `_` or `.` are, by common convention, private building blocks.

## `assets.json` and `assets/`

Assets are found without naming conventions: nodes of the configured types (default `COMPONENT`) whose visible content is only vector shapes, with no text, no images unless `--asset-images`, and no larger than `--asset-max-size` (default 256 px); plus any node with Figma export settings. A node inside an asset already found is skipped.

```jsonc
{
  "assets": [
    {
      "id": "3463:403660", "name": "align-bottom-01", "type": "COMPONENT",
      "width": 24, "height": 24,
      "path": ["Layout"],                 // ancestors; mirrored in the folder structure
      "reason": "vector-only",            // vector-only | vector-and-image | export-settings
      "vectors": 1,
      "component": { "id", "name", "key", "remote", "componentSet?", "variantProperties?" },
      "page": "Icons",
      "files": { "svg": "assets/05-icons/layout/align-bottom-01.svg", "png?": "…" },
      "error": "…"                        // only when export failed
    }
  ]
}
```

SVGs are exported with text converted to outlines.

## `pages/<NN-page>.json`

The page's full layer tree. Hidden layers are omitted unless exported with `--include-hidden`. Every node:

| Field                        | Contents                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`, `name`, `type`         | Figma node id (instance children look like `I1:2;3:4`), layer name, node type                                                                                                                                                                                                                                                  |
| `bounds`                     | `{ x, y, width, height }`, relative to the parent                                                                                                                                                                                                                                                                              |
| `styles`                     | `opacity`, `blendMode`, `fills`/`strokes` (resolved colors as hex, gradients with stops, images with `imageHash`), `strokeWeight`, `strokeAlign`, `dashPattern`, `effects`, `cornerRadius` / `cornerRadii`, `autoLayout` (`direction`, `gap`, alignment, sizing, `wrap`), `padding`, `clipsContent`, `rotation`, `constraints` |
| `layout`                     | Present when relevant: `layoutMode`, `layoutSizingHorizontal/Vertical` (FIXED/HUG/FILL), `layoutPositioning`, `layoutGrow`, `minWidth`/`maxWidth`/`minHeight`/`maxHeight`, grid layout (`gridRowCount`, `gridColumnCount`, gaps, sizes, spans), per-side stroke weights, `layoutGrids`                                         |
| `tokens`                     | Variable **name** bound to each property: `{ "fills": ["Colors/Text/…"], "paddingTop": "spacing-xl", "topLeftRadius": "radius-md" }`                                                                                                                                                                                           |
| `styleRefs`                  | Shared style **names**: `{ "text": "Text md/Regular", "effect": "Shadows/shadow-sm", "fill": "…" }` (`"mixed"` when a text node mixes styles)                                                                                                                                                                                  |
| `hidden`, `locked`, `isMask` | Only when true                                                                                                                                                                                                                                                                                                                 |
| `reactions`                  | Prototype interactions: `[{ "trigger": { "type": "ON_CLICK" }, "actions": [ … ] }]`                                                                                                                                                                                                                                            |
| `annotations`                | Dev Mode annotations: label, markdown, measured properties                                                                                                                                                                                                                                                                     |
| `exportSettings`             | The node's Figma export settings                                                                                                                                                                                                                                                                                               |
| `children`                   | Child nodes                                                                                                                                                                                                                                                                                                                    |

Additional fields by type:

- **TEXT:** `characters`; `styles` gains `fontSize`, `fontFamily`, `fontStyle`, `fontWeight`, `lineHeight`, `letterSpacing`, alignment, `textAutoResize`; `font` summarises the node (`family`, `style`, `weight`, `size`, `lineHeight`, `letterSpacing`, `textStyle` — each a value or `"mixed"`); when styling varies within the text, `segments` lists each run with `start`, `end`, `characters`, font, `fills`, `textStyle`, `fillStyle`, `tokens`, `textCase`, `textDecoration`, list type, `hyperlink`.
- **INSTANCE:** `mainComponent` `{ id, name, key, remote, componentSet: { id, name, key }, variantProperties }`; `componentProperties` `{ "<name>": { type, value } }` (current values); `overrides` `[{ id: "<layer id>", fields: ["characters", "fills", …] }]`.
- **COMPONENT:** `key`, `remote`, `description`, `documentationLinks`; variants add `variantProperties`, standalone components add `propertyDefinitions`.
- **COMPONENT_SET:** `key`, `description`, `documentationLinks`, `propertyDefinitions`, `variantCount`, `defaultVariantId`.
- **PAGE (root):** `backgrounds`.

## Screenshots and image fills

- One PNG per visible top-level frame, section, group, component, component set or instance, at `--scale` (default 1; reduced automatically so no side exceeds 16384 px). `manifest.json` records the scale used.
- Screenshots taller than 1.25 × `--tile-height` (default 2000 px) are also cut into `.part-NN.png` tiles, top to bottom.
- `images/fills/` holds the original bytes of every image referenced by an `imageHash` in the exported layer trees.

## `manifest.json`

`file`, `exportedAt`, `bridge` (plugin capabilities), `options` (pages, sections, scales, asset settings), `missingPages` (requested pages not found), `errors` (per-section or per-page failures — the export continues past them), and summaries: `tokens` (collections with modes and counts, style counts, DTCG token count), `components` (counts per page and a flat list with property names), `assets` (counts per page), `pages[]` (`slug`, `file`, `topLevel` frames with sizes, `summary` with node counts by type, text layers, and how often each component, variable and style is used, `images` with tiles), `imageFills`.

## Limitations

- **Names, not ids, on usage.** `tokens`, `styleRefs`, `boundVariables` and `*Variables` give variable/style **names**. If two collections contain a variable with the same name, the name alone is ambiguous; resolve through `figma-tokens.json`.
- **Library tokens.** Library variables are exported only when a local variable aliases them; library styles only appear by name where layers use them.
- **Mode per layer.** Layer colors in `styles` are resolved for the mode applied to that layer in Figma; the export doesn't record which mode a frame overrides.
- **DTCG is lossy** as described above (default mode as `$value`, inferred font weights, line-height ratios, literal values inside composite style tokens, styles without a DTCG type).
- **Snapshot.** Nothing tracks later Figma changes; compare two exports to see what changed.
