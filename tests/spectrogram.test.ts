import { describe, expect, it } from "vitest";
import { HISTORY_RATE, HISTORY_ROWS, SpectrumHistory } from "../src/renderer/spectrogram";

const frame = (value: number, bands = 4) => new Array<number>(bands).fill(value);

describe("SpectrumHistory", () => {
  it("keeps 5.12 s of 64 bands at 50 rows a second by default", () => {
    const history = new SpectrumHistory();
    expect(history.data).toHaveLength(64 * HISTORY_ROWS);
    expect(HISTORY_ROWS / HISTORY_RATE).toBeCloseTo(5.12, 12);
  });

  it("writes one row per 20 ms of capture time, newest first", () => {
    const history = new SpectrumHistory(4, 8, 50);
    for (let i = 0; i < 5; i++) history.push(frame(i), 0.02 * i + 0.001);
    expect(history.written).toBe(5);
    expect(history.newest).toBe(4);
    expect(history.at(0, 0)).toBe(4);
    expect(history.at(0, 4)).toBe(0);
  });

  it("wraps around the ring, keeping the newest rows", () => {
    const history = new SpectrumHistory(2, 4, 50);
    for (let i = 0; i < 7; i++) history.push(frame(i, 2), 0.02 * i + 0.001);
    expect(history.newest).toBe(2);
    expect([0, 1, 2, 3].map((age) => history.at(1, age))).toEqual([6, 5, 4, 3]);
    expect(Array.from(history.data.filter((_, i) => i % 2 === 0))).toEqual([4, 5, 6, 3]);
  });

  it("keeps an even time base however the chunks arrive", () => {
    const history = new SpectrumHistory(1, 16, 50);
    history.push([0], 0.001);
    // Two frames in the same 20 ms: the second refreshes the newest row.
    history.push([0.5], 0.01);
    expect(history.written).toBe(1);
    expect(history.at(0, 0)).toBe(0.5);
    // A 60 ms gap: three rows, interpolated from the previous frame.
    history.push([1.1], 0.061);
    expect(history.written).toBe(4);
    expect([2, 1, 0].map((age) => history.at(0, age))).toEqual([expect.closeTo(0.7, 6), expect.closeTo(0.9, 6), expect.closeTo(1.1, 6)]);
  });

  it("caps a long gap at one ring and restarts when the clock goes back", () => {
    const history = new SpectrumHistory(1, 4, 50);
    history.push([0], 0);
    history.push([1], 100);
    expect(history.written).toBe(5);
    expect(history.at(0, 0)).toBe(1);
    history.push([0.25], 1);
    expect(history.written).toBe(6);
    expect(history.at(0, 0)).toBe(0.25);
    expect(history.at(0, 1)).toBe(1);
  });

  it("bumps its version on every change so scenes know to upload", () => {
    const history = new SpectrumHistory(1, 4, 50);
    const before = history.version;
    history.push([0], 0);
    history.push([1], 0.001);
    expect(history.version).toBe(before + 2);
  });
});
