import { autocompletion, closeBrackets, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { getCM, vim } from "@replit/codemirror-vim";
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
      ? completions(audioMembers, "Ao audio API")
      : owner?.startsWith("s") ? completions(sourceMembers, "Hydra source") : completions(transforms, "Hydra chain method");
    return { from, options, validFor: /^[\w$]*$/ };
  }

  return { from, options: topLevelCompletions, validFor: /^[\w$]*$/ };
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
