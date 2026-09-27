import { app, type BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { coverRect, isBlankFrame, planThumbnails, THUMB_HEIGHT, THUMB_WIDTH } from "../shared/sketch-library";
import type { Store } from "./store";
import { deleteThumbnail, listThumbnails, readRecent, readThumbnail, recordOpened, writeThumbnail } from "./thumbnails";

/**
 * The sketch browser's side of the main process: thumbnail and recent-list
 * IPC, and the `--thumbnails` batch that renders missing thumbnails offscreen.
 */

/**
 * `live` is false for offscreen runs (screenshots, the batch): those neither
 * accept the renderer's live captures nor count as opening a sketch.
 */
export function registerSketchLibraryIpc(store: Store, live: boolean): void {
  ipcMain.handle("thumbnails:read", (_e, name: unknown) => readThumbnail(store.stateDir, name));
  ipcMain.on("thumbnails:save", (_e, name: unknown, png: unknown) => {
    if (!live) return;
    try {
      writeThumbnail(store.stateDir, name, png);
    } catch (error) {
      store.log(`thumbnail for ${String(name)} not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  ipcMain.handle("sketches:recent", () => readRecent(store));
  // A second listener beside the one that saves the last sketch.
  ipcMain.on("state:set-last-sketch", (_e, name: unknown) => { if (live) recordOpened(store, name); });
}

export interface BatchOptions {
  /** Re-render sketches that already have a thumbnail. */
  force: boolean;
  /** Limit the run to these sketches; empty means all. */
  only: string[];
  /** How long each sketch runs before its frame is captured. */
  delayMs: number;
}

/** Hides everything but the visuals: editor, bar, cards, meter and night layer. */
const VISUALS_ONLY = "body > :not(#stage) { display: none !important; }";
const LOAD_TIMEOUT_MS = 20_000;
const CAPTURE_TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function restartRenderer(win: BrowserWindow): Promise<void> {
  const gone = new Promise((resolve) => win.webContents.once("render-process-gone", resolve));
  win.webContents.forcefullyCrashRenderer();
  await within(gone, 5000, "restarting the renderer").catch(() => {});
}

/**
 * Renders each sketch without a thumbnail (every sketch with `force`) in the
 * offscreen window, a few seconds each with the synthetic audio, and writes
 * a 320×180 frame of the visuals to state/thumbnails/<name>.png. It reuses
 * the screenshot path: the same window, flags and capturePage. A sketch that
 * fails, hangs or draws nothing is reported and skipped; the rest carry on.
 * Thumbnails of deleted sketches are pruned. Quits when done, with exit
 * code 1 if any sketch failed.
 */
export async function generateThumbnails(win: BrowserWindow, store: Store, options: BatchOptions): Promise<void> {
  const plan = planThumbnails(store.listSketches(), listThumbnails(store.stateDir), options.force, options.only);
  for (const name of plan.prune) deleteThumbnail(store.stateDir, name);
  const page = join(__dirname, "../renderer/index.html");
  const failed: string[] = [];
  let written = 0;
  for (const name of plan.render) {
    const started = Date.now();
    try {
      // A heavy previous sketch keeps the GPU busy and stalls the navigation
      // (by ten seconds or more under software rendering); throttle it until
      // the next page has loaded.
      win.webContents.setFrameRate(1);
      await within(win.loadFile(page, { query: { sketch: name, hideEditor: "1" } }), LOAD_TIMEOUT_MS, "loading");
      win.webContents.setFrameRate(60);
      await within(win.webContents.insertCSS(VISUALS_ONLY), LOAD_TIMEOUT_MS, "hiding overlays");
      await sleep(options.delayMs);
      // A sketch stuck in a loop still leaves an old frame to capture; make sure the page answers.
      await within(win.webContents.executeJavaScript("0"), CAPTURE_TIMEOUT_MS / 4, "the sketch (not responding)");
      const image = await within(win.webContents.capturePage(), CAPTURE_TIMEOUT_MS, "capture");
      const size = image.getSize();
      const thumb = image.crop(coverRect(size.width, size.height)).resize({ width: THUMB_WIDTH, height: THUMB_HEIGHT, quality: "best" });
      if (isBlankFrame(thumb.toBitmap())) throw new Error("it drew nothing (a black frame)");
      writeThumbnail(store.stateDir, name, thumb.toPNG());
      written++;
      console.log(`thumbnail ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(name);
      console.error(`thumbnail ${name} failed: ${message}`);
      store.log(`thumbnail ${name} failed: ${message}`);
      // A sketch stuck in a loop would hold the renderer; start the next one afresh.
      if (!win.isDestroyed() && /timed out/.test(message)) await restartRenderer(win);
    }
  }
  console.log(`thumbnails: ${written} written, ${plan.skip.length} already there` +
    `${plan.prune.length ? `, ${plan.prune.length} pruned` : ""}` +
    `${failed.length ? `, ${failed.length} failed (${failed.join(", ")})` : ""}`);
  // Electron ignores process.exitCode; exit(1) tells scripts something failed.
  if (failed.length) app.exit(1);
  else app.quit();
}
