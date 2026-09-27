import { describe, expect, it } from "vitest";
import {
  defaultNight, describeNight, nextNightMode, nightBrightness, nightLevel, nightSpeed,
  NightSettings, normalizeNight, parseClock,
} from "../src/shared/night";

// Local wall-clock time on an ordinary winter day (no DST change).
const at = (h: number, m = 0, s = 0) => new Date(2026, 0, 15, h, m, s);
const night = (overrides: Partial<NightSettings> = {}): NightSettings => ({ ...defaultNight, ...overrides });

describe("parseClock", () => {
  it("reads HH:MM as minutes since midnight", () => {
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("7:05")).toBe(425);
    expect(parseClock("23:59")).toBe(1439);
  });
  it("rejects anything else", () => {
    for (const bad of ["24:00", "12:60", "noon", "12", "", 1200, null]) expect(parseClock(bad)).toBeUndefined();
  });
});

describe("nightLevel on a window across midnight (22:00-07:00, 45 min fade)", () => {
  const n = night({ start: "22:00", end: "07:00", fadeMinutes: 45 });
  it("is day before the window and after it", () => {
    expect(nightLevel(n, at(12))).toBe(0);
    expect(nightLevel(n, at(21, 59, 59))).toBe(0);
    expect(nightLevel(n, at(7))).toBe(0);
    expect(nightLevel(n, at(8))).toBe(0);
  });
  it("eases down after the start", () => {
    expect(nightLevel(n, at(22))).toBe(0);
    const early = nightLevel(n, at(22, 10)), half = nightLevel(n, at(22, 22, 30)), late = nightLevel(n, at(22, 35));
    expect(half).toBeCloseTo(0.5, 12);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(half);
    expect(late).toBeGreaterThan(half);
    expect(late).toBeLessThan(1);
    expect(nightLevel(n, at(22, 45))).toBe(1);
  });
  it("is full night through midnight", () => {
    expect(nightLevel(n, at(23, 30))).toBe(1);
    expect(nightLevel(n, at(0))).toBe(1);
    expect(nightLevel(n, at(3))).toBe(1);
    expect(nightLevel(n, at(6, 15))).toBe(1);
  });
  it("eases back up before the end", () => {
    expect(nightLevel(n, at(6, 37, 30))).toBeCloseTo(0.5, 12);
    expect(nightLevel(n, at(6, 50))).toBeLessThan(nightLevel(n, at(6, 30)));
    expect(nightLevel(n, at(6, 59, 59))).toBeLessThan(0.001);
  });
  it("is continuous minute by minute across the whole day", () => {
    let previous = nightLevel(n, at(0));
    for (let minute = 1; minute <= 24 * 60; minute++) {
      const level = nightLevel(n, new Date(2026, 0, 15, 0, minute));
      expect(Math.abs(level - previous)).toBeLessThan(0.06);
      previous = level;
    }
  });
});

describe("nightLevel on other windows", () => {
  it("handles a window within one day", () => {
    const n = night({ start: "01:00", end: "05:00", fadeMinutes: 30 });
    expect(nightLevel(n, at(0, 59))).toBe(0);
    expect(nightLevel(n, at(1, 15))).toBeCloseTo(0.5, 12);
    expect(nightLevel(n, at(3))).toBe(1);
    expect(nightLevel(n, at(4, 45))).toBeCloseTo(0.5, 12);
    expect(nightLevel(n, at(5))).toBe(0);
    expect(nightLevel(n, at(23))).toBe(0);
  });
  it("never reaches full night in a window shorter than two fades", () => {
    const n = night({ start: "23:30", end: "00:30", fadeMinutes: 45 });
    // Midnight is 30 of 45 fade minutes in from either end: smoothstep(2/3).
    expect(nightLevel(n, at(0))).toBeCloseTo(20 / 27, 12);
    expect(nightLevel(n, at(0))).toBeLessThan(1);
    expect(nightLevel(n, at(23, 45))).toBeCloseTo(nightLevel(n, at(0, 15)), 12);
  });
  it("switches at once with no fade", () => {
    const n = night({ fadeMinutes: 0 });
    expect(nightLevel(n, at(21, 59))).toBe(0);
    expect(nightLevel(n, at(22))).toBe(1);
    expect(nightLevel(n, at(6, 59))).toBe(1);
    expect(nightLevel(n, at(7))).toBe(0);
  });
  it("treats start equal to end as an empty window", () => {
    const n = night({ start: "22:00", end: "22:00" });
    for (const h of [0, 6, 22, 23]) expect(nightLevel(n, at(h, 10))).toBe(0);
  });
});

describe("modes", () => {
  it("forces night on or off regardless of the clock", () => {
    expect(nightLevel(night({ mode: "on" }), at(12))).toBe(1);
    expect(nightLevel(night({ mode: "off" }), at(2))).toBe(0);
  });
  it("cycles schedule, on, off", () => {
    expect(nextNightMode("schedule")).toBe("on");
    expect(nextNightMode("on")).toBe("off");
    expect(nextNightMode("off")).toBe("schedule");
  });
  it("describes each mode", () => {
    expect(describeNight(night())).toBe("night fade: scheduled (active 22:00–07:00)");
    expect(describeNight(night({ mode: "on", brightness: 0.4 }))).toBe("night fade: on (40% brightness)");
    expect(describeNight(night({ mode: "off" }))).toBe("night fade: off");
  });
});

describe("brightness and speed", () => {
  it("scales from 1 by day to the configured value at full night", () => {
    const n = night({ brightness: 0.3, speed: 0.5 });
    expect(nightBrightness(n, at(12))).toBe(1);
    expect(nightBrightness(n, at(2))).toBeCloseTo(0.3, 12);
    expect(nightBrightness(n, at(22, 22, 30))).toBeCloseTo(0.65, 12);
    expect(nightSpeed(n, at(12))).toBe(1);
    expect(nightSpeed(n, at(2))).toBeCloseTo(0.5, 12);
  });
  it("leaves speed alone by default", () => {
    expect(nightSpeed(night(), at(2))).toBe(1);
  });
});

describe("normalizeNight", () => {
  it("fills in defaults for missing or broken settings", () => {
    expect(normalizeNight(undefined)).toEqual(defaultNight);
    expect(normalizeNight("nope")).toEqual(defaultNight);
    expect(normalizeNight({ mode: "sometimes", start: "25:00", end: 7, brightness: "dim", fadeMinutes: NaN }))
      .toEqual(defaultNight);
  });
  it("clamps numbers and tidies times", () => {
    expect(normalizeNight({ start: "9:30", brightness: 2, fadeMinutes: -5, speed: 0 }))
      .toEqual({ ...defaultNight, start: "09:30", brightness: 1, fadeMinutes: 0, speed: 0.1 });
  });
  it("uses the given fallback for fields it rejects", () => {
    const current = night({ mode: "on", brightness: 0.2 });
    expect(normalizeNight({ brightness: "x" }, current)).toEqual(current);
  });
});
