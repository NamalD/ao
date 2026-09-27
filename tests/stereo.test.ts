import { describe, expect, it } from "vitest";
import { StereoImage } from "../src/shared/stereo";

const RATE = 48000;

/** Feeds one second of a stereo signal in 20 ms chunks. */
function feed(signal: (t: number) => [number, number]): StereoImage {
  const image = new StereoImage();
  for (let c = 0; c < 50; c++) {
    const chunk = new Float32Array(960 * 2);
    for (let i = 0; i < 960; i++) {
      const [l, r] = signal((c * 960 + i) / RATE);
      chunk[2 * i] = l;
      chunk[2 * i + 1] = r;
    }
    image.push(chunk, 0.02);
  }
  return image;
}

const tone = (t: number) => 0.5 * Math.sin(2 * Math.PI * 440 * t);

describe("StereoImage", () => {
  it("reads a mono signal as centred and narrow", () => {
    const image = feed((t) => [tone(t), tone(t)]);
    expect(image.balance).toBeCloseTo(0, 6);
    expect(image.width).toBeCloseTo(0, 6);
  });

  it("follows a panned signal to the louder side", () => {
    expect(feed((t) => [tone(t), 0]).balance).toBeLessThan(-0.98);
    expect(feed((t) => [0, tone(t)]).balance).toBeGreaterThan(0.98);
    // Equal-power pan a quarter of the way right: right is louder by cos/sin.
    const angle = (3 * Math.PI) / 8;
    const partial = feed((t) => [Math.cos(angle) * tone(t), Math.sin(angle) * tone(t)]);
    const expected = (Math.sin(angle) - Math.cos(angle)) / (Math.sin(angle) + Math.cos(angle));
    expect(partial.balance).toBeCloseTo(expected, 2);
  });

  it("reads uncorrelated or out-of-phase channels as wide", () => {
    const other = (t: number) => 0.5 * Math.sin(2 * Math.PI * 587 * t);
    expect(feed((t) => [tone(t), other(t)]).width).toBeGreaterThan(0.95);
    expect(feed((t) => [tone(t), -tone(t)]).width).toBe(1);
    const slight = feed((t) => [tone(t) + 0.1 * other(t), tone(t) - 0.1 * other(t)]).width;
    // Side is a tenth of mid.
    expect(slight).toBeCloseTo(0.1, 2);
  });

  it("stays centred and narrow in silence", () => {
    const image = feed(() => [0, 0]);
    expect(image.balance).toBe(0);
    expect(image.width).toBe(0);
  });

  it("smooths changes over a fraction of a second", () => {
    const image = feed((t) => [tone(t), 0]);
    const chunk = new Float32Array(960 * 2);
    for (let i = 0; i < 960; i++) chunk[2 * i + 1] = tone(i / RATE);
    image.push(chunk, 0.02);
    expect(image.balance).toBeLessThan(0);
  });
});
