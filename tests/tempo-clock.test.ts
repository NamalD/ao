import { describe, expect, it } from "vitest";
import { BpmDriver, describeTempo, DOUBLE_TAP, TAP_GAP, TempoClock, msUntilNextBar } from "../src/shared/tempo-clock";

const near = (a: number, b: number, tolerance = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tolerance);

/** Feeds a perfect detector at `bpm` to the clock at 50 updates a second. */
function feed(clock: TempoClock, bpm: number, from: number, to: number, beatsAtZero = 0, confidence = 0.8) {
  for (let t = from; t <= to + 1e-9; t += 0.02) clock.follow({ bpm, beats: beatsAtZero + (t * bpm) / 60, confidence }, t);
}

describe("TempoClock", () => {
  it("free-runs at 120 bpm before anything is detected", () => {
    const clock = new TempoClock();
    near(clock.beatsAt(0.25), 0.5);
    near(clock.phaseAt(1.25), 0.5);
    expect(clock.barAt(1.6)).toBe(3);
    expect(clock.barAt(2.1)).toBe(0);
  });

  it("follows the detector smoothly, closing the gap over a fraction of a second", () => {
    const clock = new TempoClock();
    // The detector is a quarter beat ahead at 128 bpm.
    feed(clock, 128, 0, 1, 0.25);
    expect(clock.bpm).toBe(128);
    near(clock.beatsAt(1), 0.25 + 128 / 60, 5e-3);
    // Between updates the phase keeps moving at the tempo.
    near(clock.beatsAt(1.01) - clock.beatsAt(1), 128 / 60 / 100, 1e-12);
  });

  it("slides to the nearest detected beat rather than a whole beat back", () => {
    const clock = new TempoClock();
    feed(clock, 120, 0, 1, 0.9);
    // 0.9 beats ahead is 0.1 behind the next beat: the phase settles 0.1 back.
    near(clock.phaseAt(1), 0.9, 1e-3);
    near(clock.beatsAt(1), 1.9, 1e-3);
  });

  it("takes tempo from the median tap interval, each tap a beat from the one", () => {
    const clock = new TempoClock();
    feed(clock, 120, 0, 1.3);
    const taps = [2, 2.47, 2.94, 3.41, 3.9, 4.37]; // ~128 bpm with a sloppy tap
    for (const t of taps) clock.tap(t);
    expect(clock.source).toBe("tap");
    near(clock.bpm, 60 / 0.47, 1e-9);
    // The first tap was the one; the sixth is beat 6 of the count: bar 1, beat 1.
    near(clock.phaseAt(4.37), 0);
    expect(clock.barAt(4.37)).toBe(1);
    expect(clock.confidence).toBe(1);
    expect(clock.tapsInSequence).toBe(6);
  });

  it("uses only the last eight intervals", () => {
    const clock = new TempoClock();
    let t = 0;
    for (let i = 0; i < 6; i++) clock.tap((t += 1)); // 60 bpm
    for (let i = 0; i < 9; i++) clock.tap((t += 0.5)); // then 120 bpm
    near(clock.bpm, 120);
  });

  it("puts the first tap on the one, keeping the tempo until the second", () => {
    const clock = new TempoClock();
    feed(clock, 100, 0, 3);
    clock.tap(3.3);
    expect(clock.source).toBe("tap");
    expect(clock.bpm).toBe(100);
    near(clock.phaseAt(3.3), 0);
    expect(clock.barAt(3.3)).toBe(0);
  });

  it("starts a new sequence after a pause, keeping the tapped tempo", () => {
    const clock = new TempoClock();
    for (const t of [1, 1.5, 2, 2.5]) clock.tap(t);
    clock.tap(2.5 + TAP_GAP + 0.5);
    expect(clock.tapsInSequence).toBe(1);
    near(clock.bpm, 120);
    expect(clock.barAt(5)).toBe(0);
    clock.tap(5.4);
    near(clock.bpm, 150);
  });

  it("ignores the detector while tapped", () => {
    const clock = new TempoClock();
    for (const t of [1, 1.5, 2]) clock.tap(t);
    feed(clock, 90, 2, 4, 0.37);
    near(clock.bpm, 120);
    near(clock.phaseAt(4), 0);
  });

  it("returns to auto on a double tap, keeping the bar where it was tapped", () => {
    const clock = new TempoClock();
    feed(clock, 120, 0, 2.9);
    // Tapping in time with the detector, but with the one on its beat 6.
    for (const t of [3, 3.5, 4, 4.5]) clock.tap(t);
    expect(clock.barAt(3.1)).toBe(0);
    clock.tap(4.5 + DOUBLE_TAP / 2);
    expect(clock.source).toBe("auto");
    // The status shows the detected tempo straight away.
    expect(clock.bpm).toBe(120);
    feed(clock, 126, 4.6, 8, -0.2);
    near(clock.bpm, 126);
    // In phase with the detector again...
    const detected = -0.2 + (8 * 126) / 60;
    near(clock.phaseAt(8), detected - Math.floor(detected), 1e-3);
    // ...and still counting bars from the tapped one.
    const clock2 = new TempoClock();
    feed(clock2, 120, 0, 2.9);
    for (const t of [3, 3.5, 4, 4.5]) clock2.tap(t);
    clock2.tap(4.5 + DOUBLE_TAP / 2);
    feed(clock2, 120, 4.6, 8.1);
    expect(clock2.barAt(8.1)).toBe(2); // floor((8.1 - 3) * 2) % 4; the detector alone would say 0
  });
});

describe("BpmDriver", () => {
  it("drives bpm once there is a tempo", () => {
    const driver = new BpmDriver(30);
    expect(driver.frame(30, null)).toBeUndefined();
    expect(driver.driving).toBe(false);
    expect(driver.frame(30, 128)).toBe(128);
    expect(driver.driving).toBe(true);
    expect(driver.frame(128, 128.5)).toBe(128.5);
  });

  it("leaves bpm to a sketch that sets it until the next release", () => {
    const driver = new BpmDriver(30);
    driver.frame(30, 128);
    // The sketch runs `bpm = 90`.
    expect(driver.frame(90, 128)).toBeUndefined();
    expect(driver.driving).toBe(false);
    expect(driver.frame(90, 130)).toBeUndefined();
    // A whole-sketch run releases it; this run doesn't set bpm.
    driver.release(90);
    expect(driver.frame(90, 130)).toBe(130);
    // A run that sets it again keeps it.
    driver.release(130);
    expect(driver.frame(60, 130)).toBeUndefined();
  });

  it("notices a sketch that sets bpm before Ao ever drove it", () => {
    const driver = new BpmDriver(30);
    expect(driver.frame(45, null)).toBeUndefined();
    expect(driver.frame(45, 128)).toBeUndefined();
  });
});

describe("describeTempo", () => {
  it("names the source, and the confidence when detected", () => {
    expect(describeTempo({ source: "tap", bpm: 128, confidence: 1, tapsInSequence: 4 })).toBe("tempo 128.0 (tap)");
    expect(describeTempo({ source: "tap", bpm: 120, confidence: 1, tapsInSequence: 1 })).toBe("tempo 120.0 (tap: bar reset; keep tapping each beat)");
    expect(describeTempo({ source: "auto", bpm: 127.94, confidence: 0.82, tapsInSequence: 0 })).toBe("tempo 127.9 (auto, 82%)");
    expect(describeTempo({ source: "auto", bpm: 120, confidence: 0, tapsInSequence: 0 })).toBe("tempo 120.0 (auto, listening)");
  });
});

describe("msUntilNextBar", () => {
  it("counts the beats left in the bar at the tempo", () => {
    expect(msUntilNextBar(0, 0, 120, true)).toBeCloseTo(2000);
    expect(msUntilNextBar(3, 0.5, 120, true)).toBeCloseTo(250);
    expect(msUntilNextBar(2, 0.25, 60, true)).toBeCloseTo(1750);
  });

  it("switches at once when the tempo isn't trusted", () => {
    expect(msUntilNextBar(1, 0.5, 120, false)).toBe(0);
    expect(msUntilNextBar(1, 0.5, 0, true)).toBe(0);
  });
});
