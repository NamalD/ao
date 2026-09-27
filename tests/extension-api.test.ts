import { describe, expect, it } from "vitest";
import {
  addUse, docsDrift, extensionApi, extensionDocs, extensionGroups, recorded, recordExtension, usedExtensions,
} from "../src/renderer/extension-api";
import { CATALOG } from "../src/renderer/extensions";

const namesOf = (extension: string) => extensionApi().filter((fn) => fn.extension === extension).map((fn) => fn.name);

describe("recording what an extension adds", () => {
  it("reads setFunction definitions from the vendored files, with their inputs and defaults", () => {
    const blinking = recorded("softpattern").functions.find((fn) => fn.name === "blinking");
    expect(blinking).toEqual({
      name: "blinking", type: "src",
      inputs: [
        { name: "tiles", type: "float", default: 5 }, { name: "scale", type: "float", default: 5 },
        { name: "speed", type: "float", default: 0.5 }, { name: "phase", type: "float", default: 0.03 },
      ],
    });
    // A default that is an output reads as its name.
    expect(recorded("gradientmap").functions.find((fn) => fn.name === "lookupX")?.inputs[0]).toMatchObject({ name: "_tex", default: "o0" });
  });

  it("finds names generated in loops, JS helpers, output methods and prototype patches", () => {
    const arithmetics = recorded("arithmetics");
    expect(arithmetics.functions.map((fn) => fn.name)).toEqual(expect.arrayContaining(["_sin", "_pow_single", "range", "lengthCenter"]));
    // sin is an alias of the _sin definition; pow is a wrapper around _pow and _pow_single.
    expect(arithmetics.chain.get("sin")?.name).toBe("_sin");
    expect(arithmetics.chain.get("clamp")?.name).toBe("_clamp");
    expect(arithmetics.chain.has("pow") && arithmetics.chain.get("pow")).toBe(undefined);
    expect(recorded("outputs").outputs).toEqual(expect.arrayContaining(["setLinear", "setNearest", "clear", "setFbos", "setBufferCount"]));
    expect(recorded("outputs").globals).toEqual(["oS"]);
    expect(recorded("gradientmap").globals.sort()).toEqual(["createGradient", "createLinearGradient"]);
  });

  it("leaves nothing behind on the real window", () => {
    for (const ext of CATALOG) recorded(ext.name);
    const g = globalThis as Record<string, unknown>;
    for (const name of ["createGradient", "oS", "_hydra", "_hydraScope", "blinking"]) expect(g[name], name).toBeUndefined();
  });
});

describe("extension docs", () => {
  it("document every name each vendored extension adds, and nothing else", () => {
    for (const ext of CATALOG) expect(docsDrift(ext.name), ext.name).toEqual({ undocumented: [], unknown: [] });
  });

  it("would catch a new upstream function, or docs for one that went away", () => {
    const rec = recordExtension(`setFunction({ name: "sparkle", type: "src", inputs: [], glsl: "" })`);
    expect(docsDrift("softpattern", rec)).toEqual({ undocumented: ["sparkle"], unknown: namesOf("softpattern") });
  });

  it("cover the names users reach for, skipping internal ones", () => {
    expect(namesOf("noise")).toEqual(["whitenoise", "colornoise", "unoise", "turb", "uturb", "warp", "cwarp", "ncontour"]);
    expect(namesOf("softpattern")).toEqual(["blinking", "blobs", "concentric", "phasenoise", "sdfmove", "smoothsun"]);
    expect(namesOf("fractals")).toEqual(["mirrorX", "mirrorY", "mirrorX2", "mirrorY2", "mirrorWrap", "inversion"]);
    expect(namesOf("outputs").sort()).toEqual(
      ["clear", "oS", "resetBuffers", "setBufferCount", "setClamp", "setFbos", "setLinear", "setMirror", "setNearest", "setRepeat"]);
    expect(namesOf("gradientmap").sort()).toEqual(["createGradient", "createLinearGradient", "lookupX", "lookupY"]);
    expect(namesOf("arithmetics")).toEqual(expect.arrayContaining([
      "abs", "sign", "fract", "sin", "cos", "tan", "asin", "acos", "atan", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt",
      "mod", "min", "max", "step", "pow", "div", "add", "sub", "mult", "amp", "amplitude", "offset", "off",
      "clamp", "bipolar", "unipolar", "range", "birange",
      "x", "y", "length", "distance", "xCenter", "yCenter", "lengthCenter", "distanceCenter",
    ]));
    expect(extensionApi().filter((fn) => fn.name.startsWith("_"))).toEqual([]);
  });

  it("describe every function and each of its parameters", () => {
    for (const fn of extensionApi()) {
      expect(fn.description, fn.name).toBeTruthy();
      for (const param of fn.params) expect(param.description, `${fn.name}(${param.name})`).toBeTruthy();
      expect(fn.signature, fn.name).toBeTruthy();
    }
  });

  it("derive signatures and kinds from the files", () => {
    const find = (name: string) => extensionApi().find((fn) => fn.name === name)!;
    expect(find("smoothsun")).toMatchObject({ kind: "generator", extension: "softpattern", signature: "smoothsun(threshold = 0.3, border = 0.2, speed = 1, ampscale = 0.5)" });
    expect(find("mirrorX")).toMatchObject({ kind: "method", type: "coord", signature: "mirrorX(pos = 0, coverage = 1)" });
    // Leading underscores are dropped from parameter names.
    expect(find("range").signature).toBe("range(min = 0, max = 1)");
    expect(find("lookupX").signature).toBe("lookupX(tex = o0, yOffset = 0, blending = 1)");
    expect(find("setLinear")).toMatchObject({ kind: "output", signature: "setLinear()" });
    expect(find("createGradient")).toMatchObject({ kind: "global", signature: "createGradient(...colors)" });
  });

  it("flag what is known to be broken upstream instead of hiding it", () => {
    const broken = extensionApi().filter((fn) => fn.broken).map((fn) => `${fn.extension}:${fn.name}`).sort();
    expect(broken).toEqual(["arithmetics:distance", "arithmetics:distanceCenter", "arithmetics:length", "outputs:setBufferCount", "outputs:setMirror", "outputs:setRepeat"]);
  });

  it("put every name in one of its extension's groups, and give every extension a group", () => {
    for (const fn of extensionApi()) {
      expect(extensionDocs[fn.extension].groups, fn.name).toContain(fn.group);
    }
    for (const ext of CATALOG) {
      expect(extensionGroups.filter((g) => g.extension === ext.name).map((g) => g.id)).toEqual(extensionDocs[ext.name].groups);
      expect(extensionDocs[ext.name].intro, ext.name).toBeTruthy();
    }
  });
});

describe("usedExtensions", () => {
  it("reads the names in use(...) calls, short or file names", () => {
    expect(usedExtensions('await use("noise", "hydra-fractals.js")\nosc().out()')).toEqual(new Set(["noise", "fractals"]));
    expect(usedExtensions("await use('lib-softpattern')")).toEqual(new Set(["softpattern"]));
    expect(usedExtensions('use("nope")\nblinking().out()')).toEqual(new Set());
    expect(usedExtensions("osc().out()")).toEqual(new Set());
  });
});

describe("addUse", () => {
  const apply = (code: string, name: string) => {
    const edit = addUse(code, name);
    return edit ? code.slice(0, edit.from) + edit.insert + code.slice(edit.from) : code;
  };

  it("joins the sketch's existing use call", () => {
    expect(apply('await use("noise")\n\nosc().out()', "fractals")).toBe('await use("noise", "fractals")\n\nosc().out()');
    expect(apply("await use()\n", "noise")).toBe('await use("noise")\n');
  });

  it("puts a use line after the opening comments, as a block of its own", () => {
    expect(apply("// Title\n// more\nosc().out()", "noise")).toBe('// Title\n// more\n\nawait use("noise")\n\nosc().out()');
    expect(apply("// Title\n\nosc().out()", "noise")).toBe('// Title\n\nawait use("noise")\n\nosc().out()');
    expect(apply("osc().out()", "noise")).toBe('await use("noise")\n\nosc().out()');
    expect(apply("", "noise")).toBe('await use("noise")\n');
  });

  it("does nothing when the sketch already loads it", () => {
    expect(addUse('await use("lib-noise")', "noise")).toBeNull();
  });
});
