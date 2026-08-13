import { defineConfig } from "vite";

const outputDirectory = process.env.FIGMA_PLUGIN_OUT_DIR ?? "dist";

export default defineConfig({
  build: {
    target: "es2015",
    lib: {
      entry: "src/main/code.ts",
      formats: ["iife"],
      name: "code",
      fileName: () => "code.js"
    },
    outDir: outputDirectory,
    emptyOutDir: false,
    minify: false
  }
});
