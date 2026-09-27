import { autocompletion, closeBrackets, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension, Facet, Prec, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
// hydra-synth's exports map omits this module; vite.config.ts and vitest.config.ts alias it.
import HydraSourceClass from "hydra-synth/src/hydra-source.js";
import { ao, aoDocs } from "./audio";
import { blockAt } from "./blocks";
import { keepLiveValues, liveValues } from "./live-values";
import { remix, remixRunRange } from "./remix";
import { joinsScrub, scrubbing } from "./scrub";
import { solidFunctions, solidOutParams } from "./solids";

export interface EditorActions {
  run(code: string): void;
  save(): void;
  changed(): void;
  /** Save under a new name and rename the sketch (`:w name`); `overwrite` for `:w! name`. */
  rename?(name: string, overwrite: boolean): void;
  /** Show a message in the status bar. */
  status?(message: string, error?: boolean): void;
}

// --- Documentation -----------------------------------------------------------

/** One entry of `aoDocs` in audio.ts. */
export interface AoDoc { signature: string; description: string }

interface ParameterDoc { name: string; description?: string; type?: string; default?: number | string | null }
export interface FunctionDoc { signature: string; params: ParameterDoc[]; description: string; info: string }

interface HydraDoc { description: string; params?: Record<string, string> }

const channel = (name: string): HydraDoc => ({
  description: `Outputs the ${name} channel as greyscale: ${name} × scale + offset.`,
  params: { scale: `Multiplier for the ${name} channel.`, offset: "Added after scaling." },
});
const combineAmount = (verb: string) => `Strength of the ${verb}: 1 is full, 0 leaves this chain unchanged.`;

/**
 * Hand-written help for every Hydra GLSL function; hydra-synth ships none.
 * The function list itself comes from hydraFunctions(), and a test checks
 * that every function has an entry here.
 */
export const hydraDocs: Record<string, HydraDoc> = {
  // Sources
  noise: { description: "Animated greyscale simplex noise.", params: { scale: "Noise frequency; higher values give finer detail.", offset: "How fast the noise evolves over time." } },
  voronoi: { description: "Animated Voronoi cells, each shaded by its drifting centre point.", params: { scale: "Number of cells across the screen.", speed: "How fast the cell centres drift.", blending: "How much cells darken towards their edges." } },
  osc: { description: "Scrolling sine-wave stripes; offset splits red, green and blue apart.", params: { frequency: "Stripe density: about frequency / 6.28 stripes across the screen.", sync: "Scroll speed.", offset: "Phase shift between colour channels; 0 gives greyscale stripes." } },
  shape: { description: "A filled regular polygon centred on the screen.", params: { sides: "Number of sides; large values approach a circle.", radius: "Size, from the centre to the edges.", smoothing: "Edge softness." } },
  gradient: { description: "Colour gradient: x drives red, y drives green, and blue pulses over time.", params: { speed: "How fast the blue channel pulses." } },
  src: { description: "Samples a texture: an output (o0–o3) or a source (s0–s3).", params: { tex: "Output or source to sample, e.g. o0 for feedback or s0 for a scene." } },
  solid: { description: "Fills the screen with a single colour.", params: { r: "Red, 0..1.", g: "Green, 0..1.", b: "Blue, 0..1.", a: "Alpha, 0..1." } },
  prev: { description: "The previous frame of the output being rendered, for feedback." },
  // Geometry
  rotate: { description: "Rotates the image around the centre.", params: { angle: "Rotation in radians.", speed: "Extra rotation in radians per second." } },
  scale: { description: "Zooms around a point; values above 1 enlarge the image.", params: { amount: "Zoom factor: above 1 enlarges, below 1 shrinks.", xMult: "Extra horizontal zoom factor.", yMult: "Extra vertical zoom factor.", offsetX: "Horizontal zoom centre, 0..1; 0.5 is the middle.", offsetY: "Vertical zoom centre, 0..1; 0.5 is the middle." } },
  pixelate: { description: "Snaps the image to a grid of flat blocks.", params: { pixelX: "Number of blocks across.", pixelY: "Number of blocks down." } },
  repeat: { description: "Tiles the image in a grid.", params: { repeatX: "Number of tiles across.", repeatY: "Number of tiles down.", offsetX: "Horizontal shift of every other row of tiles.", offsetY: "Vertical shift of every other column of tiles." } },
  repeatX: { description: "Tiles the image horizontally.", params: { reps: "Number of tiles across.", offset: "Vertical shift of every other tile." } },
  repeatY: { description: "Tiles the image vertically.", params: { reps: "Number of tiles down.", offset: "Horizontal shift of every other tile." } },
  kaleid: { description: "Kaleidoscope: mirrors a wedge of the image around the centre.", params: { nSides: "Number of mirrored segments." } },
  scroll: { description: "Shifts the image, wrapping around the edges.", params: { scrollX: "Horizontal shift, 0..1 of the screen width.", scrollY: "Vertical shift, 0..1 of the screen height.", speedX: "Horizontal scroll speed, screens per second.", speedY: "Vertical scroll speed, screens per second." } },
  scrollX: { description: "Shifts the image horizontally, wrapping around the edges.", params: { scrollX: "Horizontal shift, 0..1 of the screen width.", speed: "Scroll speed, screens per second." } },
  scrollY: { description: "Shifts the image vertically, wrapping around the edges.", params: { scrollY: "Vertical shift, 0..1 of the screen height.", speed: "Scroll speed, screens per second." } },
  // Colour
  posterize: { description: "Reduces each colour channel to a few flat levels.", params: { bins: "Number of levels per channel.", gamma: "Gamma applied before quantising and undone after; lower values give more levels in the darks." } },
  shift: { description: "Adds a wrapped offset to each channel, cycling colours.", params: { r: "Amount added to red; only the fractional part counts.", g: "Amount added to green; only the fractional part counts.", b: "Amount added to blue; only the fractional part counts.", a: "Amount added to alpha; only the fractional part counts." } },
  invert: { description: "Inverts the colours.", params: { amount: "Mix of the inverted colour: 1 fully inverted, 0 unchanged." } },
  contrast: { description: "Pushes colours away from (or towards) mid-grey.", params: { amount: "Contrast factor; 1 is unchanged, below 1 flattens." } },
  brightness: { description: "Adds a constant to every colour channel.", params: { amount: "Amount added; negative values darken." } },
  luma: { description: "Luma key: areas darker than the threshold become transparent.", params: { threshold: "Luminance below which pixels are keyed out, 0..1.", tolerance: "Softness of the key edge." } },
  thresh: { description: "Black and white by luminance threshold.", params: { threshold: "Luminance that splits black from white, 0..1.", tolerance: "Softness of the edge between them." } },
  color: { description: "Multiplies each channel; a negative value multiplies the inverted channel instead.", params: { r: "Red multiplier; negative uses inverted red.", g: "Green multiplier; negative uses inverted green.", b: "Blue multiplier; negative uses inverted blue.", a: "Alpha multiplier." } },
  saturate: { description: "Scales colour saturation.", params: { amount: "Saturation factor: 0 is greyscale, 1 unchanged, above 1 more vivid." } },
  hue: { description: "Rotates the hue of every pixel.", params: { hue: "Hue shift; 1 is a full turn around the colour wheel." } },
  colorama: { description: "Shifts hue, saturation and value together and wraps them, for psychedelic colour cycling.", params: { amount: "Amount added to hue, saturation and value." } },
  sum: { description: "Weighted sum of the colour channels. It returns a float, so it breaks a chain; it exists as a GLSL helper for setFunction code.", params: { scale: "Per-channel weights (r, g, b, a)." } },
  r: channel("red"),
  g: channel("green"),
  b: channel("blue"),
  a: channel("alpha"),
  // Blending
  add: { description: "Adds the colour of another texture.", params: { amount: combineAmount("add") } },
  sub: { description: "Subtracts the colour of another texture.", params: { amount: combineAmount("subtraction") } },
  layer: { description: "Draws another texture on top, using its alpha." },
  blend: { description: "Crossfades to another texture.", params: { amount: "0 is this chain, 1 is the other texture." } },
  mult: { description: "Multiplies by the colour of another texture.", params: { amount: combineAmount("multiply") } },
  diff: { description: "Absolute difference between this chain and another texture." },
  mask: { description: "Uses another texture's luminance as this chain's brightness and alpha." },
  // Modulation: another texture's colours distort this chain's coordinates.
  modulate: { description: "Displaces the image by another texture's red and green.", params: { amount: "Displacement strength, in screen widths per unit of colour." } },
  modulateScale: { description: "Zooms each pixel by another texture's red (x) and green (y).", params: { multiple: "How strongly the texture changes the zoom.", offset: "Base zoom factor; 1 is unzoomed." } },
  modulatePixelate: { description: "Pixelates with block counts driven by another texture's red and green.", params: { multiple: "Blocks added per unit of colour.", offset: "Base number of blocks." } },
  modulateRotate: { description: "Rotates each pixel by an angle driven by another texture's red.", params: { multiple: "Radians of rotation per unit of red.", offset: "Base rotation in radians." } },
  modulateHue: { description: "Displaces pixels by another texture's colour differences (green − red, blue − green).", params: { amount: "Displacement in pixels per unit of colour difference." } },
  modulateRepeat: { description: "Tiles the image, shifting alternate rows and columns by another texture's red and green.", params: { repeatX: "Number of tiles across.", repeatY: "Number of tiles down.", offsetX: "How far the texture's red shifts tiles horizontally.", offsetY: "How far the texture's green shifts tiles vertically." } },
  modulateRepeatX: { description: "Tiles the image horizontally, shifting tiles vertically by another texture's red.", params: { reps: "Number of tiles across.", offset: "How far the texture's red shifts tiles." } },
  modulateRepeatY: { description: "Tiles the image, shifting tiles horizontally by another texture's red. (hydra-synth 1.4 repeats along x here, not y.)", params: { reps: "Number of tiles.", offset: "How far the texture's red shifts tiles." } },
  modulateKaleid: { description: "Kaleidoscope whose radius is pushed out by another texture's red.", params: { nSides: "Number of mirrored segments." } },
  modulateScrollX: { description: "Shifts the image horizontally by another texture's red.", params: { scrollX: "Shift per unit of red, in screen widths.", speed: "Constant scroll speed, screens per second." } },
  modulateScrollY: { description: "Shifts the image vertically by another texture's red.", params: { scrollY: "Shift per unit of red, in screen heights.", speed: "Constant scroll speed, screens per second." } },
};

interface HydraInput { name: string; type: string; default?: number | string | null }
interface HydraFunction { name: string; type: string; inputs: HydraInput[] }

const textureParam = (fn: HydraFunction): ParameterDoc => ({
  name: "texture",
  description: fn.type === "combine"
    ? "Texture to combine with this chain: another chain, an output (o0–o3) or a source (s0–s3)."
    : "Texture whose colours distort this chain: another chain, an output (o0–o3) or a source (s0–s3).",
});

function formatInfo(signature: string, description: string, params: ParameterDoc[]) {
  return [signature, description, ...params.filter((p) => p.description).map((p) => `${p.name}: ${p.description}`)].join("\n");
}

function makeDoc(name: string, params: ParameterDoc[], description: string, signature?: string): FunctionDoc {
  signature ??= `${name}(${params.map((p) => `${p.name}${p.default == null ? "" : ` = ${p.default}`}`).join(", ")})`;
  return { signature, params, description, info: formatInfo(signature, description, params) };
}

const functions = hydraFunctions() as HydraFunction[];

/** Hydra's generators: functions that start a chain. */
export const generators = functions.filter((fn) => fn.type === "src").map((fn) => fn.name);
/** Methods that continue a chain, plus `out`. */
export const chainMethods = [...functions.filter((fn) => fn.type !== "src").map((fn) => fn.name), "out"];

const hydraFunctionDocs = new Map<string, FunctionDoc>(functions.map((fn) => {
  const docs = hydraDocs[fn.name];
  const params = [
    ...(fn.type === "combine" || fn.type === "combineCoord" ? [textureParam(fn)] : []),
    ...fn.inputs.map((input) => ({
      ...input,
      // src's texture input has no default; hydra-synth reports NaN.
      default: typeof input.default === "number" && Number.isNaN(input.default) ? null : input.default,
      description: docs?.params?.[input.name],
    })),
  ];
  return [fn.name, makeDoc(fn.name, params, docs?.description ?? "")] as const;
}));
hydraFunctionDocs.set("out", makeDoc("out", [{ name: "output", description: "Output buffer; o0 is the one on screen." }],
  "Renders this chain to an output buffer.", "out(output = o0)"));

const textureOptions: ParameterDoc = { name: "params", description: "Optional regl texture options, e.g. { mag: 'linear' }." };

/** Help for the source (s0–s3) methods; the list comes from HydraSource's prototype. */
const sourceDocs: Record<string, FunctionDoc> = {
  init: makeDoc("init", [{ name: "options", description: "{ src, dynamic }: a canvas, image or video element, and whether it changes every frame." }, textureOptions],
    "Uses an existing canvas, image or video element as this source.", "init(options, params?)"),
  initCam: makeDoc("initCam", [{ name: "index", description: "Which camera, counting video inputs from 0." }, textureOptions],
    "Streams a webcam into this source.", "initCam(index = 0, params?)"),
  initVideo: makeDoc("initVideo", [{ name: "url", description: "Video URL; it plays muted and loops." }, textureOptions],
    "Loads a looping, muted video into this source.", "initVideo(url, params?)"),
  initImage: makeDoc("initImage", [{ name: "url", description: "Image URL." }, textureOptions],
    "Loads a still image into this source.", "initImage(url, params?)"),
  initStream: makeDoc("initStream", [{ name: "streamName", description: "Name of the peer's stream." }, textureOptions],
    "Receives another Hydra instance's broadcast. Needs Hydra's peer-to-peer server, which Ao doesn't run.", "initStream(streamName, params?)"),
  initScreen: makeDoc("initScreen", [{ name: "index", description: "Ignored outside Hydra's desktop builds." }, textureOptions],
    "Captures a screen or window into this source.", "initScreen(index = 0, params?)"),
  initCanvas: makeDoc("initCanvas", [{ name: "width", description: "Canvas width in pixels." }, { name: "height", description: "Canvas height in pixels." }],
    "Creates a 2D canvas as this source and returns its context to draw on.", "initCanvas(width = 1000, height = 1000)"),
  clear: makeDoc("clear", [], "Stops any camera, screen or stream and empties this source.", "clear()"),
  initScene: makeDoc("initScene", [
    { name: "source", description: "GLSL ES 3.0 fragment shader defining mainImage(out vec4, in vec2)." },
    { name: "options", description: "{ scale, uniforms }: render resolution as a fraction of the output, and extra uniforms." },
  ], "Loads a Shadertoy-style shader into this source (Ao).", "initScene(source, options?)"),
};
const internalSourceMethods = new Set(["constructor", "tick", "getTexture", "resize"]);
/** Methods offered after `s0.` to `s3.`. */
export const sourceMembers = [
  ...Object.getOwnPropertyNames((HydraSourceClass as { prototype: object }).prototype).filter((name) => !internalSourceMethods.has(name)),
  "initScene",
];

/** Help for solids, the 3D shapes that chain like Hydra (Ao). */
const solidDocs = new Map<string, FunctionDoc>(solidFunctions.map((fn) => {
  const params: ParameterDoc[] = [
    ...(fn.type === "combine" ? [{ name: "solid", description: "The other solid, such as sphere(0.5).move(1)." }] : []),
    ...fn.params.map((p) => ({ name: p.name, default: p.default, description: p.description })),
  ];
  return [fn.name, makeDoc(fn.name, params, `${fn.description} (Ao solid)`)] as const;
}));
solidDocs.set("out", makeDoc("out", solidOutParams.map((p) => ({ ...p, default: p.name === "source" ? p.default : null })),
  "Raymarches this solid into a source; show it with src(s0).out().", "out(source = s0, options?)"));

/** Solid functions that start a chain, such as sphere. */
export const solidShapeNames = solidFunctions.filter((fn) => fn.type === "shape").map((fn) => fn.name);
/** Methods that continue a solid chain, plus `out`. */
export const solidMethods = [...solidFunctions.filter((fn) => fn.type !== "shape").map((fn) => fn.name), "out"];

/**
 * The name a method chain starts from, such as `sphere` in
 * `sphere(1).spikes(0.3).spin()`, for a node anywhere in that chain.
 */
export function chainRoot(state: EditorState, node: SyntaxNode | null): string | undefined {
  const chain = (n: SyntaxNode | null) => n?.name === "MemberExpression" || n?.name === "CallExpression";
  while (node?.parent && chain(node.parent)) node = node.parent;
  while (chain(node)) node = node!.firstChild;
  return node?.name === "VariableName" ? state.sliceDoc(node.from, node.to) : undefined;
}

/** Whether the chain at a node is a solid, so its methods are the solid ones. */
export const isSolidChain = (state: EditorState, node: SyntaxNode | null) => solidShapeNames.includes(chainRoot(state, node) ?? "");

/** Hydra globals that aren't GLSL functions. */
const globalDocs: Record<string, { type: string; doc: FunctionDoc }> = {
  ...Object.fromEntries([0, 1, 2, 3].map((i) => [`o${i}`, {
    type: "variable",
    doc: makeDoc(`o${i}`, [], i === 0 ? "Output buffer 0, the one on screen." : `Output buffer ${i}. Show it with render(o${i}) or sample it with src(o${i}).`, `o${i}`),
  }])),
  ...Object.fromEntries([0, 1, 2, 3].map((i) => [`s${i}`, {
    type: "variable",
    doc: makeDoc(`s${i}`, [], `Source ${i}: holds a GLSL scene, image, video or canvas. Sample it with src(s${i}).`, `s${i}`),
  }])),
  render: { type: "function", doc: makeDoc("render", [{ name: "output", description: "Output to show; with no argument, all four in a grid." }], "Chooses which output is shown on screen.", "render(output?)") },
  hush: { type: "function", doc: makeDoc("hush", [], "Clears all outputs, blanking the screen.", "hush()") },
  setFunction: { type: "function", doc: makeDoc("setFunction", [{ name: "definition", description: "{ name, type, inputs, glsl }, with type 'src', 'coord', 'color', 'combine' or 'combineCoord'." }], "Registers a custom GLSL function that then chains like a built-in.", "setFunction(definition)") },
  speed: { type: "variable", doc: makeDoc("speed", [], "Multiplier for Hydra's clock; 1 is normal speed.", "speed") },
  bpm: { type: "variable", doc: makeDoc("bpm", [], "Tempo at which array arguments step to their next value.", "bpm") },
  time: { type: "variable", doc: makeDoc("time", [], "Hydra's clock in seconds, scaled by speed.", "time") },
  mouse: { type: "variable", doc: makeDoc("mouse", [], "Pointer position in pixels: mouse.x, mouse.y.", "mouse") },
  width: { type: "variable", doc: makeDoc("width", [], "Output width in pixels.", "width") },
  height: { type: "variable", doc: makeDoc("height", [], "Output height in pixels.", "height") },
  update: { type: "function", doc: makeDoc("update", [{ name: "dt", description: "Milliseconds since the previous frame." }], "Assign a function to run every frame: update = (dt) => { … }.", "update = (dt) => {}") },
};

/** Public members of the `ao` object: everything but the internal `features`. */
export function publicAoMembers(target: object = ao): { name: string; method: boolean }[] {
  return Object.entries(Object.getOwnPropertyDescriptors(target))
    .filter(([name]) => name !== "features")
    .map(([name, descriptor]) => ({ name, method: typeof descriptor.value === "function" }));
}

/** Parameters from a signature such as "ao.map(level, lo = 0, hi = 1)". */
export function signatureParams(signature: string): ParameterDoc[] {
  const list = signature.match(/\(([^)]*)\)/)?.[1].trim();
  if (!list) return [];
  return list.split(",").map((part) => {
    const [name, value] = part.split("=").map((s) => s.trim());
    return { name, default: value ?? null };
  });
}

/** Completion and signature help for `ao` members, from audio.ts's aoDocs table. */
export function aoMemberDocs(docs: Record<string, AoDoc>): Map<string, FunctionDoc> {
  return new Map(Object.entries(docs).map(([name, doc]) =>
    [name, makeDoc(name, signatureParams(doc.signature), doc.description, doc.signature)] as const));
}

const aoFunctionDocs = aoMemberDocs(aoDocs);

/** Documentation for `name`, preferring the object it's called on; `solid` for a solid chain. */
export function functionDoc(name: string, owner?: string, solid = false): FunctionDoc | undefined {
  if (owner === "ao") return aoFunctionDocs.get(name);
  if (owner && /^s[0-3]$/.test(owner)) return sourceDocs[name];
  if (solid || (!owner && solidShapeNames.includes(name))) return solidDocs.get(name);
  return hydraFunctionDocs.get(name) ?? globalDocs[name]?.doc;
}

function documented(label: string, type: string, docs: FunctionDoc | undefined, fallback: string): Completion {
  return { label, type, detail: docs?.signature ?? fallback, info: docs?.info };
}

/** Completion options after `ao.`, `s0.` and friends, or `.` on a chain; `solid` for a solid chain. */
export function memberCompletions(owner: string | undefined, solid = false): Completion[] {
  if (owner === "ao") {
    return publicAoMembers().map(({ name, method }) =>
      documented(name, method ? "method" : "property", aoFunctionDocs.get(name), "Ao audio"));
  }
  if (owner && /^s[0-3]$/.test(owner)) return sourceMembers.map((name) => documented(name, "method", sourceDocs[name], "Hydra source"));
  if (solid) return solidMethods.map((name) => documented(name, "method", solidDocs.get(name), "Solid method"));
  return chainMethods.map((name) => documented(name, "method", hydraFunctionDocs.get(name), "Hydra chain method"));
}

/** Completion options at the start of an expression. */
export function topLevelCompletions(): Completion[] {
  return [
    ...generators.map((name) => documented(name, "function", hydraFunctionDocs.get(name), "Hydra generator")),
    ...solidShapeNames.map((name) => documented(name, "function", solidDocs.get(name), "Ao solid")),
    ...Object.entries(globalDocs).map(([name, { type, doc }]) => documented(name, type, doc, "Hydra")),
    { label: "ao", type: "variable", detail: "Ao audio levels", info: "ao\nLive audio levels: ao.bass, ao.impulse, ao.fft, …" },
  ];
}

// --- Signature help ------------------------------------------------------------

export function callParameterContext(state: EditorState, pos: number): { name: string; owner?: string; solid: boolean; activeParameter: number } | null {
  let args: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (args && args.name !== "ArgList") args = args.parent;
  if (!args || pos < args.from || pos > args.to || (pos === args.to && state.sliceDoc(pos - 1, pos) === ")")) return null;
  const call = args.parent;
  if (!call || call.name !== "CallExpression") return null;
  // ArgList.from points at the opening parenthesis; strip it before reading the callee.
  const callee = state.sliceDoc(call.from, args.from).trim().replace(/\($/, "").trim().match(/(?:([\w$]+)\s*\.\s*)?([\w$]+)$/);
  if (!callee) return null;
  let activeParameter = 0;
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (child.name === "," && child.from < pos) activeParameter++;
  }
  return { name: callee[2], owner: callee[1], solid: isSolidChain(state, call), activeParameter };
}

function signatureTooltip(state: EditorState, pos: number): Tooltip | null {
  if (!state.selection.main.empty) return null;
  const context = callParameterContext(state, pos);
  if (!context) return null;
  const { name, owner, solid, activeParameter } = context;
  const docs = functionDoc(name, owner, solid);
  if (!docs || !docs.params.length) return null;
  return {
    pos,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-signature-help";
      const header = document.createElement("div");
      header.className = "cm-signature-name";
      header.append(`${name}(`);
      docs.params.forEach((param, index) => {
        if (index) header.append(", ");
        const part = document.createElement("span");
        part.textContent = `${param.name}${param.type ? `: ${param.type}` : ""}${param.default == null ? "" : ` = ${param.default}`}`;
        if (index === activeParameter) part.className = "cm-signature-active";
        header.append(part);
      });
      header.append(")");
      dom.append(header);
      const param = docs.params[activeParameter];
      const text = param?.description ? `${param.name}: ${param.description}` : docs.description;
      if (text) {
        const description = document.createElement("div");
        description.className = "cm-signature-description";
        description.textContent = text;
        dom.append(description);
      }
      return { dom };
    },
  };
}

const signatureHelp = StateField.define<Tooltip | null>({
  create: (state) => signatureTooltip(state, state.selection.main.head),
  update: (_tooltip, tr) => signatureTooltip(tr.state, tr.state.selection.main.head),
  provide: (field) => showTooltip.from(field),
});

function hydraCompletions(context: CompletionContext) {
  const node = syntaxTree(context.state).resolveInner(context.pos, -1);
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (["String", "TemplateString", "LineComment", "BlockComment"].includes(current.name)) return null;
  }

  const word = context.matchBefore(/[\w$]+/);
  const justTypedDot = context.state.doc.sliceString(Math.max(0, context.pos - 1), context.pos) === ".";
  if (!word && !context.explicit && !justTypedDot) return null;
  const from = word?.from ?? context.pos;
  const before = context.state.doc.sliceString(Math.max(0, from - 100), from);
  const member = before.match(/(?:\b(ao|s[0-3])|\))\.$/);
  if (member || /\.\s*$/.test(before)) {
    const solid = !member?.[1] && isSolidChain(context.state, node);
    return { from, options: memberCompletions(member?.[1], solid), validFor: /^[\w$]*$/ };
  }
  return { from, options: topLevelCompletions(), validFor: /^[\w$]*$/ };
}

// --- Editor --------------------------------------------------------------------

const flash = StateEffect.define<{ from: number; to: number } | null>();
const flashField = StateField.define({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(flash)) {
        decorations = effect.value && effect.value.to > effect.value.from
          ? Decoration.set([Decoration.mark({ class: "cm-evaluated" }).range(effect.value.from, effect.value.to)])
          : Decoration.none;
      }
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Selections drawn inside the text layer. drawSelection's layer sits behind
 * the content, where each line's dark backing hides it, so selected text is
 * marked directly: whole lines get a line class, partial lines a mark.
 */
const selectedMark = Decoration.mark({ class: "cm-selected" });
const selectedLine = Decoration.line({ class: "cm-selectedLine" });
export function selectionDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const range of state.selection.ranges) {
    if (range.empty) continue;
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      const from = Math.max(range.from, line.from), to = Math.min(range.to, line.to);
      // Whole lines, as in vim's linewise visual mode, get the line's full backing.
      const whole = from === line.from && (range.to > line.to || (line.length > 0 && to === line.to));
      if (whole) ranges.push(selectedLine.range(line.from));
      else if (to > from) ranges.push(selectedMark.range(from, to));
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}
const selectionField = StateField.define<DecorationSet>({
  create: selectionDecorations,
  update: (value, tr) => (tr.selection || tr.docChanged ? selectionDecorations(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff9ecb" },
  { tag: [tags.string, tags.special(tags.string)], color: "#b8f5a0" },
  { tag: tags.number, color: "#ffd479" },
  { tag: tags.comment, color: "#9aa3c0", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#8fd8ff" },
  { tag: tags.propertyName, color: "#d7c7ff" },
  { tag: [tags.operator, tags.punctuation], color: "#e6e6f0" },
]);

/** The editor's own extensions, kept in the state so a new document can reuse them. */
const editorExtensions = Facet.define<readonly Extension[], readonly Extension[]>({ combine: (values) => values[0] ?? [] });
const editorActions = Facet.define<EditorActions, EditorActions | null>({ combine: (values) => values[0] ?? null });

export type WriteArgs = { name?: string; overwrite: boolean } | { error: string };

/**
 * Parses what follows `:w`, as vim hands it over: `""` or undefined saves,
 * `" name"` renames, and `"! name"` renames over an existing sketch. Sketches
 * are always `.js`, so `name.js` means `name`.
 */
export function parseWriteArgs(argString: string | undefined): WriteArgs {
  let rest = argString ?? "";
  const overwrite = rest.startsWith("!");
  if (overwrite) rest = rest.slice(1);
  rest = rest.trim();
  if (!rest) return { overwrite };
  if (/\s/.test(rest)) return { error: `:w takes one sketch name, not "${rest}"` };
  const name = rest.replace(/\.js$/, "");
  if (!/^[\w-]+$/.test(name)) return { error: `invalid sketch name "${rest}": use letters, digits, _ and -` };
  return { name, overwrite };
}

/** `:w` and `:write` save the sketch; `:w name` saves it as `name` and renames it. */
export function writeCommand(view: EditorView, argString?: string): void {
  const actions = view.state.facet(editorActions);
  if (!actions) return;
  const args = parseWriteArgs(argString);
  if ("error" in args) actions.status?.(args.error, true);
  else if (args.name) actions.rename?.(args.name, args.overwrite);
  else actions.save();
}
Vim.defineEx("write", "w", (cm, params: { argString?: string }) => writeCommand(cm.cm6 as EditorView, params.argString));

/** Alt+R: remix the numbers in the block under the cursor and re-run it. */
export function remixCommand(view: EditorView, random: () => number = Math.random): boolean {
  const actions = view.state.facet(editorActions);
  const result = remix(view.state, random);
  if (!result) {
    actions?.status?.("Nothing to remix here: no numbers in this block");
    return true;
  }
  view.dispatch(result.spec);
  const range = remixRunRange(view.state);
  if (range) runRange(view, range.from, range.to);
  actions?.status?.(`Remixed ${result.count} number${result.count === 1 ? "" : "s"}; u or Ctrl+Z undoes`);
  return true;
}

/** Runs the code between `from` and `to` and flashes it. */
function runRange(view: EditorView, from: number, to: number): true {
  view.state.facet(editorActions)?.run(view.state.sliceDoc(from, to));
  view.dispatch({ effects: flash.of({ from, to }) });
  setTimeout(() => view.dispatch({ effects: flash.of(null) }), 250);
  return true;
}

function extensionsFor(actions: EditorActions): Extension[] {
  const evaluate = runRange;
  const runBlock = (view: EditorView) => {
    const block = blockAt(view.state.doc.toString(), view.state.selection.main.head);
    return block ? evaluate(view, block.from, block.to) : true;
  };
  const runAll = (view: EditorView) => evaluate(view, 0, view.state.doc.length);

  const extensions: Extension[] = [
    Prec.highest(keymap.of([
      { key: "Mod-Enter", run: runBlock },
      { key: "Mod-Shift-Enter", run: runAll },
      { key: "Alt-Enter", run: runAll },
      { key: "Mod-s", run: () => { actions.save(); return true; } },
      { key: "Alt-r", run: (view) => remixCommand(view) },
    ])),
    scrubbing((code) => actions.run(code)),
    vim({ status: false }),
    // A scrub gesture is one undo step however many ticks it takes.
    history({ joinToEvent: (tr, adjacent) => adjacent || joinsScrub(tr) }),
    drawSelection(),
    selectionField,
    closeBrackets(),
    autocompletion({ override: [hydraCompletions], activateOnTyping: true }),
    signatureHelp,
    bracketMatching(),
    javascript(),
    syntaxHighlighting(highlight),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    flashField,
    liveValues(),
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => { if (u.docChanged) actions.changed(); }),
    editorActions.of(actions),
  ];
  extensions.push(editorExtensions.of(extensions));
  return extensions;
}

/** A fresh editor state for `doc`, with empty undo history. */
export function createEditorState(doc: string, actions: EditorActions): EditorState {
  return EditorState.create({ doc, extensions: extensionsFor(actions) });
}

/**
 * A fresh state for another document, reusing `state`'s extensions but none
 * of its history. Whether live values show carries over.
 */
export function documentState(state: EditorState, doc: string): EditorState {
  return EditorState.create({ doc, extensions: [keepLiveValues(state), ...state.facet(editorExtensions)] });
}

/** Mirror vim's mode in the status bar. The vim plugin is recreated with each new state. */
function watchVimMode(view: EditorView) {
  const label = view.dom.ownerDocument.getElementById("vim-mode");
  if (label) label.textContent = "NORMAL";
  getCM(view)?.on("vim-mode-change", (event: { mode: string; subMode?: string }) => {
    if (label) label.textContent = event.mode === "insert" ? "INSERT" : event.mode.toUpperCase();
  });
}

/** The live-coding editor drawn over the visuals. */
export function createEditor(parent: HTMLElement, actions: EditorActions): EditorView {
  const view = new EditorView({ parent, state: createEditorState("", actions) });
  watchVimMode(view);
  return view;
}

/**
 * Show `text` in the editor. By default this starts a new document with
 * empty history, so undo can't bring back another sketch. With `undoable`,
 * as when the open sketch is reloaded after an edit on disk, the replacement
 * is an ordinary edit that undo reverts.
 */
export function setText(view: EditorView, text: string, options: { undoable?: boolean } = {}): void {
  if (options.undoable) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    return;
  }
  const focused = view.hasFocus;
  view.setState(documentState(view.state, text));
  watchVimMode(view);
  if (focused) view.focus();
}
