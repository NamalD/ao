import { undo } from "@codemirror/commands";
import { readdirSync, readFileSync } from "node:fs";
import { EditorSelection, type EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { createEditorState, formatRange } from "../src/renderer/editor";
import { formatCode, minimalChange } from "../src/renderer/format";

const actions = () => ({ run: vi.fn(), save: vi.fn(), changed: vi.fn() });

/** Enough of an EditorView for formatRange. */
function fakeView(state: EditorState) {
  return {
    state,
    dispatch(spec: TransactionSpec) { this.state = this.state.update(spec).state; },
  };
}

describe("formatCode", () => {
  it("formats in the sketch style: no semicolons, double quotes, no trailing newline", async () => {
    const result = await formatCode("osc( 20,0.1 ).out( o0 );\nsetFunction({name:'x'})");
    expect(result?.code).toBe(`osc(20, 0.1).out(o0)\nsetFunction({ name: "x" })`);
  });

  it("chops a chain standing on its own one call per line, even when it would fit", async () => {
    const result = await formatCode("const x = noise(3).color(1, 0, 0).out(o1)\nosc(4).blend(src(o0).scale(1.01).rotate(1), 0.5).out()");
    expect(result?.code).toBe([
      "const x = noise(3)", "  .color(1, 0, 0)", "  .out(o1)",
      "osc(4)", "  .blend(src(o0).scale(1.01).rotate(1), 0.5)", "  .out()",
    ].join("\n"));
  });

  it("carries the cursor to the same code", async () => {
    const code = "osc(20,0.1).out( o0 )";
    const result = await formatCode(code, code.indexOf("o0"));
    expect(result?.code.slice(result.cursor)).toBe("o0)");
  });

  it("accepts top-level await, which runs fine inside Ao's async wrapper", async () => {
    expect((await formatCode("await  fetch('x')"))?.code).toBe(`await fetch("x")`);
  });

  it("leaves GLSL strings alone", async () => {
    const code = "setFunction({ glsl: `\nfloat x=1.;return vec4(x);` })";
    expect((await formatCode(code))?.code).toContain("float x=1.;return vec4(x);");
  });

  // Sketches are live-coded and committed as they are, so only `make check-sketches` holds them to this.
  it.runIf(process.env.AO_CHECK_SKETCHES)("leaves the bundled sketches as they are, so running one doesn't rewrite it", async () => {
    for (const file of readdirSync("sketches")) {
      const code = readFileSync(`sketches/${file}`, "utf8").replace(/\n+$/, "");
      expect((await formatCode(code))?.code, file).toBe(code);
    }
  });

  it("returns null for code that doesn't parse", async () => {
    expect(await formatCode("osc(20).out(")).toBeNull();
  });
});

describe("minimalChange", () => {
  it("replaces only what differs", () => {
    expect(minimalChange("osc( 1 )", "osc(1)", 10)).toEqual({ from: 14, to: 17, insert: "1" });
    expect(minimalChange("same", "same")).toBeNull();
    expect(minimalChange("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
  });
});

describe("formatRange", () => {
  const SKETCH = "osc( 20 ).out()\n\nnoise(3,0.1).out( o1 )";
  const block = { from: SKETCH.indexOf("noise"), to: SKETCH.length };

  it("formats only the range, keeps the cursor on its code, and is one undo step", async () => {
    const start = createEditorState(SKETCH, actions());
    const view = fakeView(start.update({ selection: EditorSelection.cursor(SKETCH.indexOf("o1")) }).state);
    await formatRange(view, block.from, block.to);
    expect(view.state.doc.toString()).toBe("osc( 20 ).out()\n\nnoise(3, 0.1).out(o1)");
    expect(view.state.sliceDoc(view.state.selection.main.head)).toBe("o1)");

    let undone = view.state;
    undo({ state: view.state, dispatch: (tr: Transaction) => { undone = tr.state; } });
    expect(undone.doc.toString()).toBe(SKETCH);
  });

  it("leaves broken code and already formatted code untouched", async () => {
    for (const doc of ["osc(20).out(", "osc(20).out()"]) {
      const view = fakeView(createEditorState(doc, actions()));
      const dispatch = vi.spyOn(view, "dispatch");
      await formatRange(view, 0, doc.length);
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it("drops the result if the document changed while formatting", async () => {
    const view = fakeView(createEditorState(SKETCH, actions()));
    const pending = formatRange(view, 0, SKETCH.length);
    view.dispatch({ changes: { from: 0, insert: "// typed\n" } });
    await pending;
    expect(view.state.doc.toString()).toBe(`// typed\n${SKETCH}`);
  });
});
