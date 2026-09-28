import type { Bridge } from "../preload/preload";
import { ao, updateAudio } from "./audio";
import { SketchBrowser } from "./browser/sketch-browser";
import { ThumbnailCapture } from "./browser/thumbnail-capture";
import { Autopilot } from "./autopilot";
import { ChallengeMode } from "./challenges/challenge-mode";
import { Mixer } from "./crossfade";
import { createEditor, insertBlock, setText } from "./editor";
import { CodeExplorer } from "./explorer/explorer";
import { flashStatus } from "./flash";
import { setLiveValues, toggleLiveValues } from "./live-values";
import { Meter } from "./meter";
import { NightFade } from "./night";
import { defaultAutopilot } from "../shared/autopilot";
import { describeNight } from "../shared/night";
import { Recorder } from "./recorder";
import { sceneResolution } from "./resolution";
import { describeError, ErrorReporter, installRuntimeErrorReporting } from "./runtime-errors";
import { SketchWriter } from "./sketch-writer";
import { solidShapes } from "./solids";
import { installHydraTempo, msToNextBar, releaseHydraBpm, syncHydraBpm, tapTempo } from "./tempo";
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
const night = new NightFade(canvas, $("night-indicator"));
const meter = new Meter(document.body);
// #stage's box is the visuals' area: the window, or right of the code explorer.
const pixelSize = (): [number, number] => [Math.round((canvas.clientWidth || innerWidth) * devicePixelRatio), Math.round((canvas.clientHeight || innerHeight) * devicePixelRatio)];
const [width, height] = pixelSize();
// Two Hydra decks, so switches can crossfade; #stage mirrors them for recording.
const mixer = new Mixer(canvas, width, height, (message) => runtimeErrors.report(message));
// Follow the canvas's real size; the window may not have its final size yet.
new ResizeObserver(() => mixer.resize(...pixelSize())).observe(canvas);
window.ao = ao;
// 3D solids chain like Hydra and render into a source: `sphere().spikes(0.3).out(s0)`.
// Sketches get their deck's own (see deck.ts); these serve the DevTools console.
Object.assign(window, solidShapes);
host.onAudio(updateAudio);
installHydraTempo();

let last = performance.now(), frames = 0, fpsWindow = last;
function frame(now: number) {
  // Schedule first: nothing that throws below may stop the visuals.
  requestAnimationFrame(frame);
  // Night fade may slow time a little; it is 1 unless configured.
  const dt = (now - last) * night.timeScale;
  last = now;
  try {
    // Hydra's bpm follows the tempo; `window.bpm` reads and writes the current deck.
    syncHydraBpm();
    mixer.frame(dt, ao.features, now);
  } catch (e) {
    runtimeErrors.report(`render: ${describeError(e)}`);
  }
  frames++;
  if (now - fpsWindow > 500) {
    // Automatic scenes, such as solids, may be drawing below full size.
    const scale = sceneResolution.active(now) ? sceneResolution.scaleAt(now) : 1;
    fpsLabel.dataset.sceneMs = sceneResolution.measuredMs().toFixed(2);
    fpsLabel.textContent = `${Math.round((frames * 1000) / (now - fpsWindow))} fps${scale < 1 ? ` · scenes at ${Math.round(scale * 100)}%` : ""}`;
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

/** Runs code on the current deck; resolves to whether it ran without throwing. */
async function run(code: string): Promise<boolean> {
  // A still-broken sketch reports its runtime errors again after this run.
  runtimeErrors.reset();
  // A whole-sketch run hands Hydra's bpm back to Ao unless the sketch sets it.
  if (code === editor.state.doc.toString()) releaseHydraBpm();
  try {
    // Each evaluation gets its own scope so re-running `const` blocks works.
    // Hydra's functions and scene sources come from the deck (see deck.ts);
    // `ao` and everything else are globals.
    await mixer.current.evaluate(code);
    showStatus("");
    // Errors reported while an async sketch was running were just cleared.
    runtimeErrors.reset();
    return true;
  } catch (e) {
    showStatus(e instanceof Error ? e.message : String(e), true);
    return false;
  } finally {
    mixer.exposeGlobals();
  }
}

// From settings.json once it's read; Ctrl+Enter formats until then.
let formatOnRun = true;
let autosaveTimer: ReturnType<typeof setTimeout>;
// Set while `:w name` renames the sketch; saves wait for it.
let renaming: Promise<void> | undefined;
const editorRoot = $("editor");
const editor = createEditor(editorRoot, {
  run: (code) => { autopilot.edited(); void run(code); },
  autoFormat: () => formatOnRun,
  save: () => void save(),
  changed: () => {
    if (!loadingText) autopilot.edited();
    updateLabel();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void save(), 700);
  },
  rename: (name, overwrite) => void rename(name, overwrite),
  status: showStatus,
  help: (line, column, receiver) => { editor.contentDOM.blur(); explorer.lookUp(line, column, receiver); },
});

const dirty = () => editor.state.doc.toString() !== saved;
function updateLabel() {
  sketchLabel.textContent = `${current}${dirty() ? " ●" : ""}`;
}

// Set while a sketch's text is loaded into the editor: that isn't typing.
let loadingText = false;
// Sketch switches run one at a time, in order.
let switching: Promise<unknown> = Promise.resolve();
/** How long a switch waits for an async sketch before fading anyway, ms. */
const RUN_WAIT_MS = 1500;

/**
 * Opens a sketch and runs it. `fade` crossfades from the current one over
 * the autopilot's fadeSeconds (0 cuts); otherwise it's a cut, as always.
 * Resolves to false when the sketch threw while starting.
 */
function open(name: string, options: { fade?: boolean } = {}): Promise<boolean> {
  const task = switching.then(() => openNow(name, options.fade ? autopilot.fadeSeconds : 0));
  switching = task.catch(() => {});
  return task;
}

async function openNow(name: string, fadeSeconds: number): Promise<boolean> {
  if (!name) return false;
  clearTimeout(autosaveTimer);
  if (current && dirty()) await save();
  const code = await host.readSketch(name);
  current = name;
  saved = code;
  writer.known(name, saved);
  loadingText = true;
  try {
    setText(editor, saved);
  } finally {
    loadingText = false;
  }
  host.setLastSketch(name);
  updateLabel();
  autopilot.switched(name);
  if (fadeSeconds > 0) mixer.beginCrossfade();
  else mixer.cut();
  // An async sketch may take a while (or forever); don't hold the switch up.
  const ran = run(saved);
  const ok = await Promise.race([ran, new Promise<boolean>((resolve) => setTimeout(() => resolve(true), RUN_WAIT_MS))]);
  mixer.startFade(fadeSeconds);
  return ok;
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

/** The next or previous sketch by name, crossfading unless fadeSeconds is 0. */
async function step(offset: number): Promise<void> {
  sketches = await host.listSketches();
  if (!sketches.length) return;
  const index = sketches.indexOf(current);
  await open(sketches[(index + offset + sketches.length) % sketches.length], { fade: true });
}

// With autopilot on, next is the next sketch in the shuffle and previous
// goes back through what it showed.
function next(): void {
  if (autopilot.enabled) void autopilot.skip();
  else void step(1);
}
function previous(): void {
  const back = autopilot.enabled ? autopilot.previous() : undefined;
  if (back) void open(back, { fade: true });
  else void step(-1);
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
mixer.capturing = () => recorder.capturing;
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
  autopilot.setEditorVisible(visible);
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
// Shuffles through the sketches on drops, section changes and a timer.
const autopilot = new Autopilot({
  listSketches: host.listSketches, readSketch: host.readSketch, current: () => current,
  switchTo: (name) => open(name, { fade: true }), fading: () => mixer.fading,
  flash: (message) => flashStatus(status, message), log: host.log,
  save: (patch) => host.updateSettings({ autopilot: patch }),
}, defaultAutopilot);
host.onAudio((features) => autopilot.feed(features));
// Automatic switches wait for the next bar (at most 4 s); a manual skip goes now.
autopilot.alignSwitch = (reason) => reason === "skip" ? 0 : msToNextBar();

// The code explorer: F2, or K on a word. Its examples play on the current
// deck, cut in as a sketch switch would be, which also resets speed and hands
// bpm back to Ao.
// Browsing counts as editing, so autopilot doesn't switch away meanwhile.
const explorer = new CodeExplorer({
  play: (code) => {
    autopilot.setEditorVisible(true);
    autopilot.edited();
    mixer.cut();
    releaseHydraBpm();
    void run(code);
  },
  restore: () => { mixer.cut(); void run(editor.state.doc.toString()); },
  insert: (code) => {
    editor.dispatch(insertBlock(editor.state, code));
    mixer.cut();
    void run(editor.state.doc.toString());
  },
  closed: () => {
    autopilot.setEditorVisible(editorVisible());
    if (editorVisible()) editor.focus();
  },
});

const challenges = new ChallengeMode({
  listSketches: host.listSketches, writeSketch: host.writeSketch, finishChallenge: host.finishChallenge,
  open: async (name) => { await open(name); }, save, notify: showStatus, focus: () => { if (editorVisible()) editor.focus(); },
});

// Sketch browser (Ctrl+O, ambient `o`) and its live thumbnails of the canvas.
const browser = new SketchBrowser({
  listSketches: host.listSketches, recentSketches: host.recentSketches, thumbnail: host.thumbnail,
  current: () => current, open: (name) => open(name, { fade: true }).then(() => {}), opening: () => { if (challenges.isOpen) challenges.close(); },
  focus: () => { if (editorVisible()) editor.focus(); },
});
// The current deck's canvas: the outgoing deck of a crossfade is never captured.
new ThumbnailCapture(() => mixer.current.canvas, { current: () => current, save: host.saveThumbnail, saved: (name) => browser.thumbnailSaved(name) });

addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (challenges.onKey(e)) return;
  if (explorer.onKey(e)) return;
  if (e.key === "F2") { handled(); editor.contentDOM.blur(); explorer.show(); return; }
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
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "a") { handled(); autopilot.toggle(); return; }
  if (ctrl && e.key === "PageDown") { handled(); next(); return; }
  if (ctrl && e.key === "PageUp") { handled(); previous(); return; }
  if (ctrl && e.key.toLowerCase() === "q") { handled(); host.quit(); return; }
  if (editorVisible() || ctrl || e.altKey) return;
  // Ambient mode keeps Ao's original single-key controls.
  const actions: Record<string, () => void> = {
    j: previous, k: next, a: () => autopilot.toggle(), f: host.toggleFullscreen,
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
formatOnRun = settings.format;
night.set(settings.night);
autopilot.configure(settings.autopilot);
sketches = await host.listSketches();
const initial = params.get("sketch") || (await host.lastSketch());
await open(sketches.includes(initial) ? initial : sketches[0] ?? "");
