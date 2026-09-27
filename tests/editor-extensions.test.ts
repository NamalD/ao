import { type Completion, CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { callParameterContext, functionDoc, hydraCompletions, memberCompletions, topLevelCompletions } from "../src/renderer/editor";
import { CATALOG } from "../src/renderer/extensions";

/** What completion offers with the cursor at `|` in `source`. */
function complete(source: string, explicit = false): { state: EditorState; result: CompletionResult | null } {
  const pos = source.indexOf("|");
  const doc = source.slice(0, pos) + source.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [javascript()] });
  return { state, result: hydraCompletions(new CompletionContext(state, pos, explicit)) };
}
const option = (source: string, label: string) => complete(source).result?.options.find((o) => o.label === label);
const labels = (options: readonly Completion[]) => options.map((o) => o.label);

describe("extension completion", () => {
  it("offers extension generators and helpers at the top level", () => {
    const options = labels(topLevelCompletions());
    expect(options).toEqual(expect.arrayContaining(["blinking", "smoothsun", "warp", "whitenoise", "lengthCenter", "x", "createGradient", "createLinearGradient", "oS"]));
    // Chain methods and output methods aren't generators.
    expect(options).not.toContain("mirrorX");
    expect(options).not.toContain("setLinear");
  });

  it("offers extension chain methods after a dot, without doubling Hydra's own", () => {
    const options = labels(memberCompletions("hydra"));
    expect(options).toEqual(expect.arrayContaining(["mirrorX", "inversion", "lookupX", "sin", "pow", "range", "clamp", "amp", "div"]));
    expect(options.filter((name) => name === "add")).toHaveLength(1);
    expect(options).not.toContain("blinking");
    expect(options).not.toContain("_sin");
  });

  it("offers hydra-outputs' methods after o0. to o3. and oS.", () => {
    for (const owner of ["o0", "o3", "oS"]) {
      expect(labels(complete(`${owner}.|`).result!.options), owner).toEqual(expect.arrayContaining(["setLinear", "setNearest", "clear", "setFbos", "setRepeat"]));
    }
    expect(labels(complete("o1.set|").result!.options)).toContain("setLinear");
    expect(labels(complete("o1.set|").result!.options)).not.toContain("rotate");
  });

  it("says which extension a name is from and that it needs use", () => {
    const blinking = option("blin|", "blinking")!;
    expect(blinking.detail).toBe('softpattern · needs use("softpattern")');
    expect(blinking.info).toContain("blinking(tiles = 5, scale = 5, speed = 0.5, phase = 0.03)");
    expect(blinking.info).toContain('needs await use("softpattern")');
    expect(option("osc().mirr|", "mirrorX")?.detail).toBe('fractals · needs use("fractals")');
    expect(option('await use("softpattern")\nsmooth|', "smoothsun")?.detail).toBe('softpattern · via use("softpattern")');
  });

  it("ranks extensions the sketch doesn't use just below built-ins, and ones it uses alongside them", () => {
    // CodeMirror adds boost to the match score: -1 sorts after built-ins that match as well, but before worse matches.
    const shape = option("s|", "shape")!, sin = option("osc().s|", "sin")!, smoothsun = option("s|", "smoothsun")!;
    expect(shape.boost ?? 0).toBe(0);
    expect(smoothsun.boost).toBe(-1);
    expect(sin.boost).toBe(-1);
    expect(option('await use("softpattern")\ns|', "smoothsun")?.boost).toBe(0);
    expect(option('await use("arithmetics")\nosc().s|', "sin")?.boost).toBe(0);
  });

  it("notes broken upstream functions in their info", () => {
    expect(option("leng|", "length")?.info).toContain("Broken upstream");
    expect(option("o0.setR|", "setRepeat")?.info).toContain("powers of two");
  });

  it("adds the use line when completing a name from an extension the sketch doesn't load", () => {
    const pick = (source: string, label: string) => {
      const { state, result } = complete(source);
      const chosen = result!.options.find((o) => o.label === label)!;
      let next = state;
      const view = { get state() { return next; }, dispatch: (spec: TransactionSpec) => { next = next.update(spec).state; } };
      if (typeof chosen.apply === "function") chosen.apply(view as unknown as EditorView, chosen, result!.from, state.selection.main.head);
      else next = next.update({ changes: { from: result!.from, to: state.selection.main.head, insert: chosen.apply ?? chosen.label } }).state;
      return { text: next.doc.toString(), cursor: next.selection.main.head };
    };
    const fresh = pick("// Lanterns\nblin|", "blinking");
    expect(fresh.text).toBe('// Lanterns\n\nawait use("softpattern")\n\nblinking');
    expect(fresh.cursor).toBe(fresh.text.length);
    expect(pick('await use("noise")\n\nosc().inver|', "inversion").text).toBe('await use("noise", "fractals")\n\nosc().inversion');
    expect(pick("blin|", "blinking").text).toBe('await use("softpattern")\n\nblinking');
    // Already loaded: a plain completion.
    expect(option('await use("softpattern")\nblin|', "blinking")?.apply).toBeUndefined();
  });

  it("completes extension names inside use's string", () => {
    const { result } = complete('await use("so|")');
    expect(labels(result!.options)).toEqual(CATALOG.map((ext) => ext.name));
    expect(result!.from).toBe('await use("'.length);
    expect(result!.options.find((o) => o.label === "softpattern")?.info).toContain("Thomas Jourdan");
    expect(labels(complete('await use("noise", "fr|').result!.options)).toContain("fractals");
    // Other strings still complete nothing.
    expect(complete('console.log("so|")').result).toBeNull();
  });
});

describe("extension signature help", () => {
  it("documents extension generators, chain methods and output methods", () => {
    expect(functionDoc("blinking")?.params.map((p) => p.name)).toEqual(["tiles", "scale", "speed", "phase"]);
    expect(functionDoc("blinking")?.params[0].description).toBeTruthy();
    expect(functionDoc("pow")?.signature).toBe("pow(value)");
    expect(functionDoc("setFbos", "o2")?.signature).toBe("setFbos(options, options2?)");
    expect(functionDoc("createLinearGradient")?.params.map((p) => p.name)).toEqual(["angle", "colors"]);
  });

  it("keeps Hydra's docs for the built-ins arithmetics wraps, and stays off other objects' methods", () => {
    expect(functionDoc("add")?.signature).toBe("add(texture, amount = 1)");
    expect(functionDoc("pow", "Math")).toBeUndefined();
    expect(functionDoc("setLinear")).toBeUndefined();
  });

  it("finds the call for an extension function", () => {
    const source = "smoothsun(0.3, 0.2)";
    const state = EditorState.create({ doc: source, extensions: [javascript()] });
    expect(callParameterContext(state, source.indexOf("0.2") + 1)).toEqual({ name: "smoothsun", solid: false, activeParameter: 1 });
  });
});
