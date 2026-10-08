import { describe, expect, it } from "vitest";
import { Engine } from "../src/main/listen";

describe("listen binding", () => {
  it("reuses its output buffers, so a push does not allocate a new array", () => {
    const engine = new Engine(48000);
    const chunk = new Float32Array(960 * 2);
    engine.push(chunk);
    const spectrum = engine.native.spectrum;
    const wave = engine.native.wave;
    const chroma = engine.native.chroma;
    const scalars = engine.native.scalars;
    for (let i = 0; i < 50; i++) engine.push(chunk);
    expect(engine.native.spectrum).toBe(spectrum);
    expect(engine.native.wave).toBe(wave);
    expect(engine.native.chroma).toBe(chroma);
    expect(engine.native.scalars).toBe(scalars);
  });
});
