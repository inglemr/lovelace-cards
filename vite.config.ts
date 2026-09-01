import { defineConfig } from "vite";

// Single-bundle build: src/index.ts imports & registers every card, so HACS
// installs ONE file (homelab-cards.js) that provides all custom elements.
export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "homelab-cards.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: "esbuild",
    target: "es2021",
    rollupOptions: {
      // Bundle everything (incl. lit) into the single file — HA has no bare-import resolver.
      external: [],
      output: { inlineDynamicImports: true },
    },
  },
});
