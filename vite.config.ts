import { defineConfig } from "vite";
import { hydraAlias } from "./hydra-alias.ts";

export default defineConfig({
  root: "src/renderer",
  resolve: { alias: hydraAlias },
  base: "./",
  // hydra-synth's dependencies still reference Node's `global`.
  define: { global: "globalThis" },
  // A local desktop app: one large bundle is fine.
  build: { outDir: "../../dist/renderer", emptyOutDir: true, target: "esnext", chunkSizeWarningLimit: 4000 },
  server: { strictPort: false },
});
