import { describe, expect, it } from "vitest";
import { Analyser, bandEdges, fft } from "../src/shared/analysis";

const RATE = 48000;

function stereo(seconds: number, signal: (t: number) => number, start = 0): Float32Array {
  const frames = Math.round(seconds * RATE);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) out[i * 2] = out[i * 2 + 1] = signal(start + i / RATE);
  return out;
}

/** Feeds a signal in 20 ms chunks, like parec, returning the last features. */
function feed(analyser: Analyser, seconds: number, signal: (t: number) => number, start = 0) {
  let features = analyser.push(new Float32Array(0), start);
  for (let t = 0; t < seconds - 1e-9; t += 0.02) {
    features = analyser.push(stereo(0.02, signal, start + t), start + t + 0.02);
  }
  return features;
}

describe("fft", () => {
  it("finds a pure tone in its bin", () => {
    const n = 64, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    fft(re, im);
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]));
    expect(mags[5]).toBeCloseTo(n / 2, 6);
    expect(mags[7]).toBeCloseTo(0, 6);
  });

  it("matches a direct DFT at every size, whichever size ran before", () => {
    for (const n of [2, 8, 256, 8, 1024]) {
      const input = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) + 0.3 * Math.cos(i * 0.2));
      const re = Float64Array.from(input), im = new Float64Array(n);
      fft(re, im);
      for (const k of [0, 1, n >> 2, n - 1]) {
        let dr = 0, di = 0;
        input.forEach((x, i) => {
          dr += x * Math.cos((-2 * Math.PI * k * i) / n);
          di += x * Math.sin((-2 * Math.PI * k * i) / n);
        });
        expect(re[k]).toBeCloseTo(dr, 8);
        expect(im[k]).toBeCloseTo(di, 8);
      }
    }
  });
});

describe("Analyser", () => {
  it("is silent for silence", () => {
    const f = feed(new Analyser(RATE), 0.5, () => 0);
    expect(f.loudness).toBe(0);
    expect(f.impulse).toBe(0);
    expect(Math.max(...f.spectrum)).toBe(0);
  });

  it("puts a 1 kHz tone in the mids, not the bass", () => {
    const f = feed(new Analyser(RATE), 0.5, (t) => 0.5 * Math.sin(2 * Math.PI * 1000 * t));
    const edges = bandEdges();
    const band = edges.findIndex((hz, i) => hz <= 1000 && edges[i + 1] > 1000);
    expect(f.spectrum[band]).toBeGreaterThan(0.8);
    expect(f.mid).toBeGreaterThan(f.bass);
    expect(f.mid).toBeGreaterThan(f.high);
    expect(f.loudness).toBeGreaterThan(0.5);
  });

  it("puts a 60 Hz tone in the bass", () => {
    const f = feed(new Analyser(RATE), 0.5, (t) => 0.5 * Math.sin(2 * Math.PI * 60 * t));
    expect(f.bass).toBeGreaterThan(f.mid);
    expect(f.bass).toBeGreaterThan(f.high);
  });

  it("jumps on a hit and settles during a sustained loud passage", () => {
    const analyser = new Analyser(RATE);
    feed(analyser, 0.3, () => 0);
    const loud = (t: number) => 0.6 * Math.sin(2 * Math.PI * 220 * t);
    const hit = analyser.push(stereo(0.02, loud, 0.3), 0.32);
    expect(hit.impulse).toBeGreaterThan(0.9);
    expect(hit.beat).toBe(1);
    const sustained = feed(analyser, 1, loud, 0.32);
    expect(sustained.impulse).toBeLessThan(0.05);
    expect(sustained.beat).toBeLessThan(0.05);
    expect(sustained.loudness).toBeGreaterThan(0.9);
  });
});
