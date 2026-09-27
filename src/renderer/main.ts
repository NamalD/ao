import Hydra from "hydra-synth";
import type { Bridge } from "../preload/preload";
import { ao, updateAudio } from "./audio";
import { SketchBrowser } from "./browser/sketch-browser";
import { ThumbnailCapture } from "./browser/thumbnail-capture";
import { ChallengeMode } from "./challenges/challenge-mode";
import { createEditor, setText } from "./editor";
import { flashStatus } from "./flash";
import { setLiveValues, toggleLiveValues } from "./live-values";
import { Meter } from "./meter";
import { NightFade } from "./night";
import { describeNight } from "../shared/night";
import { Recorder } from "./recorder";
import { describeError, ErrorReporter, installRuntimeErrorReporting } from "./runtime-errors";
import { Scene, SceneOptions } from "./scenes";
import { SketchWriter } from "./sketch-writer";
import { installHydraTempo, releaseHydraBpm, syncHydraBpm, tapTempo } from "./tempo";
import "./style.css";

declare global {
  interface Window { aoHost: Bridge; ao: typeof ao }
}

const host = window.aoHost;
const params = new URLSearchParams(location.search);
const $ = (id: string) => document.getElementById(id)!;
const status = $("status"), sketchLabel = $("sketch"), fpsLabel = $("fps");
// Capture and audio messages from the main process; a successful run keeps them.
const notice = document.createElement("span");
notice.id = "notice";
fpsLabel.before(notice);

let current = "";

function showStatus(message: string, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
  if (error) host.log(`${current}: ${message}`);
}

// Runtime errors from sketch code show once each until the next run.
const runtimeErrors = new ErrorReporter((message) => showStatus(message, true));
installRuntimeErrorReporting(runtimeErrors);

// --- Rendering -------------------------------------------------------------

const canvas = $("stage") as HTMLCanvasElement;
const night = new NightFade(canvas);
const meter = new Meter(document.body);
const pixelSize = (): [number, number] => [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)];
const [width, height] = pixelSize();
const hydra = new Hydra({
  canvas, width, height,
  detectAudio: false, autoLoop: false, makeGlobal: true,
  enableStreamCapture: false, precision: "highp",
});
// Follow the canvas's real size; the window may not have its final size yet.
new ResizeObserver(() => {
  const [w, h] = pixelSize();
  if (w > 0 && h > 0 && (w !== hydra.width || h !== hydra.height)) hydra.setResolution(w, h);
}).observe(canvas);

// Each Hydra source can also host a GLSL scene: `s0.initScene(glsl)`.
const scenes = new Map<HydraSource, Scene>();
for (const source of hydra.s) {
  source.initScene = (code: string, options?: SceneOptions) => {
    let scene = scenes.get(source);
    if (!scene) scenes.set(source, (scene = new Scene((message) => runtimeErrors.report(message))));
    scene.load(code, options);
    if (source.src !== scene.canvas) source.init({ src: scene.canvas });
    source.dynamic = true;
  };
}
window.ao = ao;
host.onAudio(updateAudio);
installHydraTempo();

let last = performance.now(), frames = 0, fpsWindow = last;
function frame(now: number) {
  // Schedule first: nothing that throws below may stop the visuals.
  requestAnimationFrame(frame);
  // Night fade may slow time a little; it is 1 unless configured.
  const dt = (now - last) * night.timeScale;
  last = now;
  const time = hydra.synth.time + dt * 0.001 * hydra.synth.speed;
  for (const [source, scene] of scenes) {
    if (source.src !== scene.canvas) continue;
    try {
      scene.render(hydra.width, hydra.height, time, dt / 1000, ao.features);
    } catch (e) {
      runtimeErrors.report(`scene: ${describeError(e)}`);
    }
  }
  syncHydraBpm();
  try {
    hydra.tick(dt);
  } catch (e) {
    runtimeErrors.report(`Hydra: ${describeError(e)}`);
  }
  frames++;
  if (now - fpsWindow > 500) {
    fpsLabel.textContent = `${Math.round((frames * 1000) / (now - fpsWindow))} fps`;
    frames = 0;
    fpsWindow = now;
  }
}
requestAnimationFrame(frame);

// --- Sketches ----------------------------------------------------------------

let sketches: string[] = [];
let saved = "";
// Ordered writes that skip content already on disk.
const writer = new SketchWriter((name, code) => host.writeSketch(name, code));

async function run(code: string): Promise<void> {
  // A still-broken sketch reports its runtime errors again after this run.
  runtimeErrors.reset();
  // A whole-sketch run hands Hydra's bpm back to Ao unless the sketch sets it.
  if (code === editor.state.doc.toString()) releaseHydraBpm();
  try {
    // Each evaluation gets its own scope so re-running `const` blocks works.
    // Hydra's functions, `ao`, and scene sources are globals.
    await new Function(`return (async () => {\n${code}\n})()`)();
    showStatus("");
    // Errors reported while an async sketch was running were just cleared.
    runtimeErrors.reset();
  } catch (e) {
    showStatus(e instanceof Error ? e.message : String(e), true);
  }
}

let autosaveTimer: ReturnType<typeof setTimeout>;
// Set while `:w name` renames the sketch; saves wait for it.
let renaming: Promise<void> | undefined;
const editorRoot = $("editor");
const editor = createEditor(editorRoot, {
  run: (code) => void run(code),
  save: () => void save(),
  changed: () => {
    updateLabel();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void save(), 700);
  },
  rename: (name, overwrite) => void rename(name, overwrite),
  status: showStatus,
});

const dirty = () => editor.state.doc.toString() !== saved;
function updateLabel() {
  sketchLabel.textContent = `${current}${dirty() ? " ●" : ""}`;
}

async function open(name: string): Promise<void> {
  if (!name) return;
  clearTimeout(autosaveTimer);
  if (current && dirty()) await save();
  current = name;
  saved = await host.readSketch(name);
  writer.known(name, saved);
  setText(editor, saved);
  host.setLastSketch(name);
  updateLabel();
  hydra.synth.hush();
  await run(saved);
}

async function save(): Promise<void> {
  // After a rename, save under the new name, never recreating the old file.
  await renaming;
  if (!current) return;
  const code = editor.state.doc.toString();
  const name = current;
  try {
    // A clean document costs nothing: the writer skips content already written.
    await writer.save(name, code);
    if (current === name) {
      saved = code;
      updateLabel();
    }
  } catch (error) {
    showStatus(`Autosave failed: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

// `:w name`: save the current text as `name` and rename the open sketch,
// keeping the editor and its undo history.
async function rename(target: string, overwrite: boolean): Promise<void> {
  if (!current || renaming) return;
  const from = current;
  const task = (async () => {
    clearTimeout(autosaveTimer);
    // Let queued writes of the old name land first, so none recreates it
    // later. The old file then holds this text, should the rename be refused.
    const before = editor.state.doc.toString();
    await writer.save(from, before).then(() => { saved = before; }, () => {});
    const code = editor.state.doc.toString();
    const name = await host.renameSketch(from, target, code, overwrite);
    current = name;
    saved = code;
    writer.known(name, code);
    host.setLastSketch(name);
    sketches = await host.listSketches();
    updateLabel();
    showStatus(name === from ? `saved ${name}` : `renamed ${from} to ${name}`);
  })();
  renaming = task.catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    showStatus(`Can't rename to ${target}: ${message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}`, true);
    updateLabel();
  }).finally(() => { renaming = undefined; });
  await renaming;
}

async function createSketch(): Promise<void> {
  if (dirty()) await save();
  sketches = await host.listSketches();
  let name = "untitled";
  for (let suffix = 2; sketches.includes(name); suffix++) name = `untitled-${suffix}`;
  await host.writeSketch(name, "");
  sketches.push(name);
  await open(name);
}

async function step(offset: number): Promise<void> {
  sketches = await host.listSketches();
  if (!sketches.length) return;
  const index = sketches.indexOf(current);
  await open(sketches[(index + offset + sketches.length) % sketches.length]);
}

host.onSketchChanged(async (name) => {
  sketches = await host.listSketches();
  if (name !== current) return;
  if (!sketches.includes(name)) {
    // Deleted on disk: the next save must write the file again.
    writer.forget();
    return;
  }
  const code = await host.readSketch(name);
  if (code === saved) return;
  // The disk now holds `code`, so saving your edits must write them.
  writer.known(name, code);
  if (dirty()) {
    showStatus(`${name} changed on disk; Ctrl+S keeps your edits`, true);
    return;
  }
  saved = code;
  setText(editor, code, { undoable: true });
  updateLabel();
  await run(code);
});
host.onStatus((message) => {
  notice.textContent = message;
  notice.title = message;
  // "capturing <monitor>" is the one healthy report; the rest mean audio trouble.
  notice.classList.toggle("error", !message.startsWith("capturing "));
});

// Records the canvas (never the overlay) with the system audio: F9, or `r`.
const recorder = new Recorder(host, canvas, () => current);
fpsLabel.before(recorder.indicator);

// --- Overlay and keys --------------------------------------------------------

const help = $("help");
let helpTimer: ReturnType<typeof setTimeout> | undefined;
function toggleHelp() {
  help.hidden = !help.hidden;
  clearTimeout(helpTimer);
  if (!help.hidden) helpTimer = setTimeout(() => { help.hidden = true; }, 8000);
}

function setEditorVisible(visible: boolean) {
  document.body.classList.toggle("ambient", !visible);
  if (visible) editor.focus();
  else editor.contentDOM.blur();
}
const editorVisible = () => !document.body.classList.contains("ambient");

function toggleMeter() {
  meter.setVisible(!meter.visible);
  host.updateSettings({ meter: meter.visible });
}
function cycleNight() {
  const { mode } = night.cycle();
  host.updateSettings({ night: { mode } });
  flashStatus(status, describeNight(night.current));
}
const challenges = new ChallengeMode({
  listSketches: host.listSketches, writeSketch: host.writeSketch, finishChallenge: host.finishChallenge,
  open, save, notify: showStatus, focus: () => { if (editorVisible()) editor.focus(); },
});

// Sketch browser (Ctrl+O, ambient `o`) and its live thumbnails of the canvas.
const browser = new SketchBrowser({
  listSketches: host.listSketches, recentSketches: host.recentSketches, thumbnail: host.thumbnail,
  current: () => current, open, opening: () => { if (challenges.isOpen) challenges.close(); },
  focus: () => { if (editorVisible()) editor.focus(); },
});
new ThumbnailCapture(canvas, { current: () => current, save: host.saveThumbnail, saved: (name) => browser.thumbnailSaved(name) });

addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (challenges.onKey(e)) return;
  if (browser.onKey(e)) return;
  if (e.key === "F11") { handled(); host.toggleFullscreen(); return; }
  if (e.key === "F1") { handled(); toggleHelp(); return; }
  if (e.key === "F9") { handled(); if (!e.repeat) void recorder.toggle(); return; }
  if (ctrl && !e.shiftKey && e.key.toLowerCase() === "n") { handled(); void createSketch(); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "h") { handled(); setEditorVisible(!editorVisible()); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "m") { handled(); toggleMeter(); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "l") { handled(); host.updateSettings({ liveValues: toggleLiveValues(editor) }); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") { handled(); cycleNight(); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "t") { handled(); if (!e.repeat) flashStatus(status, tapTempo()); return; }
  if (ctrl && e.key === "PageDown") { handled(); void step(1); return; }
  if (ctrl && e.key === "PageUp") { handled(); void step(-1); return; }
  if (ctrl && e.key.toLowerCase() === "q") { handled(); host.quit(); return; }
  if (editorVisible() || ctrl || e.altKey) return;
  // Ambient mode keeps Ao's original single-key controls.
  const actions: Record<string, () => void> = {
    j: () => void step(-1), k: () => void step(1), f: host.toggleFullscreen,
    e: () => setEditorVisible(true), h: toggleHelp, i: () => fpsLabel.classList.toggle("shown"),
    m: toggleMeter, n: cycleNight, q: host.quit, Escape: host.quit,
    c: () => challenges.toggle(), o: () => browser.toggle(),
    r: () => { if (!e.repeat) void recorder.toggle(); },
    t: () => { if (!e.repeat) flashStatus(status, tapTempo()); },
  };
  const action = actions[e.key];
  if (action) { handled(); action(); }
}, { capture: true });

// --- Start -------------------------------------------------------------------

setEditorVisible(params.get("hideEditor") !== "1");
const settings = await host.settings();
meter.setVisible(settings.meter);
setLiveValues(editor, settings.liveValues);
night.set(settings.night);
sketches = await host.listSketches();
const initial = params.get("sketch") || (await host.lastSketch());
await open(sketches.includes(initial) ? initial : sketches[0] ?? "");
