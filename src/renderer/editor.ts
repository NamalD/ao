import { autocompletion, closeBrackets, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { getCM, vim } from "@replit/codemirror-vim";
import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { blockAt } from "./blocks";

export interface EditorActions {
  run(code: string): void;
  save(): void;
  changed(): void;
}

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

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff9ecb" },
  { tag: [tags.string, tags.special(tags.string)], color: "#b8f5a0" },
  { tag: tags.number, color: "#ffd479" },
  { tag: tags.comment, color: "#9aa3c0", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#8fd8ff" },
  { tag: tags.propertyName, color: "#d7c7ff" },
  { tag: [tags.operator, tags.punctuation], color: "#e6e6f0" },
]);

const generators = [
  "osc", "noise", "shape", "gradient", "voronoi", "solid", "src",
];
const transforms = [
  "rotate", "scale", "pixelate", "kaleid", "scrollX", "scrollY", "repeat",
  "repeatX", "repeatY", "modulateRepeat", "modulateRepeatX", "modulateRepeatY",
  "modulateKaleid", "modulateScrollX", "modulateScrollY", "modulate", "modulateScale",
  "modulatePixelate", "modulateRotate", "posterize", "shift", "color", "saturate",
  "contrast", "brightness", "luma", "thresh", "invert", "hue",
  "colorama", "r", "g", "b", "a", "add", "sub", "layer", "blend", "mult",
  "diff", "mask", "out",
].map((name) => name.trim());
const audioMembers = ["features", "time", "loudness", "impulse", "beat", "bass", "mid", "high", "fft", "map"];
const sourceMembers = ["init", "initScene", "src", "dynamic"];
const completions = (names: string[], detail: string): Completion[] => names.map((label) => ({ label, type: "function", detail }));
const topLevelCompletions = [
  ...completions(generators, "Hydra generator"),
  ...["s0", "s1", "s2", "s3"].map((label) => ({ label, type: "variable", detail: "Hydra source" })),
  { label: "ao", type: "variable", detail: "Audio features" },
  ...completions(["render", "hush"], "Hydra control"),
];

interface HydraInput { name: string; type: string; default?: number | string | null }
interface HydraFunction { name: string; type: string; inputs: HydraInput[] }
interface ParameterDoc { name: string; description: string; type?: string; default?: number | string | null }
interface FunctionDoc { signature: string; params: ParameterDoc[]; info: string }

const inputHelp: Record<string, string> = {
  frequency: "Oscillation frequency.", sync: "Animation speed.", offset: "Phase or position offset.",
  scale: "Pattern or channel scale.", speed: "Animation speed.", blending: "Cell edge blending.",
  sides: "Number of polygon sides.", radius: "Shape radius.", smoothing: "Edge softness.",
  tex: "Source texture to sample.", r: "Red channel.", g: "Green channel.", b: "Blue channel.",
  a: "Alpha channel.", angle: "Rotation angle in radians.", amount: "Effect amount.",
  xMult: "Horizontal scale multiplier.", yMult: "Vertical scale multiplier.",
  offsetX: "Horizontal offset.", offsetY: "Vertical offset.", pixelX: "Horizontal pixel count.",
  pixelY: "Vertical pixel count.", bins: "Number of color levels.", gamma: "Gamma adjustment.",
  repeatX: "Horizontal repeat count.", repeatY: "Vertical repeat count.", reps: "Repeat count.",
  nSides: "Number of kaleidoscope segments.", scrollX: "Horizontal scroll amount.",
  scrollY: "Vertical scroll amount.", speedX: "Horizontal scroll speed.", speedY: "Vertical scroll speed.",
  multiple: "Effect multiplier.", threshold: "Luma threshold.", tolerance: "Threshold softness.",
  hue: "Hue rotation.",
};

const hydraFunctionDocs = new Map<string, FunctionDoc>((hydraFunctions() as HydraFunction[]).map((fn) => {
  const params = [
    ...(fn.type === "combine" || fn.type === "combineCoord"
      ? [{ name: "input", type: "texture", description: "Texture to combine with this chain." }]
      : []),
    ...fn.inputs.map((input) => ({
      ...input,
      description: inputHelp[input.name] ?? `${input.type} input for ${fn.name}.`,
    })),
  ];
  const signature = `${fn.name}(${params.map((param) => `${param.name}${param.default == null ? "" : ` = ${param.default}`}`).join(", ")})`;
  const kind = fn.type === "src" ? "Source" : fn.type === "coord" ? "Geometry transform" : fn.type === "color" ? "Color transform" : "Texture transform";
  const info = `${signature}\n${kind}. Function values are re-evaluated each frame.\n${params.map((param) => `${param.name}: ${param.description}`).join("\n")}`;
  return [fn.name, { signature, params, info }] as const;
}));

const extraFunctionDocs = new Map<string, FunctionDoc>([
  ["map", {
    signature: "map(level, lo = 0, hi = 1)",
    params: [
      { name: "level", description: "Audio level: loudness, impulse, beat, bass, mid, or high." },
      { name: "lo", description: "Mapped value when the level is zero." },
      { name: "hi", description: "Mapped value when the level is one." },
    ],
    info: "map(level, lo = 0, hi = 1)\nMaps an Ao audio level into a range and returns a function Hydra can animate.",
  }],
  ["initScene", {
    signature: "initScene(source, options?)",
    params: [
      { name: "source", description: "GLSL ES 3.0 fragment shader source." },
      { name: "options", description: "Optional scale and custom uniforms." },
    ],
    info: "initScene(source, options?)\nLoad a Shadertoy-style shader into this Ao source.",
  }],
  ["out", {
    signature: "out(output = o0)",
    params: [{ name: "output", description: "Hydra output buffer. Defaults to o0, the visible output." }],
    info: "out(output = o0)\nRender this chain to a Hydra output buffer.",
  }],
]);

function functionDoc(name: string) {
  return hydraFunctionDocs.get(name) ?? extraFunctionDocs.get(name);
}

function documentedCompletions(names: string[], detail: string): Completion[] {
  return names.map((label) => {
    const docs = functionDoc(label);
    return { label, type: "function", detail: docs?.signature ?? detail, info: docs?.info };
  });
}

function signatureTooltip(state: EditorState, pos: number): Tooltip | null {
  if (!state.selection.main.empty) return null;
  let args: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (args && args.name !== "ArgList") args = args.parent;
  if (!args || pos < args.from || pos > args.to || (pos === args.to && state.sliceDoc(pos - 1, pos) === ")")) return null;
  const call = args.parent;
  if (!call || call.name !== "CallExpression") return null;
  const name = state.sliceDoc(call.from, args.from).trim().match(/([\w$]+)$/)?.[1];
  if (!name) return null;
  const docs = functionDoc(name);
  if (!docs) return null;

  let activeParameter = 0;
  for (let child = args.firstChild; child; child = child.nextSibling) {
    if (child.name === "," && child.from < pos) activeParameter++;
  }
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
      if (param) {
        const description = document.createElement("div");
        description.className = "cm-signature-description";
        description.textContent = `${param.name}: ${param.description}`;
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
    const owner = member?.[1];
    const options = owner === "ao"
      ? documentedCompletions(audioMembers, "Ao audio API")
      : owner?.startsWith("s") ? documentedCompletions(sourceMembers, "Hydra source") : documentedCompletions(transforms, "Hydra chain method");
    return { from, options, validFor: /^[\w$]*$/ };
  }

  return { from, options: topLevelCompletions.map((completion) => {
    const docs = functionDoc(completion.label);
    return docs ? { ...completion, detail: docs.signature, info: docs.info } : completion;
  }), validFor: /^[\w$]*$/ };
}

/** The live-coding editor drawn over the visuals. */
export function createEditor(parent: HTMLElement, actions: EditorActions): EditorView {
  let view: EditorView;
  const evaluate = (from: number, to: number) => {
    actions.run(view.state.sliceDoc(from, to));
    view.dispatch({ effects: flash.of({ from, to }) });
    setTimeout(() => view.dispatch({ effects: flash.of(null) }), 250);
    return true;
  };
  const runBlock = () => {
    const block = blockAt(view.state.doc.toString(), view.state.selection.main.head);
    return block ? evaluate(block.from, block.to) : true;
  };
  const runAll = () => evaluate(0, view.state.doc.length);

  view = new EditorView({
    parent,
    state: EditorState.create({
      extensions: [
        Prec.highest(keymap.of([
          { key: "Mod-Enter", run: runBlock },
          { key: "Mod-Shift-Enter", run: runAll },
          { key: "Alt-Enter", run: runAll },
          { key: "Mod-s", run: () => { actions.save(); return true; } },
        ])),
        vim({ status: false }),
        history(),
        drawSelection(),
        closeBrackets(),
        autocompletion({ override: [hydraCompletions], activateOnTyping: true }),
        signatureHelp,
        bracketMatching(),
        javascript(),
        syntaxHighlighting(highlight),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        flashField,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => { if (u.docChanged) actions.changed(); }),
      ],
    }),
  });
  const cm = getCM(view);
  cm?.on("vim-mode-change", (event: { mode: string; subMode?: string }) => {
    const mode = parent.ownerDocument.getElementById("vim-mode");
    if (mode) mode.textContent = event.mode === "insert" ? "INSERT" : event.mode.toUpperCase();
  });
  return view;
}

export function setText(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
