import { describe, expect, it } from "vitest";
import { Analyser } from "../src/main/listen";
import type { AudioFeatures } from "../src/shared/features";

const RATE = 48000;

/** Feeds one second of a stereo signal in 20 ms chunks. */
function feed(signal: (t: number) => [number, number]): { features: AudioFeatures; analyser: Analyser } {
  const analyser = new Analyser(RATE);
  let features = analyser.push(new Float32Array(0), 0);
  for (let c = 0; c < 50; c++) {
    const chunk = new Float32Array(960 * 2);
    for (let i = 0; i < 960; i++) {
      const [l, r] = signal((c * 960 + i) / RATE);
      chunk[2 * i] = l;
      chunk[2 * i + 1] = r;
    }
    features = analyser.push(chunk, (c + 1) * 0.02);
  }
  return { features, analyser };
}

const tone = (t: number) => 0.5 * Math.sin(2 * Math.PI * 440 * t);

describe("stereo image", () => {
  it("reads a mono signal as centred and narrow", () => {
    const { features } = feed((t) => [tone(t), tone(t)]);
    expect(features.balance).toBeCloseTo(0, 5);
    expect(features.width).toBeCloseTo(0, 5);
  });

  it("follows a panned signal to the louder side", () => {
    expect(feed((t) => [tone(t), 0]).features.balance).toBeLessThan(-0.98);
    expect(feed((t) => [0, tone(t)]).features.balance).toBeGreaterThan(0.98);
    const angle = (3 * Math.PI) / 8;
    const partial = feed((t) => [Math.cos(angle) * tone(t), Math.sin(angle) * tone(t)]).features.balance;
    const expected = (Math.sin(angle) - Math.cos(angle)) / (Math.sin(angle) + Math.cos(angle));
    expect(partial).toBeCloseTo(expected, 2);
  });

  it("reads uncorrelated or out-of-phase channels as wide", () => {
    const other = (t: number) => 0.5 * Math.sin(2 * Math.PI * 587 * t);
    expect(feed((t) => [tone(t), other(t)]).features.width).toBeGreaterThan(0.95);
    expect(feed((t) => [tone(t), -tone(t)]).features.width).toBeCloseTo(1, 5);
    const slight = feed((t) => [tone(t) + 0.1 * other(t), tone(t) - 0.1 * other(t)]).features.width;
    expect(slight).toBeCloseTo(0.1, 2);
  });

  it("stays centred and narrow in silence", () => {
    const { features } = feed(() => [0, 0]);
    expect(features.balance).toBe(0);
    expect(features.width).toBe(0);
  });

  it("smooths changes over a fraction of a second", () => {
    const { features, analyser } = feed((t) => [tone(t), 0]);
    const chunk = new Float32Array(960 * 2);
    for (let i = 0; i < 960; i++) chunk[2 * i + 1] = tone(i / RATE);
    const next = analyser.push(chunk, 1.02);
    expect(features.balance).toBeLessThan(0);
    expect(next.balance).toBeLessThan(0);
  });
});
