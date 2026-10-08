import { describe, expect, it } from "vitest";
import { Analyser } from "../src/main/listen";
import { WAVE_SIZE, WAVE_SPAN, waveAt } from "../src/shared/waveform";

const RATE = 48000;

function push(analyser: Analyser, frames: number, signal: (t: number) => number, start: number): Float32Array {
  const samples = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    const x = signal((start + i) / RATE);
    samples[2 * i] = samples[2 * i + 1] = x;
  }
  return analyser.push(samples, (start + frames) / RATE).wave;
}

/** The largest difference between waveforms taken after chunks of uneven length. */
function jitter(signal: (t: number) => number): number {
  const analyser = new Analyser(RATE);
  let written = 2048;
  let previous = push(analyser, written, signal, 0), worst = 0;
  for (let c = 0; c < 40; c++) {
    const n = 700 + ((c * 337) % 500);
    const wave = push(analyser, n, signal, written);
    written += n;
    for (let i = 0; i < WAVE_SIZE; i++) worst = Math.max(worst, Math.abs(wave[i] - previous[i]));
    previous = wave;
  }
  return worst;
}

describe("waveform", () => {
  it("frames WAVE_SPAN samples as WAVE_SIZE values", () => {
    expect(WAVE_SIZE).toBe(512);
    expect(WAVE_SPAN / WAVE_SIZE).toBe(2);
    const wave = new Analyser(RATE).push(new Float32Array(0), 0).wave;
    expect(wave).toHaveLength(WAVE_SIZE);
    expect(Array.from(wave).every((x) => x === 0)).toBe(true);
  });

  it("free-runs on the newest samples when there is nothing to trigger on", () => {
    const analyser = new Analyser(RATE);
    const written = 2048 + 300;
    const ramp = (i: number) => 0.1 + i * 1e-4;
    const wave = push(analyser, written, (t) => ramp(t * RATE), 0);
    for (let i = 0; i < WAVE_SIZE; i++) {
      const a = ramp(written - WAVE_SPAN + 2 * i);
      const b = ramp(written - WAVE_SPAN + 2 * i + 1);
      expect(wave[i]).toBeCloseTo((a + b) / 2, 5);
    }
  });

  it("starts on a rising zero crossing, found between samples", () => {
    const analyser = new Analyser(RATE);
    const wave = push(analyser, 2048 + 1234, (t) => 0.5 * Math.sin(2 * Math.PI * 220 * t), 0);
    expect(Math.abs(wave[0])).toBeLessThan(0.02);
    expect(wave[4]).toBeGreaterThan(wave[0]);
    const cycle = RATE / 220 / 2;
    expect(Math.abs(waveAt(wave, (cycle + 0.5) / WAVE_SIZE))).toBeLessThan(0.02);
  });

  it("holds a steady tone still however the chunks fall", () => {
    expect(jitter((t) => 0.5 * Math.sin(2 * Math.PI * 220 * t))).toBeLessThan(0.005);
    expect(jitter((t) => 0.5 * Math.sin(2 * Math.PI * 60 * t))).toBeLessThan(0.005);
    expect(jitter((t) => 0.3 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t)))).toBeLessThan(0.005);
  });

  it("slides when untriggered, which the trigger prevents", () => {
    const analyser = new Analyser(RATE);
    const signal = (t: number) => 0.5 * Math.sin(2 * Math.PI * 220 * t) + 0.6;
    const a = push(analyser, 2048, signal, 0);
    const b = push(analyser, 777, signal, 2048);
    expect(Math.max(...a.map((x, i) => Math.abs(x - b[i])))).toBeGreaterThan(0.1);
  });

  it("clamps to -1..1", () => {
    const wave = push(new Analyser(RATE), 2048, (t) => 3 * Math.sin(2 * Math.PI * 100 * t), 0);
    expect(Math.max(...wave)).toBe(1);
    expect(Math.min(...wave)).toBe(-1);
  });
});

describe("waveAt", () => {
  it("interpolates between texel centres and clamps at the ends, like a texture", () => {
    const wave = [-1, 1, 0, 0.5];
    expect(waveAt(wave, 0)).toBe(-1);
    expect(waveAt(wave, 1)).toBe(0.5);
    expect(waveAt(wave, 0.25)).toBeCloseTo(0, 12);
    expect(waveAt(wave, 1.5 / 4)).toBe(1);
    expect(waveAt(wave, NaN)).toBe(-1);
    expect(waveAt([], 0.5)).toBe(0);
  });
});
