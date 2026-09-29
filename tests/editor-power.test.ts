import { redo, undo, undoDepth } from "@codemirror/commands";
import { EditorSelection, type EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { createEditorState, parseWriteArgs, runCommand, runCommandRange, writeCommand } from "../src/renderer/editor";
import { remix } from "../src/renderer/remix";
import { ScrubGesture, stepMultiplier } from "../src/renderer/scrub";
import { literalAt } from "../src/renderer/numbers";
import { SketchWriter } from "../src/renderer/sketch-writer";

const actions = () => ({ run: vi.fn(), save: vi.fn(), changed: vi.fn(), rename: vi.fn(), status: vi.fn() });

function command(state: EditorState, cmd: typeof undo): EditorState {
  let next = state;
  cmd({ state, dispatch: (tr: Transaction) => { next = tr.state; } });
  return next;
}
const typed = (state: EditorState, text: string) =>
  state.update({ changes: { from: state.doc.length, insert: text }, userEvent: "input.type" }).state;
const at = (state: EditorState, pos: number) => state.update({ selection: EditorSelection.cursor(pos) }).state;

const SKETCH = `osc(20, 0.05, 1.5)\n  .rotate(-0.25)\n  .out()\n\nnoise(3).out(o1)`;

describe("remix", () => {
  it("changes only the block under the cursor, and one undo restores the exact original", () => {
    let state = at(typed(createEditorState(SKETCH.slice(0, -1), actions()), ")"), 2);
    const result = remix(state, () => 0.99)!;
    state = state.update(result.spec).state;
    expect(result.count).toBe(4);
    expect(state.doc.toString()).not.toBe(SKETCH);
    expect(state.doc.toString().endsWith("\n\nnoise(3).out(o1)")).toBe(true);

    state = command(state, undo);
    expect(state.doc.toString()).toBe(SKETCH);
    // The remix didn't swallow the typing before it: that's a separate step.
    expect(undoDepth(state)).toBe(1);
    expect(command(state, redo).doc.toString()).toBe(state.update(result.spec).state.doc.toString());
  });

  it("stays undoable across an autosave, and the undone text is saved too", async () => {
    const written: string[] = [];
    const writer = new SketchWriter(async (_name, code) => { written.push(code); });
    let state = createEditorState(SKETCH, actions());
    writer.known("waves", SKETCH);
    state = state.update(remix(at(state, 2), () => 0.2)!.spec).state;
    await writer.save("waves", state.doc.toString());
    state = command(state, undo);
    expect(state.doc.toString()).toBe(SKETCH);
    await writer.save("waves", state.doc.toString());
    expect(written).toEqual([expect.not.stringMatching(/^osc\(20, 0\.05/), SKETCH]);
  });

  it("does nothing on a blank line or a block without numbers", () => {
    expect(remix(at(createEditorState(SKETCH, actions()), SKETCH.indexOf("\n\n") + 1))).toBeNull();
    expect(remix(createEditorState("src(o0).out()", actions()))).toBeNull();
  });
});

describe("scrub gestures", () => {
  function scrub(state: EditorState, pos: number, moves: number[], time = 1000): EditorState {
    const gesture = new ScrubGesture(state, literalAt(state, pos)!, time);
    for (const steps of moves) {
      const spec = gesture.move(state, steps);
      if (spec) state = state.update(spec).state;
      gesture.applied(state);
    }
    const end = gesture.end();
    return end ? state.update(end).state : state;
  }

  it("moves a literal through zero and undoes the whole gesture as one step", () => {
    let state = typed(createEditorState("a-", actions()), "2");
    state = scrub(state, 2, [-1, -1, -1, -1, +1]);
    expect(state.doc.toString()).toBe("a- -1");
    state = command(state, undo);
    expect(state.doc.toString()).toBe("a-2");
    expect(command(state, undo).doc.toString()).toBe("a-");
  });

  it("groups repeated fine and Shift-coarse steps into one undo event", () => {
    let state = createEditorState("osc(0.05)", actions());
    const cursor = 5;
    const gesture = new ScrubGesture(state, literalAt(state, cursor)!);
    for (const steps of [1, stepMultiplier(true), -1]) {
      const spec = gesture.move(state, steps);
      if (spec) state = state.update(spec).state;
      gesture.applied(state);
    }
    const end = gesture.end();
    if (end) state = state.update(end).state;

    expect(state.doc.toString()).toBe("osc(0.15)");
    expect(command(state, undo).doc.toString()).toBe("osc(0.05)");
  });

  it("keeps separate gestures as separate undo steps", () => {
    let state = createEditorState("osc(0.50)", actions());
    state = scrub(state, 5, [3], 1000);
    state = scrub(state, 5, [-1, -1], 1100);
    expect(state.doc.toString()).toBe("osc(0.51)");
    state = command(state, undo);
    expect(state.doc.toString()).toBe("osc(0.53)");
    expect(command(state, undo).doc.toString()).toBe("osc(0.50)");
  });

  it("stops when something else edits the document", () => {
    let state = createEditorState("osc(10)", actions());
    const gesture = new ScrubGesture(state, literalAt(state, 5)!);
    state = typed(state, "\n");
    expect(gesture.move(state, 1)).toBeNull();
  });
});

describe(":w arguments", () => {
  it("saves without a name and renames with one", () => {
    expect(parseWriteArgs(undefined)).toEqual({ overwrite: false });
    expect(parseWriteArgs("")).toEqual({ overwrite: false });
    expect(parseWriteArgs(" dunes-2")).toEqual({ name: "dunes-2", overwrite: false });
    expect(parseWriteArgs(" dunes_2.js ")).toEqual({ name: "dunes_2", overwrite: false });
    expect(parseWriteArgs("! prism")).toEqual({ name: "prism", overwrite: true });
    expect(parseWriteArgs("!")).toEqual({ overwrite: true });
  });

  it("refuses names Store would refuse", () => {
    for (const bad of [" ../x", " a b", " a.txt", " .js", " né"]) expect(parseWriteArgs(bad)).toHaveProperty("error");
  });

  it("routes to save, rename, or a status error", () => {
    const edits = actions();
    const view = { state: createEditorState("", edits) } as EditorView;
    writeCommand(view);
    writeCommand(view, " halo2");
    writeCommand(view, "! halo");
    writeCommand(view, " ../etc");
    expect(edits.save).toHaveBeenCalledOnce();
    expect(edits.rename.mock.calls).toEqual([["halo2", false], ["halo", true]]);
    expect(edits.status).toHaveBeenCalledWith(expect.stringMatching(/invalid sketch name/), true);
  });
});

describe(":run", () => {
  const lines = (state: EditorState, from: number, to: number) => state.sliceDoc(from, to);

  it("covers the whole sketch without a range, and whole lines with one", () => {
    const state = createEditorState(SKETCH, actions());
    const range = (line?: number, lineEnd?: number) => {
      const { from, to } = runCommandRange(state, line, lineEnd);
      return lines(state, from, to);
    };
    expect(range()).toBe(SKETCH);
    expect(range(1)).toBe("  .rotate(-0.25)");
    expect(range(0, 2)).toBe("osc(20, 0.05, 1.5)\n  .rotate(-0.25)\n  .out()");
    // `:*run` hands the lines over backwards; a range past the end stops at the last line.
    expect(range(2, 0)).toBe(range(0, 2));
    expect(range(4, 99)).toBe("noise(3).out(o1)");
  });

  it("runs the code in range", () => {
    const edits = { ...actions(), autoFormat: () => false };
    const view = { state: createEditorState(SKETCH, edits), dispatch: vi.fn() } as unknown as EditorView;
    runCommand(view);
    runCommand(view, 4);
    expect(edits.run.mock.calls).toEqual([[SKETCH], ["noise(3).out(o1)"]]);
  });
});
