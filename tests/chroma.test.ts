import { describe, expect, it } from "vitest";
import { Analyser } from "../src/main/listen";
import { keyHue, PITCH_NAMES } from "../src/shared/chroma";
import type { AudioFeatures } from "../src/shared/features";

const RATE = 48000;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Feeds `chunks` of 20 ms, the way capture does, and returns the last features. */
function feed(signal: (t: number) => number, chunks = 10, analyser = new Analyser(RATE)): AudioFeatures {
  let features = analyser.push(new Float32Array(0), 0);
  for (let c = 0; c < chunks; c++) {
    const chunk = new Float32Array(960 * 2);
    for (let i = 0; i < 960; i++) {
      const x = signal((c * 960 + i) / RATE);
      chunk[2 * i] = chunk[2 * i + 1] = x;
    }
    features = analyser.push(chunk, (c + 1) * 0.02);
  }
  return features;
}

const sine = (freq: number, amp = 0.3) => (t: number) => amp * Math.sin(2 * Math.PI * freq * t);
/** A tone with a few decaying harmonics, closer to an instrument than a sine. */
const note = (midi: number) => (t: number) =>
  [1, 0.5, 0.33, 0.25].reduce((sum, a, h) => sum + 0.1 * a * Math.sin(2 * Math.PI * hz(midi) * (h + 1) * t), 0);

/** Pitch classes ordered from strongest to weakest, by name. */
const ranked = (f: AudioFeatures) => f.chroma.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => PITCH_NAMES[i]);

describe("chroma", () => {
  it("reads A440 as A", () => {
    const f = feed(sine(440));
    expect(ranked(f)[0]).toBe("A");
    expect(f.chroma[9]).toBeCloseTo(1, 5);
    expect(f.key).toBe(9);
    expect(Math.max(...f.chroma.filter((_, i) => i !== 9))).toBeLessThan(0.2);
  });

  it("names pure tones across the range", () => {
    for (const midi of [48, 50, 55, 61, 64, 70, 76, 83, 95]) {
      const f = feed(sine(hz(midi)));
      expect(f.key, `midi ${midi}`).toBe(midi % 12);
    }
  });

  it("puts a C major triad's C, E and G on top", () => {
    const chord = (t: number) => note(60)(t) + note(64)(t) + note(67)(t);
    const f = feed(chord);
    expect(ranked(f).slice(0, 3).sort()).toEqual(["C", "E", "G"]);
    expect(Math.min(f.chroma[0], f.chroma[4], f.chroma[7])).toBeGreaterThan(0.5);
    expect(Math.max(f.chroma[1], f.chroma[6], f.chroma[8])).toBeLessThan(0.25);
  });

  it("reads an A minor triad's A, C and E on top", () => {
    const f = feed((t) => note(57)(t) + note(60)(t) + note(64)(t));
    expect(ranked(f).slice(0, 3).sort()).toEqual(["A", "C", "E"]);
  });

  it("reads noise as flat-ish, with no clear winner", () => {
    let seed = 1;
    const noise = () => { seed = (seed * 16807) % 2147483647; return 0.3 * (seed / 1073741823.5 - 1); };
    const f = feed(noise, 40);
    expect(Math.min(...f.chroma)).toBeGreaterThan(0.45);
  });

  it("is silent for silence and ignores sound outside its range", () => {
    expect(feed(() => 0).chroma.every((v) => v === 0)).toBe(true);
    expect(Math.max(...feed(sine(50)).chroma)).toBe(0);
    expect(Math.max(...feed(sine(9000)).chroma)).toBe(0);
  });

  it("fades out the old note and keeps the key steady through near ties", () => {
    const analyser = new Analyser(RATE);
    let f = feed(sine(hz(69)), 20, analyser);
    expect(f.key).toBe(9);
    f = feed((t) => sine(hz(69))(t) + sine(hz(71), 0.28)(t), 20, analyser);
    expect(f.key).toBe(9);
    f = feed(sine(hz(62)), 1, analyser);
    expect(f.chroma[9]).toBeGreaterThan(0.5);
    f = feed(sine(hz(62)), 40, analyser);
    expect(f.chroma[9]).toBeLessThan(0.12);
    expect(f.key).toBe(2);
  });
});

describe("keyHue", () => {
  it("maps pitch classes onto 0..1 in twelfths", () => {
    expect(keyHue(0)).toBe(0);
    expect(keyHue(9)).toBe(0.75);
    expect(keyHue(12)).toBe(0);
    expect(keyHue(-1)).toBeCloseTo(11 / 12, 12);
  });
});

describe("Analyser chroma, balance and wave", () => {
  it("reports them with the other features", () => {
    const analyser = new Analyser(RATE);
    let f = analyser.push(new Float32Array(0), 0);
    for (let c = 0; c < 25; c++) {
      const chunk = new Float32Array(960 * 2);
      for (let i = 0; i < 960; i++) {
        const x = sine(440)((c * 960 + i) / RATE);
        chunk[2 * i] = 0.5 * x;
        chunk[2 * i + 1] = x;
      }
      f = analyser.push(chunk, (c + 1) * 0.02);
    }
    expect(f.key).toBe(9);
    expect(f.chroma).toHaveLength(12);
    expect(f.balance).toBeCloseTo(1 / 3, 1);
    expect(f.width).toBeCloseTo(1 / 3, 1);
    expect(f.wave).toBeInstanceOf(Float32Array);
    expect(f.wave).toHaveLength(512);
    expect(Math.max(...f.wave)).toBeGreaterThan(0.2);
  });
});
