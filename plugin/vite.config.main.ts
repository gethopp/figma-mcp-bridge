import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Figma's sandbox runs es2020 code and beyond:
    // https://developers.figma.com/docs/plugins/how-plugins-run/
    target: "es2020",
    lib: {
      entry: "src/main/code.ts",
      formats: ["iife"],
      name: "code",
      fileName: () => "code.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
  },
});
