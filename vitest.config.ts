import { defineConfig } from "vitest/config";
import { hydraAlias } from "./hydra-alias.ts";

export default defineConfig({ resolve: { alias: hydraAlias }, test: { include: ["tests/**/*.test.ts"] } });
