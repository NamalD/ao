import { type Completion, CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { describe, expect, it } from "vitest";
import { ao, aoDocs } from "../src/renderer/audio";
import {
  aoMemberDocs, chainMethods, functionDoc, generators, hydraCompletions, hydraDocs, memberCompletions,
  publicAoMembers, solidMethods, solidShapeNames, synonymCompletions, topLevelCompletions,
} from "../src/renderer/editor";

const labels = (options: readonly { label: string }[]) => options.map((option) => option.label);

/** Labels completion offers with the cursor at `|` in `source`, or null for no popup. */
function completionsAt(source: string, explicit = false): string[] | null {
  const pos = source.indexOf("|");
  const doc = source.slice(0, pos) + source.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [javascript()] });
  const result = hydraCompletions(new CompletionContext(state, pos, explicit));
  return result && labels(result.options);
}

describe("Hydra documentation", () => {
  it("describes every built-in GLSL function and each of its inputs", () => {
    for (const fn of hydraFunctions()) {
      expect(hydraDocs[fn.name]?.description, fn.name).toBeTruthy();
      for (const input of fn.inputs) {
        expect(hydraDocs[fn.name].params?.[input.name], `${fn.name}(${input.name})`).toBeTruthy();
      }
    }
  });

  it("has no entries for functions Hydra doesn't have", () => {
    const names = new Set(hydraFunctions().map((fn) => fn.name));
    expect(Object.keys(hydraDocs).filter((name) => !names.has(name))).toEqual([]);
  });
});

describe("completion lists", () => {
  it("derives generators and chain methods from hydra-synth", () => {
    expect(generators).toEqual(expect.arrayContaining(["osc", "noise", "voronoi", "src", "prev"]));
    expect(generators).not.toContain("rotate");
    expect(chainMethods).toEqual(expect.arrayContaining(["rotate", "modulateHue", "sum", "layer", "out"]));
    expect(chainMethods).not.toContain("osc");
    expect(labels(memberCompletions("hydra"))).toContain("modulateHue");
  });

  it("offers every HydraSource method plus initScene and clearScene after s0.", () => {
    const options = labels(memberCompletions("source"));
    expect(options).toEqual(expect.arrayContaining(["init", "initImage", "initVideo", "initCam", "initScreen", "clear", "initScene", "clearScene"]));
    expect(options).not.toContain("tick");
    expect(options).not.toContain("constructor");
    for (const name of options) expect(functionDoc(name, "s0")?.description, name).toBeTruthy();
  });

  it("offers Hydra's globals at the top level with real descriptions", () => {
    const options = topLevelCompletions();
    for (const name of ["o0", "o3", "s1", "render", "hush", "setFunction", "speed", "bpm", "time", "mouse", "width", "height", "update", "use", "ao", "osc"]) {
      const option = options.find((o) => o.label === name);
      expect(option?.info, name).toBeTruthy();
    }
  });

  it("offers the public ao members, not the internal features", () => {
    const options = labels(memberCompletions("ao"));
    expect(options).toEqual(expect.arrayContaining(["loudness", "impulse", "beat", "bass", "fft", "map"]));
    expect(options).not.toContain("features");
  });

  it("picks up new ao members without an editor change", () => {
    const target = { features: {}, get level() { return 1; }, band(_i: number) { return 0; } };
    expect(publicAoMembers(target)).toEqual([{ name: "level", method: false }, { name: "band", method: true }]);
  });
});

describe("ao documentation", () => {
  it("builds signature help from aoDocs signatures", () => {
    const docs = aoMemberDocs({
      bass: { signature: "ao.bass", description: "Bass level." },
      map: { signature: "ao.map(level, lo = 0, hi = 1)", description: "Maps a level." },
    });
    expect(docs.get("bass")?.params).toEqual([]);
    expect(docs.get("map")?.params).toEqual([
      { name: "level", default: null }, { name: "lo", default: "0" }, { name: "hi", default: "1" },
    ]);
    expect(docs.get("map")?.info).toContain("Maps a level.");
  });

  it("has an aoDocs entry for every public ao member", () => {
    for (const { name } of publicAoMembers(ao)) {
      expect(aoDocs[name]?.description, name).toBeTruthy();
      expect(aoDocs[name]?.signature, name).toMatch(new RegExp(`^ao\\.${name}\\b`));
    }
  });
});

describe("member completion follows what is before the dot", () => {
  it("offers solid methods after a solid chain and Hydra's after a Hydra one", () => {
    expect(completionsAt("sphere(1)\n  .spikes(0.3)\n  .|")).toEqual(expect.arrayContaining(["spikes", "spin", "add", "pipe", "out"]));
    expect(completionsAt("sphere(1)\n  .spikes(0.3)\n  .|")).not.toContain("modulateHue");
    expect(completionsAt("osc(10).rotate(0.1).|")).toContain("modulateHue");
    expect(completionsAt("osc(10).add(box().|")).toContain("spikes");
    expect(completionsAt("(noise()).|")).toContain("modulateHue");
  });

  it("offers nothing after a value that isn't a chain", () => {
    for (const source of ["ao.bass.|", "ao.bass.a|", "foo.a|", "let x = 1\nx.a|", "osc().out().|", "ao.map(\"bass\", 0, 1).|", "0.|"]) {
      expect(completionsAt(source), source).toBeNull();
      expect(completionsAt(source, true), `${source} (explicit)`).toBeNull();
    }
  });

  it("follows a variable to the chain it holds", () => {
    expect(completionsAt("const wave = osc(10).rotate()\nwave.|")).toContain("modulateHue");
    expect(completionsAt("let ball = sphere()\nball = ball.spin()\nball.|")).toContain("spikes");
    expect(completionsAt("ball = sphere()\nball.|")).not.toContain("modulateHue");
    expect(completionsAt("const out = o1\nout.set|")).toContain("setLinear");
  });

  it("treats a pipe function's first parameter as the solid it receives", () => {
    expect(completionsAt("torus().pipe((s, n) => s.|")).toContain("spikes");
    expect(completionsAt("const s = osc()\nconst f = (s) => s.|")).toBeNull();
  });

  it("offers a built-in namespace's own members", () => {
    const math = completionsAt("Math.s|");
    expect(math).toEqual(expect.arrayContaining(["sin", "sqrt", "PI"]));
    expect(math).not.toContain("add");
  });

  it("offers nothing while naming a new variable", () => {
    expect(completionsAt("const os|")).toBeNull();
  });

  it("offers solid shapes at the top level and documents every solid function", () => {
    expect(labels(topLevelCompletions())).toEqual(expect.arrayContaining(["sphere", "box", "torus"]));
    for (const name of [...solidShapeNames, ...solidMethods]) {
      expect(functionDoc(name, undefined, true)?.description, name).toBeTruthy();
    }
    expect(functionDoc("rotate", undefined, true)?.description).toContain("radians");
    expect(functionDoc("rotate")?.description).toBe(hydraDocs.rotate.description);
    expect(functionDoc("sphere")?.signature).toBe("sphere(radius = 1)");
    expect(functionDoc("add", undefined, true)?.signature).toBe("add(solid, smooth = 0)");
  });
});

describe("completing by synonym", () => {
  function resultAt(source: string): CompletionResult | null {
    const pos = source.indexOf("|");
    const doc = source.slice(0, pos) + source.slice(pos + 1);
    const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [javascript()] });
    return hydraCompletions(new CompletionContext(state, pos, false));
  }
  /** "synonym → name" for each synonym option offered at `|`. */
  const offered = (source: string) => (resultAt(source)?.options ?? [])
    .filter((option) => option.displayLabel)
    .map((option) => `${option.label} → ${option.apply}`);

  it("offers the real name for a synonym written in the same place", () => {
    expect(offered("ao.smoo|")).toEqual(["smooth → glide"]);
    expect(offered("osc(10)\n  .mov|")).toEqual(["move → scroll", "move → scrollX", "move → scrollY"]);
    expect(offered("const a = osc()\na.colou|")).toEqual(["colour → color"]);
    expect(offered("circ|")).toEqual(["circle → shape"]);
    expect(offered("s0.cam|")).toEqual(["camera → initCam"]);
  });

  it("shows the real name, below the real names", () => {
    const glide = resultAt("ao.smoo|")!.options.find((option) => option.label === "smooth")!;
    expect(glide).toMatchObject({ displayLabel: "glide", detail: "for smooth", type: "method" });
    expect(glide.boost).toBeLessThan(0);
  });

  it("offers nothing on a solid, after a letter or two, or for a name already matched", () => {
    expect(offered("sphere(1).mov|")).toEqual([]);
    expect(offered("ao.sm|")).toEqual([]);
    // highs leads to high, which "hig" already finds.
    expect(offered("ao.hig|")).toEqual([]);
  });

  it("asks again as each letter changes which synonyms match", () => {
    const short = resultAt("ao.sm|")!.validFor as (text: string) => boolean;
    expect(short("s")).toBe(true);
    expect(short("smo")).toBe(false);
    expect((resultAt("ao.smoo|")!.validFor as (text: string) => boolean)("smoot")).toBe(false);
  });

  it("hands an option's own apply the real name", () => {
    const applied: string[] = [];
    const option: Completion = { label: "scroll", apply: (_view, completion) => { applied.push(completion.label); } };
    const [synonym] = synonymCompletions([option], "hydra", "move");
    (synonym.apply as (...args: unknown[]) => void)(null, synonym, 0, 0);
    expect(applied).toEqual(["scroll"]);
  });
});
