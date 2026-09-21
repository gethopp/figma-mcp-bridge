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
