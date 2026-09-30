import { type Completion, CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { aoHydraFunctions } from "../src/renderer/audio-sources";
import { describe, expect, it } from "vitest";
import { ao, aoDocs, levelArguments, levels } from "../src/renderer/audio";
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

/** Details of the options completion offers at `|` in `source`. */
function detailsAt(source: string): (string | undefined)[] {
  const pos = source.indexOf("|");
  const state = EditorState.create({ doc: source.slice(0, pos) + source.slice(pos + 1), selection: { anchor: pos }, extensions: [javascript()] });
  return hydraCompletions(new CompletionContext(state, pos, true))?.options.map((option) => option.detail) ?? [];
}

/** The detail completion shows for `label` at `|` in `source`. */
function detailOf(source: string, label: string): string | undefined {
  const pos = source.indexOf("|");
  const state = EditorState.create({ doc: source.slice(0, pos) + source.slice(pos + 1), selection: { anchor: pos }, extensions: [javascript()] });
  return hydraCompletions(new CompletionContext(state, pos, true))?.options.find((option) => option.label === label)?.detail;
}

describe("Hydra documentation", () => {
  it("describes every built-in GLSL function and Ao addition, and each of its inputs", () => {
    for (const fn of [...hydraFunctions(), ...aoHydraFunctions]) {
      expect(hydraDocs[fn.name]?.description, fn.name).toBeTruthy();
      for (const input of fn.inputs) {
        expect(hydraDocs[fn.name].params?.[input.name], `${fn.name}(${input.name})`).toBeTruthy();
      }
    }
  });

  it("has no entries for functions Hydra doesn't have", () => {
    const names = new Set([...hydraFunctions(), ...aoHydraFunctions].map((fn) => fn.name));
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

  it("offers Ao's audio sources as generators and polar as a chain method", () => {
    expect(generators).toEqual(expect.arrayContaining(["spectrum", "history", "waveform"]));
    expect(chainMethods).toContain("polar");
    expect(labels(memberCompletions("hydra"))).toContain("polar");
  });

  it("offers every HydraSource method, and no scene methods, after s0.", () => {
    const options = labels(memberCompletions("source"));
    expect(options).toEqual(expect.arrayContaining(["init", "initImage", "initVideo", "initCam", "initScreen", "clear"]));
    expect(options).not.toContain("initScene");
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

  it("follows a call to the sketch's own function to what it returns", () => {
    expect(completionsAt("const ripples = (a, b) => osc(a).kaleid(b)\nripples(1, 2).|")).toContain("modulateHue");
    expect(completionsAt("const blob = () => { return sphere() }\nblob().|")).toContain("spikes");
    expect(completionsAt("function blob(big) {\n  if (big) return sphere(1)\n  return box()\n}\nblob().|")).toContain("spikes");
    expect(completionsAt("const lib = { blob: () => sphere() }\nlib.blob().|")).toContain("spikes");
    expect(completionsAt("function odd() { if (x) return sphere(); return osc() }\nodd().|")).toBeNull();
  });

  it("stops at a function that calls itself", () => {
    expect(completionsAt("const grow = (n) => (n > 0 ? grow(n - 1).spin() : sphere())\ngrow(3).|")).toContain("spikes");
    expect(completionsAt("const loop = () => loop()\nloop().|")).toBeNull();
  });

  it("follows both branches of a conditional that agree", () => {
    expect(completionsAt("const s = ao.beat > 0.5 ? sphere() : box()\ns.|")).toContain("spikes");
    expect(completionsAt("const s = ao.beat > 0.5 ? sphere() : osc()\ns.|")).toBeNull();
  });

  it("follows arrays and objects to the chains they hold", () => {
    const shapes = "const shapes = [sphere(), box(), torus()]\n";
    expect(completionsAt(`${shapes}shapes[0].|`)).toContain("spikes");
    expect(completionsAt(`${shapes}shapes.map((s) => s.|)`)).toContain("spikes");
    expect(completionsAt(`${shapes}shapes.filter((s, i) => i > 0).forEach((s) => s.|)`)).toContain("spikes");
    expect(completionsAt(`${shapes}shapes.reduce((a, b) => a.|)`)).toContain("spikes");
    expect(completionsAt(`${shapes}const all = shapes.reduce((a, b) => a.add(b))\nall.|`)).toContain("spikes");
    expect(completionsAt("const rings = Array.from({ length: 5 }, (_, i) => torus(0.2 * i))\nrings[2].|")).toContain("spikes");
    expect(completionsAt("const mixed = [sphere(), osc()]\nmixed[0].|")).toBeNull();
    expect(completionsAt("const scene = { ball: sphere(), wash: osc() }\nscene.ball.|")).toContain("spikes");
    expect(completionsAt("const ball = sphere()\nconst scene = { ball }\nscene.ball.|")).toContain("spikes");
  });

  it("offers an object literal's keys, described by what each holds", () => {
    const scene = "const scene = { ball: sphere(), wash: osc(), size: 3, make: () => box() }\n";
    expect(completionsAt(`${scene}scene.|`)).toEqual(["ball", "wash", "size", "make"]);
    expect(detailsAt(`${scene}scene.|`)).toEqual(["solid", "Hydra chain", "number", "→ solid"]);
  });

  it("treats a named function passed to a solid's pipe as receiving the solid", () => {
    expect(completionsAt("const spikey = (s, n) => s.sp|ikes(n)\ntorus().pipe(spikey, 0.4)")).toContain("spin");
    expect(completionsAt("function spikey(s) { return s.| }\ntorus().pipe(spikey)")).toContain("spikes");
    expect(completionsAt("const spikey = (s) => s.sp|ikes()\nosc().pipe(spikey)")).toBeNull();
  });

  it("offers a built-in namespace's own members", () => {
    const math = completionsAt("Math.s|");
    expect(math).toEqual(expect.arrayContaining(["sin", "sqrt", "PI"]));
    expect(math).not.toContain("add");
  });

  it("offers nothing while naming a new variable", () => {
    expect(completionsAt("const os|")).toBeNull();
  });

  it("offers the sketch's own names, described by what they hold", () => {
    const sketch = "const ball = sphere()\nconst wave = () => osc()\nconst rings = [torus(), torus()]\nenergy = () => ao.bass\n|";
    const options = completionsAt(sketch, true);
    expect(options).toEqual(expect.arrayContaining(["ball", "wave", "rings", "energy"]));
    expect(detailOf(sketch, "ball")).toBe("solid");
    expect(detailOf(sketch, "wave")).toBe("→ Hydra chain");
    expect(detailOf(sketch, "rings")).toBe("solid array");
    expect(detailOf(sketch, "energy")).toBe("sketch function");
    expect(detailOf("const out = o1\no|", "out")).toBe("Hydra output");
    expect(detailOf("let spin = 0.1\ns|", "spin")).toBe("number");
  });

  it("offers a name only where it can be seen, and what it holds there", () => {
    expect(completionsAt("function f() { const inner = sphere() }\nin|")).not.toContain("inner");
    expect(completionsAt("function f(size) { const inner = sphere()\n  in| }")).toEqual(expect.arrayContaining(["inner", "size"]));
    expect(detailOf("torus().pipe((s, n) => s.add(s|))", "s")).toBe("solid");
    expect(detailOf("let ball = osc()\nball = sphere()\nb|", "ball")).toBe("solid");
  });

  it("offers a declared name in place of the built-in it hides, and not a built-in a sketch assigns", () => {
    const shape = completionsAt("const shape = sphere()\nsha|")!;
    expect(shape.filter((label) => label === "shape")).toHaveLength(1);
    expect(detailOf("const shape = sphere()\nsha|", "shape")).toBe("solid");
    expect(detailOf("bpm = 120\nbp|", "bpm")).toBe(detailOf("bp|", "bpm"));
    expect(completionsAt("bpm = 120\nbp|")!.filter((label) => label === "bpm")).toHaveLength(1);
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

describe("completing an options object's keys", () => {
  const keys = ["scale", "camera", "background", "glow", "step", "trails"];

  it("offers a solid's out options where a key goes", () => {
    for (const source of ["sphere().out(s0, {|", "sphere().out(s0, { ca|", "sphere().out(s0, { ca| })", "torus()\n  .out(s1, {\n    |\n  })"]) {
      expect(completionsAt(source, true), source).toEqual(keys);
    }
    expect(completionsAt("sphere().out(s0, { glow: 1, |})")).toEqual(keys.filter((key) => key !== "glow"));
    expect(completionsAt("sphere().out(s0, { glow: 1, st| })")).toEqual(keys.filter((key) => key !== "glow"));
  });

  it("offers ordinary completion for a key's value", () => {
    expect(completionsAt("sphere().out(s0, { glow: ao.b|")).toContain("bass");
    expect(completionsAt("sphere().out(s0, { glow: |", true)).not.toContain("camera");
  });

  it("offers no keys to an object that isn't a documented options argument", () => {
    expect(completionsAt("osc().out(o0, { ca|")).not.toContain("camera");
    expect(completionsAt("sphere().out({ ca|")).not.toContain("camera");
    expect(completionsAt("const o = { ca|")).not.toContain("camera");
  });

  it("adds the colon unless the key already has one", () => {
    const apply = (source: string) => {
      const pos = source.indexOf("|");
      const state = EditorState.create({ doc: source.replace("|", ""), extensions: [javascript()] });
      return hydraCompletions(new CompletionContext(state, pos, true))?.options.find((o) => o.label === "camera")?.apply;
    };
    expect(apply("sphere().out(s0, { ca|")).toBe("camera: ");
    expect(apply("sphere().out(s0, { ca|: 2 })")).toBe("camera");
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

describe("level names for ao.map, ao.fit and ao.glide", () => {
  it("offers the readings ao.map can map inside its first argument's quotes", () => {
    const options = completionsAt('osc().rotate(ao.map("|"))');
    expect(options).toEqual(expect.arrayContaining(["bass", "mid", "high", "beat", "centroid", "phase"]));
    expect(options).not.toContain("osc");
    expect(options).not.toContain("map");
    expect(completionsAt("ao.map('ba|', 0, 1)")).toContain("bass");
  });

  it("offers every name each helper accepts, and only those", () => {
    expect(completionsAt('ao.map("|")')).not.toContain("bpm");
    expect(completionsAt('ao.fit("|", 80, 160)')).toEqual(expect.arrayContaining(["bass", "bpm", "key"]));
    expect(completionsAt('ao.glide("|")')).toEqual(expect.arrayContaining(["bass", "bpm"]));
    expect(completionsAt('ao.glide("|")')).not.toContain("key");
    for (const helper of ["map", "fit", "glide"] as const) {
      for (const name of completionsAt(`ao.${helper}("|")`)!) expect(typeof ao[name as keyof typeof ao], name).toBe("number");
    }
  });

  it("offers quoted names first on opening the call or typing the argument", () => {
    const state = EditorState.create({ doc: "ao.map()", selection: { anchor: 7 }, extensions: [javascript()] });
    const options = hydraCompletions(new CompletionContext(state, 7, false))!.options;
    expect(options[0]).toMatchObject({ label: "loudness", displayLabel: '"loudness"', apply: '"loudness"' });
    expect(completionsAt("ao.map(ba|, 0, 1)")?.slice(0, 20)).toContain("bass");
    expect(completionsAt("ao.map(o|")).toEqual(expect.arrayContaining(["osc"]));
  });

  it("stays out of other arguments, other calls, and expressions inside the argument", () => {
    expect(completionsAt('ao.map("bass", "|")')).toBeNull();
    expect(completionsAt('use("|")')).not.toContain("bass");
    expect(completionsAt("ao.map(() => ao.b|)")).not.toContain('"bass"');
    expect(completionsAt("ao.map(() => ao.b|)")).toContain("beat");
    expect(completionsAt("ao.map(() => b|)") ?? []).not.toContain("bass");
    expect(completionsAt("ao.hz(|)")).toBeNull();
    expect(completionsAt("osc().map(|)")).toBeNull();
  });
});

describe("level names stay complete", () => {
  /** Numeric ao readings that aren't 0..1, so the helpers don't take them as levels, and why. */
  const notLevels: Record<string, string> = {
    time: "seconds since capture started",
    balance: "-1..1",
    key: "0..11; ao.fit takes it by name",
    bpm: "beats per minute; ao.fit and ao.glide take it by name",
    bar: "0..3",
  };

  it("takes every numeric ao reading as a level, or says why not", () => {
    const readings = publicAoMembers(ao).filter(({ name, method }) => !method && typeof ao[name as keyof typeof ao] === "number");
    const unclassified = readings.map(({ name }) => name).filter((name) => !(levels as readonly string[]).includes(name) && !(name in notLevels));
    expect(unclassified, "add each to levels in audio.ts, or to notLevels here with a reason").toEqual([]);
    for (const name of Object.keys(notLevels)) expect(levels, name).not.toContain(name);
  });

  it("lists level names for exactly the ao helpers that take a level", () => {
    const takesLevel = Object.entries(aoDocs).filter(([, doc]) => /^ao\.\w+\(level\b/.test(doc.signature)).map(([name]) => name);
    expect(Object.keys(levelArguments).sort()).toEqual(takesLevel.sort());
  });

  it("offers each level name with its ao reading's description", () => {
    for (const [helper, names] of Object.entries(levelArguments)) {
      const state = EditorState.create({ doc: `ao.${helper}("")`, extensions: [javascript()] });
      const pos = helper.length + 5;
      const options = hydraCompletions(new CompletionContext(state, pos, false))!.options;
      expect(labels(options), helper).toEqual([...names]);
      for (const option of options) {
        expect(publicAoMembers(ao).map((m) => m.name), option.label).toContain(option.label);
        expect(option.info, `${helper}: ${option.label}`).toBe(aoDocs[option.label].description);
      }
    }
  });
});
