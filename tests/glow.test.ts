import GeneratorFactory from "hydra-synth/src/generator-factory.js";
import { describe, expect, it } from "vitest";
import { installChainExtras } from "../src/renderer/glow";

/** An output that keeps the shader passes it's asked to render. */
function output(label: string) {
  return {
    label, precision: "highp", uniforms: {},
    passes: [] as { frag: string; uniforms: Record<string, unknown> }[],
    render(passes: { frag: string; uniforms: Record<string, unknown> }[]) { this.passes = passes; },
    getTexture: () => `${label} texture`,
  };
}

/** A real hydra-synth chain factory with glow and diffuse installed, on a 2:1 canvas. */
function deck() {
  const o0 = output("o0");
  const o1 = output("o1");
  const factory = new GeneratorFactory({ defaultOutput: o0, defaultUniforms: {} });
  installChainExtras(factory.sourceClass.prototype, () => ({ width: 200, height: 100 }));
  const { osc, noise } = factory.generators;
  return { osc, noise, o0, o1 };
}

/** How often `name` is called in the shader's main, past the function definitions. */
const calls = (frag: string, name: string) => frag.slice(frag.indexOf("void main")).split(`${name}(`).length - 1;

describe("glow", () => {
  it("adds twelve scrolled copies of the chain so far", () => {
    const { osc, o0 } = deck();
    osc(10).kaleid().glow().out(o0);
    const [pass] = o0.passes;
    expect(calls(pass.frag, "osc")).toBe(13);
    expect(calls(pass.frag, "kaleid")).toBe(13);
    expect(calls(pass.frag, "scroll")).toBe(12);
    expect(calls(pass.frag, "add")).toBe(12);
  });

  it("keeps its ring round on a wide screen, and reads function arguments every frame", () => {
    const { osc, o0 } = deck();
    let radius = 0.1;
    osc().glow(2, () => radius).out(o0);
    const values = Object.values(o0.passes[0].uniforms).filter((v) => typeof v === "function")
      .map((v) => (v as (context: object, props: object) => number)({}, {}));
    // The outer ring's first sample: half of the radius across on a 2:1 screen, none up.
    expect(values).toEqual(expect.arrayContaining([0.05, 0, 2 / 12]));
    radius = 0.2;
    const again = Object.values(o0.passes[0].uniforms).filter((v) => typeof v === "function")
      .map((v) => (v as (context: object, props: object) => number)({}, {}));
    expect(again).toContain(0.1);
  });
});

describe("diffuse", () => {
  it("blends with the previous frame of the output the chain is drawn to", () => {
    const { osc, o0, o1 } = deck();
    osc().diffuse(0.9).out(o1);
    const { frag, uniforms } = o1.passes[0];
    expect(calls(frag, "blend")).toBe(1);
    expect(calls(frag, "noise")).toBe(1);
    const textures = Object.values(uniforms).filter((v) => typeof v === "function")
      .map((v) => (v as () => unknown)());
    expect(textures).toContain("o1 texture");
    expect(textures).not.toContain("o0 texture");
  });

  it("feeds back from the default output when out() is given none", () => {
    const { osc, o0 } = deck();
    osc().diffuse().out();
    const textures = Object.values(o0.passes[0].uniforms).filter((v) => typeof v === "function")
      .map((v) => (v as () => unknown)());
    expect(textures).toContain("o0 texture");
  });

  it("resolves inside chains passed as arguments, without changing the chain itself", () => {
    const { osc, noise, o0, o1 } = deck();
    const trails = noise().diffuse();
    const chain = osc().add(trails);
    chain.out(o1);
    expect(calls(o1.passes[0].frag, "blend")).toBe(1);
    // The same chain can go to another output, and feeds back from that one.
    chain.out(o0);
    const textures = Object.values(o0.passes[0].uniforms).filter((v) => typeof v === "function")
      .map((v) => (v as () => unknown)());
    expect(textures).toContain("o0 texture");
    expect(textures).not.toContain("o1 texture");
    expect(trails.transforms.at(-1).name).toBe("ao-diffuse");
  });

  it("blends once after glow, over the glowing chain", () => {
    const { osc, o0 } = deck();
    osc().glow().diffuse().out(o0);
    const { frag } = o0.passes[0];
    expect(calls(frag, "blend")).toBe(1);
    expect(calls(frag, "osc")).toBe(13);
  });

  it("leaves chains without diffuse as they were", () => {
    const { osc, o0 } = deck();
    const chain = osc().rotate();
    chain.out(o0);
    expect(calls(o0.passes[0].frag, "rotate")).toBe(1);
    expect(o0.passes[0].frag).not.toContain("blend(");
  });
});
