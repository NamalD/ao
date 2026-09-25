// Builds the Electron main and preload bundles, then the renderer.
// `--electron-only` skips the renderer, for the dev server.
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

export async function buildElectron() {
  await Promise.all(["main/main", "preload/preload"].map((entry) =>
    esbuild({
      entryPoints: [`src/${entry}.ts`],
      outfile: `dist/electron/${entry.split("/")[1]}.cjs`,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["electron"],
      logLevel: "warning",
    })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildElectron();
  if (!process.argv.includes("--electron-only")) await viteBuild({ logLevel: "warn" });
}
