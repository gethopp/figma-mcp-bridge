import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const bridgePort = Number(process.env.FIGMA_BRIDGE_PORT ?? "1994");
if (!Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65535) {
  throw new Error("FIGMA_BRIDGE_PORT must be an integer between 1 and 65535");
}

const outputDirectory = process.env.FIGMA_PLUGIN_OUT_DIR ?? "dist";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: "./src/ui",
  define: {
    __FIGMA_BRIDGE_PORT__: JSON.stringify(bridgePort)
  },
  build: {
    target: "es2015",
    cssCodeSplit: false,
    outDir: `../../${outputDirectory}`,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    },
    emptyOutDir: true
  }
});
