import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import arrayUtils from "hydra-synth/src/lib/array-utils.js";
import { ao, aoDocs } from "../src/renderer/audio";
import { clock, installHydraTempo, releaseHydraBpm, syncHydraBpm } from "../src/renderer/tempo";

let now = 0;
const hydraGlobals = { bpm: 30 };

beforeAll(() => {
  vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
  vi.stubGlobal("window", hydraGlobals);
  arrayUtils.init();
  installHydraTempo();
});
afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const at = (seconds: number) => { now = seconds; };

describe("tempo in the renderer", () => {
  it("drives Hydra's bpm from the start, before any tempo is detected", () => {
    at(1);
    expect(ao.tempoConfidence).toBe(0);
    syncHydraBpm();
    expect(hydraGlobals.bpm).toBe(ao.bpm);
    expect(hydraGlobals.bpm).toBe(120);
  });

  it("exposes the beat clock through ao", () => {
    // Tap 120 bpm starting on the one at t = 10.
    for (const t of [10, 10.5, 11]) { at(t); clock.tap(t); }
    at(11.125);
    expect(ao.bpm).toBeCloseTo(120, 9);
    expect(ao.phase).toBeCloseTo(0.25, 9);
    expect(ao.bar).toBe(2);
    expect(ao.tempoConfidence).toBe(1);
    expect(ao.ramp(4)).toBeCloseTo(2.25 / 4, 9);
    expect(ao.ramp()).toBeCloseTo(0.25, 9);
    expect(ao.pulse()).toBeCloseTo(0.75 ** 4, 9);
    expect(ao.pulse(2)).toBeCloseTo(0.5 ** 4, 9);
    expect(ao.ramp(0)).toBe(0);
    expect(ao.pulse(-1)).toBe(0);
  });

  it("documents the tempo members apart from ao.beat", () => {
    for (const name of ["bpm", "phase", "bar", "tempoConfidence", "ramp", "pulse"]) expect(aoDocs[name]).toBeDefined();
    expect(aoDocs.phase.description).toMatch(/ao\.beat/);
  });

  it("drives Hydra's bpm and steps array sequences on Ao's beats", () => {
    const steps = [1, 2, 3, 4];
    at(11.1);
    syncHydraBpm();
    expect(hydraGlobals.bpm).toBe(120);
    // Beat 2.2 of the bar, whatever Hydra's time says.
    expect(arrayUtils.getValue(steps)({ time: 999, bpm: 120 })).toBe(3);
    const fast = (steps as unknown as { fast(speed: number): number[] }).fast.call([1, 2, 3, 4], 2);
    expect(arrayUtils.getValue(fast)({ time: 999, bpm: 120 })).toBe(1); // index 4.4
  });

  it("leaves bpm and arrays alone once a sketch sets bpm, until a whole run", () => {
    hydraGlobals.bpm = 60;
    syncHydraBpm();
    expect(hydraGlobals.bpm).toBe(60);
    expect(arrayUtils.getValue([1, 2, 3, 4])({ time: 999, bpm: 60 })).toBe(4); // 999 % 4
    releaseHydraBpm();
    syncHydraBpm();
    expect(hydraGlobals.bpm).toBe(120);
  });
});
