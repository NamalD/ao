import { describe, expect, it } from "vitest";
import { aoHydraFunctions, installAudioSources, packHistory, packLevels, packWave } from "../src/renderer/audio-sources";
import { silentFeatures, SPECTRUM_BANDS, WAVE_SIZE } from "../src/shared/features";
import { SpectrumHistory } from "../src/renderer/spectrogram";

/** Decodes a sample as the waveform shader does: red is the high byte, green the low. */
const sample = (bytes: Uint8Array, i: number) => (bytes[4 * i] * 256 + bytes[4 * i + 1]) / 32767.5 - 1;

describe("packing audio into textures", () => {
  it("keeps the waveform to 16 bits, clamped to -1..1", () => {
    const out = packWave([-1, 0, 0.5, 1, 3, NaN], new Uint8Array(6 * 4));
    const decoded = [0, 1, 2, 3, 4, 5].map((i) => sample(out, i));
    expect(decoded[0]).toBeCloseTo(-1, 4);
    expect(decoded[1]).toBeCloseTo(0, 4);
    expect(decoded[2]).toBeCloseTo(0.5, 4);
    expect(decoded[3]).toBeCloseTo(1, 4);
    expect(decoded[4]).toBeCloseTo(1, 4);
    expect(decoded[5]).toBeCloseTo(0, 4);
  });

  it("stores levels as bytes, silence for anything that isn't one", () => {
    const out = packLevels([0, 0.5, 1, 2, -1, NaN], new Uint8Array(7 * 4));
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => out[4 * i])).toEqual([0, 128, 255, 255, 0, 0, 0]);
    expect(out[3]).toBe(255);
  });

  // Hydra's y runs down the screen, so the last row is at the bottom.
  it("puts the newest spectrum in the last row, older ones before it", () => {
    const history = new SpectrumHistory(2, 3, 10);
    history.push([0.2, 0.2], 0);
    history.push([1, 0.6], 0.1);
    const out = packHistory(history, new Uint8Array(2 * 3 * 4));
    const row = (age: number) => [out[8 * (2 - age)], out[8 * (2 - age) + 4]];
    expect(row(0)).toEqual([255, 153]);
    expect(row(1)).toEqual([51, 51]);
    expect(row(2)).toEqual([0, 0]); // not written yet
  });
});

describe("installing on a deck", () => {
  function install() {
    const defined: { name: string; type: string; inputs: { name: string }[] }[] = [];
    const uploads: { width: number; height: number }[] = [];
    const textures: object[] = [];
    const synth: Record<string, unknown> = {
      setFunction(definition: { name: string; type: string; inputs: { name: string }[] }) {
        defined.push(definition);
        synth[definition.name] = (...args: unknown[]) => ({ called: definition.name, args });
      },
    };
    const regl = {
      texture() {
        const texture = { subimage: (image: { width: number; height: number }) => uploads.push(image) };
        textures.push(texture);
        return texture;
      },
    };
    const update = installAudioSources(regl, synth);
    return { synth, defined, uploads, textures, update };
  }

  it("registers each audio source with a hidden texture argument first", () => {
    const { synth, defined, textures } = install();
    expect(defined.map((fn) => fn.name).sort()).toEqual(["_history", "_spectrum", "_waveform", "polar"]);
    expect(defined.find((fn) => fn.name === "_waveform")!.inputs.map((i) => i.name)).toEqual(["tex", "thickness", "gain"]);
    const call = (synth.waveform as (...a: unknown[]) => { called: string; args: [{ getTexture(): unknown }, ...unknown[]] })(0.02);
    expect(call.called).toBe("_waveform");
    expect(textures).toContain(call.args[0].getTexture());
    expect(call.args.slice(1)).toEqual([0.02]);
  });

  it("uploads the spectrum and waveform every frame, and the history when it changes", () => {
    const { update, uploads } = install();
    update(silentFeatures());
    update(silentFeatures());
    const sizes = uploads.map((u) => `${u.width}x${u.height}`);
    expect(sizes.filter((s) => s === `${SPECTRUM_BANDS}x1`)).toHaveLength(2);
    expect(sizes.filter((s) => s === `${WAVE_SIZE}x1`)).toHaveLength(2);
    expect(sizes.filter((s) => s === "64x256")).toHaveLength(1);
  });

  it("gives every function GLSL that returns what its type needs", () => {
    for (const fn of aoHydraFunctions) expect(fn.glsl, fn.name).toContain(fn.type === "src" ? "return vec4(" : "return vec2(");
  });
});
