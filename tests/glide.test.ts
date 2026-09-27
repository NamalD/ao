import { describe, expect, it } from "vitest";
import { glide } from "../src/shared/glide";

/** A glide over `target`, with a clock the test advances by hand. */
function setup(seconds: number) {
  const state = { target: 120, ms: 0 };
  const value = glide(() => state.target, seconds, () => state.ms);
  return { state, value };
}

describe("glide", () => {
  it("starts at the current value", () => {
    expect(setup(2).value()).toBe(120);
  });

  it("eases towards a new value, nearly arriving after `seconds`", () => {
    const { state, value } = setup(2);
    state.target = 140;
    state.ms = 500;
    const early = value();
    expect(early).toBeGreaterThan(120);
    expect(early).toBeLessThan(140);
    state.ms = 2000;
    expect(value()).toBeCloseTo(140 - 20 * Math.exp(-4), 9);
    state.ms = 10000;
    expect(value()).toBeCloseTo(140, 6);
  });

  it("glides at the same pace however often it is called", () => {
    const coarse = setup(1), fine = setup(1);
    coarse.state.target = fine.state.target = 60;
    coarse.state.ms = 400;
    for (let ms = 0; ms <= 400; ms += 10) {
      fine.state.ms = ms;
      fine.value();
    }
    expect(coarse.value()).toBeCloseTo(fine.value(), 9);
  });

  it("does not move when called twice at the same moment", () => {
    const { state, value } = setup(1);
    state.target = 0;
    state.ms = 250;
    const first = value();
    expect(value()).toBe(first);
  });

  it("follows exactly with no glide time, and recovers from a non-finite value", () => {
    const { state, value } = setup(0);
    state.target = 90;
    expect(value()).toBe(90);
    const broken = setup(1);
    broken.state.target = NaN;
    broken.state.ms = 100;
    expect(broken.value()).toBeNaN();
    broken.state.target = 100;
    broken.state.ms = 200;
    expect(broken.value()).toBe(100);
  });
});
