import { undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, type EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { createEditorState, documentState, selectionDecorations, writeCommand } from "../src/renderer/editor";

const actions = () => ({ run: vi.fn(), save: vi.fn(), changed: vi.fn() });

function undoOnce(state: EditorState): EditorState {
  let next = state;
  undo({ state, dispatch: (tr: Transaction) => { next = tr.state; } });
  return next;
}

function typed(state: EditorState, text: string): EditorState {
  return state.update({ changes: { from: state.doc.length, insert: text }, userEvent: "input.type" }).state;
}

describe("switching sketches", () => {
  it("leaves nothing to undo, so undo can't restore the previous sketch", () => {
    const sketchA = typed(createEditorState("sketch A", actions()), " edited");
    expect(undoDepth(sketchA)).toBe(1);

    const sketchB = documentState(sketchA, "sketch B");
    expect(sketchB.doc.toString()).toBe("sketch B");
    expect(undoDepth(sketchB)).toBe(0);
    expect(undoOnce(sketchB).doc.toString()).toBe("sketch B");
  });

  it("keeps the editor's extensions for the new sketch", () => {
    const edits = actions();
    const sketchB = typed(documentState(createEditorState("sketch A", edits), "sketch B"), "!");
    expect(undoOnce(sketchB).doc.toString()).toBe("sketch B");
    writeCommand({ state: sketchB } as EditorView);
    expect(edits.save).toHaveBeenCalledOnce();
  });

  it("an in-place reload of the same sketch stays undoable", () => {
    const state = createEditorState("before", actions());
    const reloaded = state.update({ changes: { from: 0, to: state.doc.length, insert: "after" } }).state;
    expect(undoOnce(reloaded).doc.toString()).toBe("before");
  });
});

describe("selection decorations", () => {
  const classes = (state: EditorState) => {
    const found: { from: number; to: number; cls: string }[] = [];
    selectionDecorations(state).between(0, state.doc.length, (from, to, deco) => {
      found.push({ from, to, cls: String(deco.spec.class) });
    });
    return found;
  };

  it("marks partial lines and gives whole lines their own class", () => {
    const base = createEditorState("abc\ndef\nghi", actions());
    const state = base.update({ selection: EditorSelection.single(1, 7) }).state;
    expect(classes(state)).toEqual([
      { from: 1, to: 3, cls: "cm-selected" },
      { from: 4, to: 4, cls: "cm-selectedLine" },
    ]);
  });

  it("draws nothing for an empty selection", () => {
    expect(classes(createEditorState("abc", actions()))).toEqual([]);
  });
});
