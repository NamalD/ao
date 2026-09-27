import Hydra from "hydra-synth";
import type { Bridge } from "../preload/preload";
import { ao, updateAudio } from "./audio";
import { createEditor, setText } from "./editor";
import { describeError, ErrorReporter, installRuntimeErrorReporting } from "./runtime-errors";
import { Scene, SceneOptions } from "./scenes";
import { SketchWriter } from "./sketch-writer";
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

let last = performance.now(), frames = 0, fpsWindow = last;
function frame(now: number) {
  // Schedule first: nothing that throws below may stop the visuals.
  requestAnimationFrame(frame);
  const dt = now - last;
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
const editorRoot = $("editor");
const editor = createEditor(editorRoot, {
  run: (code) => void run(code),
  save: () => void save(),
  changed: () => {
    updateLabel();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void save(), 700);
  },
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
  setText(editor, code);
  updateLabel();
  await run(code);
});
host.onStatus((message) => {
  notice.textContent = message;
  notice.title = message;
  // "capturing <monitor>" is the one healthy report; the rest mean audio trouble.
  notice.classList.toggle("error", !message.startsWith("capturing "));
});

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

addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === "F11") { handled(); host.toggleFullscreen(); return; }
  if (e.key === "F1") { handled(); toggleHelp(); return; }
  if (ctrl && !e.shiftKey && e.key.toLowerCase() === "n") { handled(); void createSketch(); return; }
  if (ctrl && e.shiftKey && e.key.toLowerCase() === "h") { handled(); setEditorVisible(!editorVisible()); return; }
  if (ctrl && e.key === "PageDown") { handled(); void step(1); return; }
  if (ctrl && e.key === "PageUp") { handled(); void step(-1); return; }
  if (ctrl && e.key.toLowerCase() === "q") { handled(); host.quit(); return; }
  if (editorVisible() || ctrl || e.altKey) return;
  // Ambient mode keeps Ao's original single-key controls.
  const actions: Record<string, () => void> = {
    j: () => void step(-1), k: () => void step(1), f: host.toggleFullscreen,
    e: () => setEditorVisible(true), h: toggleHelp, i: () => fpsLabel.classList.toggle("shown"),
    q: host.quit, Escape: host.quit,
  };
  const action = actions[e.key];
  if (action) { handled(); action(); }
}, { capture: true });

// --- Start -------------------------------------------------------------------

setEditorVisible(params.get("hideEditor") !== "1");
sketches = await host.listSketches();
const initial = params.get("sketch") || (await host.lastSketch());
await open(sketches.includes(initial) ? initial : sketches[0] ?? "");
