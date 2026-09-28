import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ao } from "../src/renderer/audio";
// Imported before the browser stubs below, which CodeMirror (via the editor's docs) would trip over.
import { buildEntries } from "../src/renderer/explorer/entries";

/**
 * Runs every bundled sketch the way Ao does: evaluated by a real Deck, in
 * its scope, against a stand-in Hydra with the real function names. Then it
 * calls what the sketch left to run later (update, Hydra argument functions,
 * scene uniforms), since a name the sketch can't reach, such as `sphere`
 * missing from the deck's scope, may only fail there.
 */

/** Functions a sketch handed over to be called later; each deck's run adds to it. */
const later = vi.hoisted(() => [] as { what: string; run: () => unknown }[]);
/** Scenes loaded by `initScene`, by the source they were loaded into. */
const loaded = vi.hoisted(() => [] as { source: unknown; code: string }[]);

vi.mock("hydra-synth", async () => {
  const { default: hydraFunctions } = await import("hydra-synth/src/glsl/glsl-functions.js");
  const deferArgs = (what: string, args: unknown[]) => {
    for (const arg of args) if (typeof arg === "function") later.push({ what, run: arg as () => unknown });
  };
  // A Hydra chain: every method, including ones setFunction adds, chains on.
  // Its constructor's prototype stands in for GlslSource's, which arithmetics patches.
  class Chain {}
  const chain = (what: string): unknown => new Proxy(new Chain(), {
    get: (_, key) => key === "constructor" ? Chain : typeof key !== "string" || key === "then" ? undefined : (...args: unknown[]) => {
      deferArgs(`${what}.${key}`, args);
      return chain(`${what}.${key}`);
    },
  });
  const generator = (name: string) => (...args: unknown[]) => {
    deferArgs(name, args);
    return chain(name);
  };
  // Enough WebGL and regl for the vendored extensions `use` loads, as in extensions.test.ts.
  const gl = {
    NEAREST: 9728, LINEAR: 9729, REPEAT: 10497, CLAMP_TO_EDGE: 33071, MIRRORED_REPEAT: 33648,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
    FRAMEBUFFER: 36160, FRAMEBUFFER_BINDING: 36006, TEXTURE_BINDING_2D: 32873, TEXTURE_2D: 3553,
    COLOR_ATTACHMENT0: 36064, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: 36049, COLOR_BUFFER_BIT: 16384,
    getParameter: () => null, bindFramebuffer() {}, getFramebufferAttachmentParameter: () => ({}),
    bindTexture() {}, texParameteri() {}, clearColor() {}, clear() {},
  };
  // Callable, with framebuffers and textures, for hydra-outputs' setBufferCount.
  const regl = Object.assign(() => () => {}, { _gl: gl, framebuffer: () => ({ destroy() {} }), texture: () => ({}) });
  class FakeOutput {
    regl = regl;
    fbos = [0, 1].map(() => ({ _framebuffer: { framebuffer: {} }, color: [{}], width: 4, height: 4 }));
    constructor(readonly label: string) {}
  }
  class FakeSource {
    regl = regl;
    constructor(readonly label: string) {}
    init() {}
    initImage() {}
    initVideo() {}
    initCam() {}
    clear() {}
  }
  return {
    default: class FakeHydra {
      regl = regl;
      sandbox = { makeGlobal: false };
      o = [0, 1, 2, 3].map((i) => new FakeOutput(`o${i}`));
      s = [0, 1, 2, 3].map((i) => new FakeSource(`s${i}`));
      width = 640;
      height = 360;
      loadScript = async () => {};
      synth: Record<string, unknown> = {
        time: 0, bpm: 30, width: 640, height: 360, fps: undefined, stats: { fps: 0 }, speed: 1,
        mouse: { x: 0, y: 0 }, render() {}, setResolution() {}, update: () => {}, afterUpdate: () => {},
        hush() {}, tick() {},
        setFunction: ({ name, type }: { name: string; type: string }) => {
          if (type === "src") this.synth[name] = generator(name);
          else (Chain.prototype as Record<string, unknown>)[name] = function (...args: unknown[]) {
            deferArgs(name, args);
            return chain(name);
          };
        },
      };

      constructor() {
        for (const fn of hydraFunctions()) if (fn.type === "src") this.synth[fn.name] = generator(fn.name);
        this.o.forEach((output, i) => { this.synth[`o${i}`] = output; });
        this.s.forEach((source, i) => { this.synth[`s${i}`] = source; });
      }
    },
  };
});

vi.mock("../src/renderer/scenes", () => ({
  Scene: class {
    canvas = {};
    load(code: string, options?: { uniforms?: Record<string, unknown> }) {
      loaded.push({ source: this, code });
      for (const [name, value] of Object.entries(options?.uniforms ?? {})) {
        if (typeof value === "function") later.push({ what: `uniform ${name}`, run: value as () => unknown });
      }
    }
  },
}));

// The little of the browser a Deck and the bundled sketches touch.
vi.stubGlobal("window", globalThis);
// A 2D context where every call succeeds, for extensions that draw textures (gradientmap).
const context2d: object = new Proxy({}, { get: (_, key) => (key === "then" ? undefined : () => context2d) });
vi.stubGlobal("document", {
  createElement: () => ({ style: {}, width: 1, height: 1, getContext: (type: string) => (type === "2d" ? context2d : null) }),
});
vi.stubGlobal("innerWidth", 640);
vi.stubGlobal("innerHeight", 360);
vi.stubGlobal("devicePixelRatio", 1);
vi.stubGlobal("ao", ao);

const { Deck } = await import("../src/renderer/deck");

const sketches = readdirSync("sketches").filter((file) => file.endsWith(".js") && !file.startsWith("challenge-"));
let globalsBefore: Set<string>;
beforeAll(() => { globalsBefore = new Set(Object.keys(globalThis)); });
afterEach(() => {
  later.length = 0;
  loaded.length = 0;
  // Sketches share state through globals such as `heat`; don't let one sketch lean on another's.
  for (const key of Object.keys(globalThis)) if (!globalsBefore.has(key)) delete (globalThis as Record<string, unknown>)[key];
});

/** Runs a sketch on a fresh deck and a few frames of what it left behind, returning the errors. */
async function runSketch(code: string): Promise<string[]> {
  later.length = 0;
  const deck = new Deck(640, 360, "test deck", () => {});
  const errors: string[] = [];
  try {
    await deck.evaluate(code);
  } catch (e) {
    return [`running: ${e instanceof Error ? e.message : String(e)}`];
  }
  for (let frame = 0; frame < 3; frame++) {
    for (const name of ["update", "afterUpdate"]) {
      try {
        (deck.synth[name] as (dt: number) => void)(16);
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const { what, run } of later) {
      try {
        run();
      } catch (e) {
        errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return [...new Set(errors)];
}

describe("bundled sketches", () => {
  // Sketches are live-coded and committed as they are, so only `make check-sketches` holds them to this.
  it.runIf(process.env.AO_CHECK_SKETCHES).each(sketches)("%s runs on a deck without undefined names", async (file) => {
    const errors = await runSketch(readFileSync(`sketches/${file}`, "utf8"));
    expect(errors, file).toEqual([]);
  });

  it("catches a sketch that uses a name no deck provides", async () => {
    expect(await runSketch("cube(1).out()")).toEqual(["running: cube is not defined"]);
    expect(await runSketch("osc(10, 0.1, () => missing).out()")).toEqual(["osc: missing is not defined"]);
    expect(await runSketch("update = () => { wobble += 1 }")).toEqual(["update: wobble is not defined"]);
  });
});

describe("explorer extension examples", () => {
  // The explorer plays examples on the current deck (main.ts), so their `use` lines load there.
  const examples = buildEntries().filter((e) => e.id.startsWith("ext:"));

  it.each(examples.map((e) => [e.id, e.example]))("%s runs on a deck without undefined names", async (_id, code) => {
    expect(await runSketch(code)).toEqual([]);
  });

  it("would catch an example missing its use line", async () => {
    expect(await runSketch("blinking(8).out()")).toEqual(["running: blinking is not defined"]);
  });
});

describe("solids on a deck", () => {
  // Regression: urchin.js reported `sphere is not defined`.
  it("reach a sketch through the deck's scope and render into that deck's s0", async () => {
    const deck = new Deck(640, 360, "test deck", () => {});
    const other = new Deck(640, 360, "other deck", () => {});
    await deck.evaluate("sphere(1).spikes(() => ao.impulse).out()");
    await other.evaluate("torus().out(s1)");
    expect(loaded).toHaveLength(2);
    expect(loaded[0].code).toContain("length(p) - sphere_radius");
    expect(loaded[1].code).toContain("torus_thickness");
    expect(loaded[0].source).not.toBe(loaded[1].source);
  });
});
