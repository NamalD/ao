import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { describe, expect, it } from "vitest";
import { ao, aoDocs } from "../src/renderer/audio";
import {
  aoMemberDocs, chainMethods, functionDoc, generators, hydraDocs, memberCompletions,
  publicAoMembers, topLevelCompletions,
} from "../src/renderer/editor";

const labels = (options: { label: string }[]) => options.map((option) => option.label);

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
    expect(labels(memberCompletions(undefined))).toContain("modulateHue");
  });

  it("offers every HydraSource method plus initScene after s0.", () => {
    const options = labels(memberCompletions("s0"));
    expect(options).toEqual(expect.arrayContaining(["init", "initImage", "initVideo", "initCam", "initScreen", "clear", "initScene"]));
    expect(options).not.toContain("tick");
    expect(options).not.toContain("constructor");
    for (const name of options) expect(functionDoc(name, "s0")?.description, name).toBeTruthy();
  });

  it("offers Hydra's globals at the top level with real descriptions", () => {
    const options = topLevelCompletions();
    for (const name of ["o0", "o3", "s1", "render", "hush", "setFunction", "speed", "bpm", "time", "mouse", "width", "height", "update", "ao", "osc"]) {
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
