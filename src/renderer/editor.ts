import { closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
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
        history(),
        drawSelection(),
        closeBrackets(),
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
  return view;
}

export function setText(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
