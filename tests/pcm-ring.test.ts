import { describe, expect, it } from "vitest";
import { PcmRing } from "../src/shared/pcm-ring";

/** Interleaved stereo frames: left = start + i, right = -(start + i). */
function frames(count: number, start = 1): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    out[i * 2] = start + i;
    out[i * 2 + 1] = -(start + i);
  }
  return out;
}

function pull(ring: PcmRing, count: number): { left: number[]; right: number[]; got: number } {
  const left = new Float32Array(count).fill(NaN), right = new Float32Array(count).fill(NaN);
  const got = ring.pull(left, right);
  return { left: [...left], right: [...right], got };
}

describe("PcmRing", () => {
  it("outputs silence until it holds the target, then plays in order", () => {
    const ring = new PcmRing(16, 4);
    ring.push(frames(3));
    expect(pull(ring, 2)).toEqual({ left: [0, 0], right: [0, 0], got: 0 });
    expect(ring.buffered).toBe(3);
    ring.push(frames(2, 4));
    expect(pull(ring, 4)).toEqual({ left: [1, 2, 3, 4], right: [-1, -2, -3, -4], got: 4 });
    expect(ring.buffered).toBe(1);
  });

  it("pads an underrun with silence and refills to the target before playing again", () => {
    const ring = new PcmRing(16, 2);
    ring.push(frames(3));
    expect(pull(ring, 4)).toEqual({ left: [1, 2, 3, 0], right: [-1, -2, -3, 0], got: 3 });
    expect(ring.underruns).toBe(1);
    ring.push(frames(1, 10));
    // One frame is below the target: still silent rather than a crackle.
    expect(pull(ring, 2).got).toBe(0);
    ring.push(frames(1, 11));
    expect(pull(ring, 2)).toEqual({ left: [10, 11], right: [-10, -11], got: 2 });
  });

  it("wraps around its storage", () => {
    const ring = new PcmRing(4, 1);
    for (let start = 1; start < 40; start += 3) {
      ring.push(frames(3, start));
      expect(pull(ring, 3).left).toEqual([start, start + 1, start + 2]);
    }
  });

  it("drops the oldest audio back to the target when it overflows", () => {
    const ring = new PcmRing(8, 3);
    ring.push(frames(6));
    ring.push(frames(4, 7)); // 10 > 8: keep the newest 3
    expect(ring.buffered).toBe(3);
    expect(ring.dropped).toBe(7);
    expect(pull(ring, 3).left).toEqual([8, 9, 10]);
  });

  it("keeps only the newest capacity frames of an oversized chunk", () => {
    const ring = new PcmRing(4, 2);
    ring.push(frames(10));
    expect(ring.buffered).toBe(4);
    expect(pull(ring, 4).left).toEqual([7, 8, 9, 10]);
  });

  it("rejects a target it could never reach", () => {
    expect(() => new PcmRing(4, 5)).toThrow(RangeError);
    expect(() => new PcmRing(4, 0)).toThrow(RangeError);
  });
});
