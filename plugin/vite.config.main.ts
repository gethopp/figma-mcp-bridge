import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // The plugin sandbox runs this bundle in Figma's own VM. At an ES2015
    // target esbuild lowers every async function into a generator state
    // machine, and that lowering crashes the VM's bytecode interpreter with
    // "stack underflow". Modern Figma runs native async/await, so the target
    // stays high enough that esbuild emits it directly.
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
