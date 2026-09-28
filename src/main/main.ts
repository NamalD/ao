import { app, BrowserWindow, ipcMain } from "electron";
import { watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Capture, startCapture, startFakeCapture } from "./capture";
import { saveChallenge } from "./challenge-log";
import { isAppNavigation } from "./navigation";
import { setupRecording } from "./recording";
import { generateThumbnails, registerSketchLibraryIpc } from "./sketch-library";
import { syncSketches } from "./sketch-sync";
import { Store } from "./store";
import { mergeSettings, normalizeSettings, Settings } from "../shared/settings";
import { normalizeAutopilot } from "../shared/autopilot";

interface WindowState { x?: number; y?: number; width: number; height: number; fullscreen: boolean }
interface Options {
  fakeAudio: boolean; sketch?: string; screenshot?: string; delay: number; hideEditor: boolean;
  /** Screenshots ignore saved settings; these opt in to the overlays. */
  meter: boolean; night?: string;
  /** `--thumbnails[=a,b]`: render missing sketch thumbnails offscreen, then quit. */
  thumbnails?: string[]; force: boolean;
  /** `--autopilot[=dwellSeconds]` and `--fade=seconds`: this session only, never saved. */
  autopilot?: string; fade?: string;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string) => argv.find((a) => a.startsWith(`--${flag}=`))?.split("=").slice(1).join("=");
  return {
    fakeAudio: argv.includes("--fake-audio"),
    sketch: value("sketch"),
    screenshot: value("screenshot"),
    delay: Number(value("screenshot-delay") ?? 3000),
    hideEditor: argv.includes("--hide-editor"),
    meter: argv.includes("--meter"),
    night: value("night"),
    thumbnails: argv.includes("--thumbnails") ? [] : value("thumbnails")?.split(",").filter(Boolean),
    force: argv.includes("--force"),
    autopilot: value("autopilot") ?? (argv.includes("--autopilot") ? "" : undefined),
    fade: value("fade"),
  };
}

const options = parseOptions(process.argv);
/** Screenshots and the thumbnail batch render offscreen, ignoring saved settings. */
const headless = Boolean(options.screenshot || options.thumbnails);
const store = new Store(app.getAppPath());
app.commandLine.appendSwitch("ozone-platform-hint", "auto");
// Live coding needs eval, which is exactly what this warning is about.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

function createWindow(): BrowserWindow {
  const saved = store.read<WindowState>("window", { width: 1280, height: 720, fullscreen: false });
  const win = new BrowserWindow({
    ...saved,
    title: "Ao",
    backgroundColor: "#020208",
    autoHideMenuBar: true,
    show: !headless,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      // Screenshots render offscreen: hidden windows are throttled to ~1 fps.
      offscreen: headless,
    },
  });
  if (headless) win.webContents.setFrameRate(60);
  // Sketches may load remote media, but never replace Ao with a remote page:
  // that page would get the preload bridge. New windows are denied outright.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppNavigation(url, win.webContents.getURL())) {
      event.preventDefault();
      store.log(`blocked navigation to ${url}`);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    store.log(`blocked window.open(${url})`);
    return { action: "deny" };
  });
  const remember = () => {
    if (win.isDestroyed()) return;
    const fullscreen = win.isFullScreen();
    store.write("window", fullscreen ? { ...saved, fullscreen } : { ...win.getNormalBounds(), fullscreen });
  };
  win.on("moved", remember);
  win.on("resized", remember);
  win.on("enter-full-screen", remember);
  win.on("leave-full-screen", remember);

  const query: Record<string, string> = {};
  if (options.sketch) query.sketch = options.sketch;
  if (options.hideEditor) query.hideEditor = "1";
  const devUrl = process.env.AO_RENDERER_URL;
  if (devUrl) void win.loadURL(`${devUrl}?${new URLSearchParams(query)}`);
  else void win.loadFile(join(__dirname, "../renderer/index.html"), { query });
  return win;
}

function registerIpc(win: () => BrowserWindow | null): void {
  ipcMain.handle("sketches:list", () => store.listSketches());
  ipcMain.handle("sketches:read", (_e, name: string) => store.readSketch(name));
  ipcMain.handle("sketches:write", (_e, name: string, code: string) => store.writeSketch(name, code));
  ipcMain.handle("sketches:rename", (_e, from: string, to: string, code: string, overwrite: boolean) =>
    store.renameSketch(from, to, code, overwrite));
  ipcMain.handle("state:last-sketch", () => store.read("session", { sketch: "" }).sketch);
  ipcMain.on("state:set-last-sketch", (_e, sketch: string) => { if (!headless) store.write("session", { sketch }); });
  ipcMain.on("window:fullscreen", () => { const w = win(); w?.setFullScreen(!w.isFullScreen()); });
  ipcMain.on("app:quit", () => app.quit());
  ipcMain.on("log", (_e, message: string) => store.log(message));
  ipcMain.handle("settings:read", () => withFlags(readSettings()));
  ipcMain.on("settings:update", (_e, patch: unknown) => {
    if (!headless) store.write("settings", mergeSettings(readSettings(), patch));
  });
  registerSketchLibraryIpc(store, !headless);
  ipcMain.handle("challenge:finish", (_e, result: unknown) =>
    saveChallenge(store, result, async () => (await win()!.webContents.capturePage()).toPNG()));
}

/** `state/settings.json`, or for screenshots only what the flags ask for. */
function readSettings(): Settings {
  if (headless) return normalizeSettings({ meter: options.meter, night: { mode: options.night ?? "off" } });
  return normalizeSettings(store.read("settings", {}));
}

/** Applies the autopilot flags for this session on top of the saved settings. */
function withFlags(settings: Settings): Settings {
  const patch: Record<string, unknown> = {};
  if (options.autopilot !== undefined) {
    patch.enabled = true;
    const dwell = Number(options.autopilot);
    // A short dwell for trying it out also shortens the section minimum.
    if (options.autopilot && Number.isFinite(dwell)) Object.assign(patch, { dwellSeconds: dwell, minSeconds: dwell });
  }
  if (options.fade !== undefined) patch.fadeSeconds = Number(options.fade);
  return { ...settings, autopilot: normalizeAutopilot({ ...settings.autopilot, ...patch }, settings.autopilot) };
}

function watchSketches(send: (name: string) => void): void {
  const timers = new Map<string, NodeJS.Timeout>();
  watch(store.sketchDir, (_event, file) => {
    if (!file?.endsWith(".js")) return;
    const name = file.slice(0, -3);
    // Editors often write a file in several steps; report once it settles.
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => send(name), 80));
  });
}

void app.whenReady().then(() => {
  let win: BrowserWindow | null = createWindow();
  win.on("closed", () => { win = null; });
  const send = (channel: string, ...args: unknown[]) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  };
  registerIpc(() => win);
  watchSketches((name) => send("sketches:changed", name));

  const report = (message: string) => { store.log(message); send("status", message); };
  win.webContents.on("console-message", ({ level, message, sourceId, lineNumber }) => {
    if (level === "warning" || level === "error") store.log(`renderer ${level}: ${message} (${sourceId}:${lineNumber})`);
  });
  const recording = setupRecording(() => win, (message) => store.log(message));
  let capture: Capture;
  win.webContents.once("did-finish-load", () => {
    capture = options.fakeAudio || headless
      ? startFakeCapture((f) => send("audio", f), recording.pcm)
      : startCapture((f) => send("audio", f), report, recording.pcm);
  });
  app.on("before-quit", () => capture?.stop());

  if (options.screenshot) {
    const path = options.screenshot;
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      const fps = await win!.webContents.executeJavaScript("document.getElementById('fps').textContent");
      console.log(`screenshot ${path} at ${fps}`);
      const image = await win!.webContents.capturePage();
      writeFileSync(path, image.toPNG());
      app.quit();
    }, options.delay));
  } else if (options.thumbnails) {
    const batch = { force: options.force, only: options.thumbnails, delayMs: options.delay };
    win.webContents.once("did-finish-load", () => void generateThumbnails(win!, store, batch));
  }
});

app.on("window-all-closed", () => app.quit());

// Closing Ao commits changed sketches and pushes them in the background.
app.on("will-quit", () => {
  if (headless) return;
  const { committed, error } = syncSketches(app.getAppPath(), store.logPath);
  if (error) store.log(`sketch sync failed: ${error}`);
  else if (committed.length) store.log(`committed sketches: ${committed.join(", ")}; pushing`);
});
