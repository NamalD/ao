import { describe, expect, it } from "vitest";
import { triggeredWave, WAVE_SIZE, WAVE_SPAN, waveAt } from "../src/shared/waveform";

const RATE = 48000;
const RING = 2048;

/** Writes `count` samples of `signal` into a ring buffer, continuing from `written`. */
function write(ring: Float64Array, written: number, count: number, signal: (t: number) => number): number {
  for (let i = 0; i < count; i++, written++) ring[written % RING] = signal(written / RATE);
  return written;
}

/** The largest difference between waveforms taken after chunks of uneven length. */
function jitter(signal: (t: number) => number): number {
  const ring = new Float64Array(RING);
  let written = write(ring, 0, RING, signal);
  let previous = triggeredWave(ring, written), worst = 0;
  for (let c = 0; c < 40; c++) {
    written = write(ring, written, 700 + ((c * 337) % 500), signal);
    const wave = triggeredWave(ring, written);
    for (let i = 0; i < WAVE_SIZE; i++) worst = Math.max(worst, Math.abs(wave[i] - previous[i]));
    previous = wave;
  }
  return worst;
}

describe("triggeredWave", () => {
  it("frames WAVE_SPAN samples as WAVE_SIZE values", () => {
    expect(WAVE_SIZE).toBe(512);
    expect(WAVE_SPAN / WAVE_SIZE).toBe(2);
    const ring = new Float64Array(RING);
    expect(triggeredWave(ring, 0)).toHaveLength(WAVE_SIZE);
    expect(Array.from(triggeredWave(ring, 0)).every((x) => x === 0)).toBe(true);
  });

  it("free-runs on the newest samples when there is nothing to trigger on", () => {
    // A rising ramp that never crosses zero: the frame is the newest span.
    const ring = new Float64Array(RING);
    const written = RING + 300;
    for (let w = 0; w < written; w++) ring[w % RING] = 0.1 + w * 1e-4;
    const wave = triggeredWave(ring, written);
    const newest = 0.1 + (written - 1) * 1e-4;
    expect(wave[WAVE_SIZE - 1]).toBeCloseTo(newest - 0.5e-4, 6);
    expect(wave[0]).toBeCloseTo(newest - (WAVE_SPAN - 1) * 1e-4 + 0.5e-4, 6);
  });

  it("starts on a rising zero crossing, found between samples", () => {
    const ring = new Float64Array(RING);
    const written = write(ring, 0, RING + 1234, (t) => 0.5 * Math.sin(2 * Math.PI * 220 * t));
    const wave = triggeredWave(ring, written);
    expect(Math.abs(wave[0])).toBeLessThan(0.02);
    expect(wave[4]).toBeGreaterThan(wave[0]);
    // One cycle of 220 Hz later (~109 values), the frame rises through zero again.
    const cycle = RATE / 220 / 2;
    expect(Math.abs(waveAt(wave, (cycle + 0.5) / WAVE_SIZE))).toBeLessThan(0.02);
  });

  it("holds a steady tone still however the chunks fall", () => {
    expect(jitter((t) => 0.5 * Math.sin(2 * Math.PI * 220 * t))).toBeLessThan(0.005);
    expect(jitter((t) => 0.5 * Math.sin(2 * Math.PI * 60 * t))).toBeLessThan(0.005);
    // Two partials give several rising crossings a period; the trigger
    // arms only on the deepest dip, so it keeps picking the same one.
    expect(jitter((t) => 0.3 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t)))).toBeLessThan(0.005);
  });

  it("slides when untriggered, which the trigger prevents", () => {
    // Guard for the test above: without triggering, the same tone would move.
    const ring = new Float64Array(RING);
    const signal = (t: number) => 0.5 * Math.sin(2 * Math.PI * 220 * t) + 0.6;
    let written = write(ring, 0, RING, signal);
    const a = triggeredWave(ring, written);
    written = write(ring, written, 777, signal);
    const b = triggeredWave(ring, written);
    expect(Math.max(...a.map((x, i) => Math.abs(x - b[i])))).toBeGreaterThan(0.1);
  });

  it("clamps to -1..1", () => {
    const ring = new Float64Array(RING);
    const written = write(ring, 0, RING, (t) => 3 * Math.sin(2 * Math.PI * 100 * t));
    const wave = triggeredWave(ring, written);
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
