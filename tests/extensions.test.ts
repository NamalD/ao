import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundledFiles, CATALOG, ExtensionLoader, extensions, resolveExtension, sharedPrototypes,
} from "../src/renderer/extensions";
import { evaluateInScope, sketchScope } from "../src/renderer/scope";

type Bag = Record<string, unknown>;

// Stand-ins for hydra-synth's module-level classes, which every deck shares.
class FakeOutput {
  fbos = [0, 1].map(() => ({ _framebuffer: { framebuffer: {} }, width: 4, height: 4 }));
  constructor(readonly regl: unknown) {}
}
class FakeSource {
  tex: { destroyed: boolean; destroy(): void } | undefined;
  readonly regl: unknown;
  constructor(readonly options: Bag) {
    this.regl = options.regl;
  }
  init() {
    const tex = { destroyed: false, destroy: () => { tex.destroyed = true; } };
    this.tex = tex;
  }
}
class FakeGlslSource {
  constructor(readonly name: string) {}
}

const GL = {
  NEAREST: 9728, LINEAR: 9729, REPEAT: 10497, CLAMP_TO_EDGE: 33071, MIRRORED_REPEAT: 33648,
  TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
  FRAMEBUFFER: 36160, FRAMEBUFFER_BINDING: 36006, TEXTURE_BINDING_2D: 32873, TEXTURE_2D: 3553,
  COLOR_ATTACHMENT0: 36064, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: 36049, COLOR_BUFFER_BIT: 16384,
};

/** A deck as the loader sees it: a Hydra instance, its synth, and its sketch scope. */
function fakeDeck(label: string) {
  const glCalls: string[] = [];
  const gl = {
    ...GL,
    getParameter: () => null,
    bindFramebuffer: () => {},
    getFramebufferAttachmentParameter: () => ({}),
    bindTexture: () => {},
    texParameteri: (_target: number, name: number, value: number) => glCalls.push(`${name}=${value}`),
    clearColor: () => {},
    clear: () => glCalls.push("clear"),
  };
  const regl = { _gl: gl };
  // hydra-synth gives each instance its own GlslSource subclass for chain methods.
  const SourceClass = class extends FakeGlslSource {};
  const definitions: { name: string; type: string }[] = [];
  const synth: Bag = {
    time: 0,
    setFunction: (def: { name: string; type: string }) => {
      definitions.push({ name: def.name, type: def.type });
      if (def.type === "src") synth[def.name] = () => new SourceClass(def.name);
      else (SourceClass.prototype as unknown as Bag)[def.name] = function (this: unknown) { return this; };
    },
    osc: () => new SourceClass("osc"),
  };
  const o = [0, 1, 2, 3].map(() => new FakeOutput(regl));
  const s = [0, 1, 2, 3].map(() => new FakeSource({ regl }));
  o.forEach((output, i) => { synth[`o${i}`] = output; });
  s.forEach((source, i) => { synth[`s${i}`] = source; });
  const hydra = { label, regl, sandbox: { makeGlobal: false }, synth, o, s };
  const extras: Bag = {};
  const scope = sketchScope(synth, extras);
  const loader = new ExtensionLoader({ hydra, synth, scope, shared: sharedPrototypes(hydra, synth) });
  extras.use = loader.use;
  return { hydra, synth, scope, loader, definitions, glCalls, SourceClass };
}

const g = globalThis as Bag;
afterEach(() => { delete g.document; });

describe("resolveExtension", () => {
  it("takes short names and the vendored file names, with or without .js", () => {
    expect(resolveExtension("noise").file).toBe("lib-noise.js");
    expect(resolveExtension("lib-noise").name).toBe("noise");
    expect(resolveExtension("lib-softpattern.js").name).toBe("softpattern");
    expect(resolveExtension("hydra-fractals").name).toBe("fractals");
    expect(resolveExtension("hydra-outputs.js").name).toBe("outputs");
    expect(CATALOG.map((ext) => ext.name)).toEqual(["noise", "softpattern", "fractals", "outputs", "gradientmap", "arithmetics"]);
  });

  it("rejects anything else, listing what is available", () => {
    const available = "available: noise, softpattern, fractals, outputs, gradientmap, arithmetics";
    expect(() => resolveExtension("hydra-text")).toThrow(`use: unknown extension "hydra-text"; ${available}`);
    expect(() => resolveExtension("register-midi")).toThrow(available);
    expect(() => resolveExtension("../lib-noise")).toThrow(available);
    expect(() => resolveExtension("https://example.com/x.js")).toThrow(available);
    expect(() => resolveExtension(undefined)).toThrow(available);
  });

  it("allows exactly the bundled files", () => {
    expect(bundledFiles().sort()).toEqual(CATALOG.map((ext) => ext.file).sort());
    for (const ext of extensions()) expect(ext.source.length, ext.name).toBeGreaterThan(100);
  });

  it("bundles the vendored files unchanged, with the hashes SOURCES.md records", () => {
    const sources = readFileSync(new URL("../src/renderer/vendor/hydra/SOURCES.md", import.meta.url), "utf8");
    for (const ext of extensions()) {
      const onDisk = readFileSync(new URL(`../src/renderer/vendor/hydra/${ext.file}`, import.meta.url));
      expect(ext.source, ext.name).toBe(onDisk.toString("utf8"));
      const row = sources.split("\n").find((line) => line.startsWith(`| \`${ext.file}\``));
      expect(row, ext.file).toContain(`| \`${ext.name}\` |`);
      expect(row, ext.file).toContain(createHash("sha256").update(onDisk).digest("hex"));
    }
  });
});

describe("use", () => {
  it("loads into the deck whose scope runs it, once per deck", async () => {
    const a = fakeDeck("a"), b = fakeDeck("b");
    await evaluateInScope('await use("noise")', a.scope);
    const count = a.definitions.length;
    expect(count).toBe(8);
    expect(await evaluateInScope("return whitenoise().name", a.scope)).toBe("whitenoise");
    // Again on the same deck, under either name: nothing more is defined.
    await evaluateInScope('await use("noise", "lib-noise.js")', a.scope);
    expect(a.definitions.length).toBe(count);
    expect(a.loader.names).toEqual(["noise"]);
    // The other deck hasn't got it until it asks.
    expect(b.synth.whitenoise).toBeUndefined();
    await evaluateInScope('await use("lib-noise")', b.scope);
    expect(b.definitions.length).toBe(count);
    expect(b.synth.whitenoise).not.toBe(a.synth.whitenoise);
  });

  it("throws on an unknown name before loading anything", async () => {
    const a = fakeDeck("a");
    await expect(evaluateInScope('await use("fractals", "nope")', a.scope)).rejects.toThrow('unknown extension "nope"');
    expect(a.definitions).toEqual([]);
    expect(a.loader.names).toEqual([]);
  });

  it("finds this deck's Hydra for hyper-hydra's files and leaves no globals behind", async () => {
    const a = fakeDeck("a"), b = fakeDeck("b");
    await a.loader.use("fractals");
    expect(a.definitions.map((d) => d.name)).toEqual(["mirrorX", "mirrorY", "mirrorX2", "mirrorY2", "mirrorWrap", "inversion"]);
    expect(b.definitions).toEqual([]);
    for (const name of ["_hydra", "_hydraScope", "hydraSynth"]) expect(g[name], name).toBeUndefined();
  });

  it("patches chain methods on this deck's GlslSource subclass only", async () => {
    const a = fakeDeck("a"), b = fakeDeck("b");
    await a.loader.use("arithmetics");
    const proto = a.SourceClass.prototype as unknown as Bag;
    expect(typeof proto.sin).toBe("function");
    expect(typeof proto.add).toBe("function");
    expect((b.SourceClass.prototype as unknown as Bag).sin).toBeUndefined();
    expect(Object.getOwnPropertyNames(FakeGlslSource.prototype)).toEqual(["constructor"]);
  });

  it("keeps hydra-outputs off the shared Output prototype, each deck on its own WebGL context", async () => {
    const a = fakeDeck("a"), b = fakeDeck("b");
    await a.loader.use("outputs");
    await b.loader.use("outputs");
    expect(Object.getOwnPropertyNames(FakeOutput.prototype)).toEqual(["constructor"]);
    const [a1] = a.hydra.o.slice(1) as unknown as { setLinear(): void }[];
    a.glCalls.length = b.glCalls.length = 0;
    a1.setLinear();
    const linear = [`${GL.TEXTURE_MIN_FILTER}=${GL.LINEAR}`, `${GL.TEXTURE_MAG_FILTER}=${GL.LINEAR}`];
    expect(a.glCalls.sort()).toEqual([...linear, ...linear].sort()); // both framebuffers of o1
    expect(b.glCalls).toEqual([]);
    // oS addresses this deck's outputs.
    expect((a.synth.oS as { outputs: unknown }).outputs).toBe(a.hydra.o);
    expect((b.synth.oS as { outputs: unknown }).outputs).toBe(b.hydra.o);
  });

  it("puts output settings back to Hydra's defaults on reset", async () => {
    const a = fakeDeck("a");
    a.loader.reset(); // nothing loaded: nothing to do
    expect(a.glCalls).toEqual([]);
    await a.loader.use("outputs");
    a.loader.reset();
    // Per output, both framebuffers: nearest filtering, then clamped wrapping.
    const perFbo = [`${GL.TEXTURE_MIN_FILTER}=${GL.NEAREST}`, `${GL.TEXTURE_MAG_FILTER}=${GL.NEAREST}`];
    expect(a.glCalls.filter((c) => perFbo.includes(c))).toHaveLength(4 * 2 * 2);
    expect(a.glCalls.filter((c) => c === `${GL.TEXTURE_WRAP_S}=${GL.CLAMP_TO_EDGE}`)).toHaveLength(4 * 2);
  });

  it("gives gradient maps the deck's o0 and frees their textures on reset", async () => {
    const a = fakeDeck("a"), b = fakeDeck("b");
    await a.loader.use("gradientmap");
    expect(typeof a.synth.createGradient).toBe("function");
    expect(b.synth.createGradient).toBeUndefined();
    expect(g.createGradient).toBeUndefined();
    const context = { createLinearGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, fillStyle: "" };
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
    const gradient = await evaluateInScope("return createGradient([1, 0, 0], 'blue')", a.scope) as FakeSource;
    expect(gradient).toBeInstanceOf(FakeSource);
    expect(gradient.options.regl).toBe(a.hydra.regl);
    a.loader.reset();
    expect(gradient.tex?.destroyed).toBe(true);
  });
});

/** Everything one extension defines on a fresh deck: synth names, chain methods, output methods. */
async function definedNames(name: string): Promise<Set<string>> {
  const deck = fakeDeck(name);
  const keys = () => [
    ...Object.keys(deck.synth),
    ...Object.getOwnPropertyNames(deck.SourceClass.prototype),
    ...deck.hydra.o.flatMap((o) => Object.keys(o)),
  ];
  const before = new Set(keys());
  await deck.loader.use(name);
  return new Set([...keys(), ...deck.definitions.map((d) => d.name)].filter((key) => !before.has(key)));
}

const hydraFile = (path: string) => readFileSync(new URL(`../node_modules/hydra-synth/src/${path}`, import.meta.url), "utf8");

/** hydra-synth's own names: GLSL functions and helpers, synth globals, Output and GlslSource methods. */
function builtins(): Set<string> {
  return new Set([
    ...hydraFunctions().map((fn) => fn.name),
    ...[...hydraFile("glsl/utility-functions.js").matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]),
    ...[...hydraFile("output.js").matchAll(/Output\.prototype\.(\w+)/g)].map((m) => m[1]),
    ...[...hydraFile("glsl-source.js").matchAll(/GlslSource\.prototype\.(\w+)/g)].map((m) => m[1]),
    "time", "bpm", "width", "height", "fps", "stats", "speed", "mouse", "render", "setResolution", "update",
    "afterUpdate", "hush", "tick", "setFunction", "screencap", "vidRecorder", "loadScript",
    "o0", "o1", "o2", "o3", "s0", "s1", "s2", "s3", "fbos", "regl", "draw", "uniforms",
  ]);
}

describe("vendored extensions' names", () => {
  // hydra-arithmetics wraps these to also take numbers (`.add(0.1)`); given a
  // texture they call its own copies of Hydra's GLSL, which compute the same.
  const WRAPPED: Record<string, string[]> = { arithmetics: ["add", "mult", "sub"] };

  it("never collide between extensions", async () => {
    const seen = new Map<string, string>();
    for (const ext of CATALOG) {
      for (const name of await definedNames(ext.name)) {
        expect(seen.get(name), `${ext.name} redefines ${name}`).toBeUndefined();
        seen.set(name, ext.name);
      }
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it("never redefine a hydra-synth built-in, beyond arithmetics' documented wrappers", async () => {
    const hydra = builtins();
    expect(hydra.has("osc") && hydra.has("_noise") && hydra.has("getTexture")).toBe(true);
    for (const ext of CATALOG) {
      const clashes = [...await definedNames(ext.name)].filter((name) => hydra.has(name));
      expect(clashes.sort(), ext.name).toEqual(WRAPPED[ext.name] ?? []);
    }
  });

  it("know which GLSL function names clash with GLSL built-ins (they don't compile)", async () => {
    const glsl = new Set(("radians degrees sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil "
      + "fract mod min max clamp mix step smoothstep length distance dot cross normalize faceforward reflect refract "
      + "matrixCompMult lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture2D textureCube").split(" "));
    const clashes: string[] = [];
    for (const ext of CATALOG) {
      const deck = fakeDeck(ext.name);
      await deck.loader.use(ext.name);
      clashes.push(...deck.definitions.map((d) => d.name).filter((name) => glsl.has(name)));
    }
    // hydra-arithmetics' length() and distance(): upstream, documented in the README.
    expect(clashes.sort()).toEqual(["distance", "length"]);
  });
});
