import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { callParameterContext } from "../src/renderer/editor";

function contextAt(source: string, marker: string) {
  const pos = source.indexOf(marker) + Math.floor(marker.length / 2);
  const state = EditorState.create({ doc: source, selection: { anchor: pos }, extensions: [javascript()] });
  return callParameterContext(state, pos);
}

describe("call parameter context", () => {
  it("resolves the callee and active argument inside a function call", () => {
    expect(contextAt("osc(10, 0.2)", "0.2")).toEqual({ name: "osc", solid: false, activeParameter: 1 });
  });

  it("uses the innermost call when arguments are nested", () => {
    expect(contextAt("osc(10, shape(5, 0.2), 0.5)", "0.2")).toEqual({ name: "shape", solid: false, activeParameter: 1 });
  });

  it("resolves a chained method name", () => {
    expect(contextAt("osc(10).rotate(0.5)", "0.5")).toEqual({ name: "rotate", solid: false, activeParameter: 0 });
  });

  it("marks methods on a solid chain, so rotate gets the solid's help", () => {
    expect(contextAt("sphere(1)\n  .spikes(0.3)\n  .rotate(0.5)", "0.5")).toEqual({ name: "rotate", solid: true, activeParameter: 0 });
    expect(contextAt("sphere().add(osc(10).rotate(0.5))", "0.5")).toEqual({ name: "rotate", solid: false, activeParameter: 0 });
    expect(contextAt("osc().add(box().move(0.5))", "0.5")).toEqual({ name: "move", solid: true, activeParameter: 0 });
  });
});
