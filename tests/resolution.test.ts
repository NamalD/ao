import { describe, expect, it } from "vitest";
import { MIN_SCALE, ResolutionGovernor } from "../src/renderer/resolution";

describe("automatic scene resolution", () => {
  it("draws at full size while scenes fit the budget", () => {
    const governor = new ResolutionGovernor(10);
    expect(governor.report({}, 4, 1, 0)).toBe(1);
    // Barely over is tolerated rather than resizing for it.
    expect(new ResolutionGovernor(10).report({}, 11, 1, 0)).toBe(1);
  });

  it("shrinks the scale by the square root of the overrun, since cost follows the pixel count", () => {
    const governor = new ResolutionGovernor(10);
    // 40 ms at full size is four times over, so half the width and height.
    expect(governor.report({}, 40, 1, 0)).toBe(0.5);
  });

  it("shares one budget between every automatic scene", () => {
    const governor = new ResolutionGovernor(10);
    const a = {}, b = {};
    governor.report(a, 20, 1, 0);
    // Together 40 ms at full size, like the demolisher sketch's two solids.
    expect(governor.report(b, 20, 1, 0)).toBe(0.5);
  });

  it("judges a report by what the scene would cost at full size", () => {
    const governor = new ResolutionGovernor(10);
    // 2.5 ms at half size is 10 ms at full size: exactly the budget.
    expect(governor.report({}, 2.5, 0.5, 0)).toBe(1);
  });

  it("never goes below the minimum scale", () => {
    const governor = new ResolutionGovernor(10);
    expect(governor.report({}, 10_000, 1, 0)).toBe(MIN_SCALE);
  });

  it("ignores one stray slow frame but follows a heavier passage within a few frames", () => {
    const governor = new ResolutionGovernor(10);
    const scene = {};
    governor.report(scene, 5, 1, 0);
    expect(governor.report(scene, 12, 1, 16)).toBe(1);
    expect(governor.report(scene, 5, 1, 32)).toBe(1);
    let scale = 1;
    for (let t = 48; t < 48 + 16 * 8; t += 16) scale = governor.report(scene, 40 * scale * scale, scale, t);
    expect(scale).toBeLessThanOrEqual(0.6);
  });

  it("climbs back gradually when the scene gets lighter", () => {
    const governor = new ResolutionGovernor(10);
    const scene = {};
    governor.report(scene, 40, 1, 0);
    // The music quietens: one light frame barely moves the scale.
    expect(governor.report(scene, 1, 0.5, 16)).toBe(0.5);
    let scale = 0.5;
    for (let t = 32; t < 4000; t += 16) scale = governor.report(scene, 2.5 * scale * scale, scale, t);
    expect(scale).toBe(1);
  });

  it("waits after a change before climbing, so swelling music doesn't keep resizing", () => {
    const governor = new ResolutionGovernor(10);
    const scene = {};
    governor.report(scene, 40, 1, 0);
    // The scene is suddenly light, but the scale holds for a while first.
    for (let t = 16; t < 1990; t += 16) expect(governor.report(scene, 0.01, 0.5, t)).toBe(0.5);
    expect(governor.report(scene, 0.01, 0.5, 2000)).toBe(1);
  });

  it("doesn't bounce between two steps when the ideal scale sits between them", () => {
    const governor = new ResolutionGovernor(10);
    const scene = {};
    governor.report(scene, 10 / (0.62 * 0.62), 1, 0);
    const seen = new Set<number>();
    for (let t = 16; t < 1000; t += 16) {
      const scale = governor.scaleAt(t);
      // The cost wavers a little either side of an ideal of 0.62.
      const ideal = 0.62 + (t % 32 ? 0.02 : -0.02);
      governor.report(scene, (10 / (ideal * ideal)) * scale * scale, scale, t);
      seen.add(governor.scaleAt(t));
    }
    expect([...seen]).toEqual([0.6]);
  });

  it("forgets scenes that stop reporting, and starts the next sketch at full size", () => {
    const governor = new ResolutionGovernor(10);
    governor.report({}, 40, 1, 0);
    expect(governor.active(500)).toBe(true);
    expect(governor.active(2000)).toBe(false);
    expect(governor.scaleAt(2000)).toBe(1);
  });

  it("ignores unusable timings", () => {
    const governor = new ResolutionGovernor(10);
    expect(governor.report({}, NaN, 1, 0)).toBe(1);
    expect(governor.report({}, 5, 0, 0)).toBe(1);
    expect(governor.active(0)).toBe(false);
  });
});
