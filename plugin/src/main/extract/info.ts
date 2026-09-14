/**
 * Describes the design-system extraction features this plugin build supports, so the server and CLI
 * can detect an older or stock plugin and explain what to update.
 */
export const BRIDGE_INFO = {
  flavor: "magentawood",
  extractionApi: 1,
  requests: [
    "get_bridge_info",
    "get_page_summary",
    "get_component_set",
    "export_subtree",
    "find_assets",
    "export_assets",
    "export_image_fills",
    "get_tokens",
  ],
} as const;
