import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  // hydra-synth's dependencies still reference Node's `global`.
  define: { global: "globalThis" },
  // A local desktop app: one large bundle is fine.
  build: { outDir: "../../dist/renderer", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 4000 },
  server: { strictPort: false },
});
