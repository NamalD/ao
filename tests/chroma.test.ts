import { describe, expect, it } from "vitest";
import { Analyser, fft } from "../src/shared/analysis";
import { Chroma, keyHue, PITCH_NAMES } from "../src/shared/chroma";

const RATE = 48000;
const N = 2048;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Runs `frames` Hann-windowed FFT frames of a signal through a Chroma, 20 ms apart. */
function chromaOf(signal: (t: number) => number, frames = 10, chroma = new Chroma(RATE, N, 4 / N)): Chroma {
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = signal(f * 0.02 + i / RATE) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    chroma.update(re, im, 0.02);
  }
  return chroma;
}

const sine = (freq: number, amp = 0.3) => (t: number) => amp * Math.sin(2 * Math.PI * freq * t);
/** A tone with a few decaying harmonics, closer to an instrument than a sine. */
const note = (midi: number) => (t: number) =>
  [1, 0.5, 0.33, 0.25].reduce((sum, a, h) => sum + 0.1 * a * Math.sin(2 * Math.PI * hz(midi) * (h + 1) * t), 0);

/** Pitch classes ordered from strongest to weakest, by name. */
const ranked = (c: Chroma) => c.values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => PITCH_NAMES[i]);

describe("Chroma", () => {
  it("reads A440 as A", () => {
    const c = chromaOf(sine(440));
    expect(ranked(c)[0]).toBe("A");
    expect(c.values[9]).toBeCloseTo(1, 6);
    expect(c.key).toBe(9);
    expect(Math.max(...c.values.filter((_, i) => i !== 9))).toBeLessThan(0.2);
  });

  it("names pure tones across the range", () => {
    for (const midi of [48, 50, 55, 61, 64, 70, 76, 83, 95]) {
      const c = chromaOf(sine(hz(midi)));
      expect(c.key, `midi ${midi}`).toBe(midi % 12);
    }
  });

  it("puts a C major triad's C, E and G on top", () => {
    const chord = (t: number) => note(60)(t) + note(64)(t) + note(67)(t);
    const c = chromaOf(chord);
    expect(ranked(c).slice(0, 3).sort()).toEqual(["C", "E", "G"]);
    expect(Math.min(c.values[0], c.values[4], c.values[7])).toBeGreaterThan(0.5);
    // Harmonics of the triad land on G, B and D, so C# and F# stay low.
    expect(Math.max(c.values[1], c.values[6], c.values[8])).toBeLessThan(0.25);
  });

  it("reads an A minor triad's A, C and E on top", () => {
    const c = chromaOf((t) => note(57)(t) + note(60)(t) + note(64)(t));
    expect(ranked(c).slice(0, 3).sort()).toEqual(["A", "C", "E"]);
  });

  it("reads noise as flat-ish, with no clear winner", () => {
    let seed = 1;
    const noise = () => { seed = (seed * 16807) % 2147483647; return 0.3 * (seed / 1073741823.5 - 1); };
    const c = chromaOf(noise, 40);
    expect(Math.min(...c.values)).toBeGreaterThan(0.45);
  });

  it("is silent for silence and ignores sound outside its range", () => {
    expect(chromaOf(() => 0).values.every((v) => v === 0)).toBe(true);
    expect(Math.max(...chromaOf(sine(50)).values)).toBe(0);
    expect(Math.max(...chromaOf(sine(9000)).values)).toBe(0);
  });

  it("fades out the old note and keeps the key steady through near ties", () => {
    const c = chromaOf(sine(hz(69)), 20);
    expect(c.key).toBe(9);
    // A slightly weaker B joins: A stays the key.
    chromaOf((t) => sine(hz(69))(t) + sine(hz(71), 0.28)(t), 20, c);
    expect(c.key).toBe(9);
    // Then only D: A fades, D takes over.
    chromaOf(sine(hz(62)), 1, c);
    expect(c.values[9]).toBeGreaterThan(0.5);
    chromaOf(sine(hz(62)), 40, c);
    expect(c.values[9]).toBeLessThan(0.12);
    expect(c.key).toBe(2);
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
