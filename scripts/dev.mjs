// Development mode: the renderer is served by Vite with hot reload, and
// Electron restarts when main or preload code changes. Sketches reload
// themselves through Ao's own file watcher.
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import electron from "electron";
import { createServer } from "vite";
import { buildElectron } from "./build.mjs";

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

let child = null;
let restarting = false;
async function launch() {
  await buildElectron();
  child = spawn(electron, [".", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, AO_RENDERER_URL: url },
  });
  child.on("exit", () => { if (!restarting) { void server.close(); process.exit(0); } });
}

let timer;
for (const dir of ["src/main", "src/preload", "src/shared"]) {
  watch(dir, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      restarting = true;
      child?.kill();
      await new Promise((r) => child ? child.once("exit", r) : r());
      restarting = false;
      await launch();
    }, 150);
  });
}
await launch();
