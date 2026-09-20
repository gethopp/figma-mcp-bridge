/**
 * Build-time environment the UI reads through `import.meta.env`.
 *
 * Declared here rather than via `vite/client` so the Figma sandbox code in
 * `src/main` does not also pick up Vite's DOM and asset ambient types, which
 * would overlap with `assets.d.ts`.
 */
interface ImportMetaEnv {
  /**
   * WebSocket endpoint of the bridge server. Overrides the built-in default.
   * A custom endpoint must also be listed in manifest.json's
   * networkAccess.allowedDomains.
   */
  readonly VITE_FIGMA_BRIDGE_WS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
