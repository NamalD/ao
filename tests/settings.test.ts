import { describe, expect, it } from "vitest";
import { defaultNight } from "../src/shared/night";
import { defaultSettings, mergeSettings, normalizeSettings } from "../src/shared/settings";

describe("settings", () => {
  it("defaults a missing or corrupt file", () => {
    expect(normalizeSettings(undefined)).toEqual(defaultSettings);
    expect(normalizeSettings([1, 2])).toEqual(defaultSettings);
    expect(normalizeSettings({ meter: "yes", night: 3 })).toEqual(defaultSettings);
  });

  it("fills in a partial night section and keeps unknown keys", () => {
    const s = normalizeSettings({ meter: true, night: { start: "23:00" }, note: "hi" });
    expect(s).toEqual({ meter: true, liveValues: true, night: { ...defaultNight, start: "23:00" }, note: "hi" });
  });

  it("merges patches field by field, ignoring unknown or invalid ones", () => {
    const current = normalizeSettings({ meter: true, night: { start: "23:00", brightness: 0.2 } });
    expect(mergeSettings(current, { night: { mode: "on" } }))
      .toEqual({ meter: true, liveValues: true, night: { ...defaultNight, start: "23:00", brightness: 0.2, mode: "on" } });
    expect(mergeSettings(current, { meter: false }).meter).toBe(false);
    expect(mergeSettings(current, { meter: "no", evil: 1, night: { brightness: "x" } })).toEqual(current);
    expect(mergeSettings(current, null)).toEqual(current);
  });

  it("shows live values unless turned off, and saves the toggle", () => {
    expect(defaultSettings.liveValues).toBe(true);
    expect(normalizeSettings({ liveValues: false }).liveValues).toBe(false);
    expect(normalizeSettings({ liveValues: "no" }).liveValues).toBe(true);
    const off = mergeSettings(defaultSettings, { liveValues: false });
    expect(off).toEqual({ ...defaultSettings, liveValues: false });
    expect(mergeSettings(off, { liveValues: 1 }).liveValues).toBe(false);
  });
});
