import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parecCommand } from "../src/main/capture";
import { findExecutable } from "../src/shared/executable";

describe("capture command", () => {
  it("resolves parec to an absolute executable path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-path-"));
    writeFileSync(join(dir, "parec"), "#!/bin/sh\n", { mode: 0o755 });
    const parec = findExecutable("parec", `relative/bin:${dir}`);
    expect(parec).toBe(join(dir, "parec"));
    const [command, args] = parecCommand("sink.monitor", parec!);
    expect(isAbsolute(command)).toBe(true);
    expect(args).toContain("sink.monitor");
    expect(args).toContain("--format=float32le");
  });

  it("reports a missing or non-executable program instead of a bare name", () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-path-"));
    writeFileSync(join(dir, "parec"), "not executable", { mode: 0o644 });
    expect(findExecutable("parec", dir)).toBeNull();
    expect(findExecutable("parec", "")).toBeNull();
  });
});

describe("fake capture", () => {
  it("keeps real-time pace when its timer fires late", async () => {
    const { vi } = await import("vitest");
    const { startFakeCapture, SAMPLE_RATE } = await import("../src/main/capture");
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let frames = 0;
      const capture = startFakeCapture(() => {}, (samples) => { frames += samples.length / 2; });
      // Every 20 ms tick runs 5 ms late: one second passes in 40 ticks.
      for (let tick = 0; tick < 40; tick++) {
        clock += 25;
        vi.advanceTimersByTime(20);
      }
      capture.stop();
      expect(frames).toBe(SAMPLE_RATE);
    } finally {
      vi.useRealTimers();
      now.mockRestore();
    }
  });

  it("is stereo, with a voice drifting between the speakers", async () => {
    const { vi } = await import("vitest");
    const { startFakeCapture } = await import("../src/main/capture");
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const balances: number[] = [], widths: number[] = [];
      let different = false;
      const capture = startFakeCapture((f) => { balances.push(f.balance); widths.push(f.width); }, (samples) => {
        for (let i = 0; i < samples.length && !different; i += 2) different = samples[i] !== samples[i + 1];
      });
      // Seven seconds: the drift peaks right at 2 s and left at 6 s.
      for (let tick = 0; tick < 350; tick++) {
        clock += 20;
        vi.advanceTimersByTime(20);
      }
      capture.stop();
      expect(different).toBe(true);
      expect(Math.max(...balances)).toBeGreaterThan(0.1);
      expect(Math.min(...balances)).toBeLessThan(-0.1);
      expect(Math.max(...balances.map(Math.abs))).toBeLessThan(0.6);
      expect(Math.max(...widths)).toBeGreaterThan(0.1);
    } finally {
      vi.useRealTimers();
      now.mockRestore();
    }
  });

  it("sends section energy and the drop pulse with the features", async () => {
    const { vi } = await import("vitest");
    const { startFakeCapture } = await import("../src/main/capture");
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const energies: number[] = [], drops: number[] = [];
      const capture = startFakeCapture((f) => { energies.push(f.energy!); drops.push(f.drop!); });
      for (let tick = 0; tick < 100; tick++) {
        clock += 20;
        vi.advanceTimersByTime(20);
      }
      capture.stop();
      // The steady synthetic loop has energy but no breakdown, so no drop.
      expect(energies.at(-1)).toBeGreaterThan(0.05);
      expect(drops.every((d) => d === 0)).toBe(true);
    } finally {
      vi.useRealTimers();
      now.mockRestore();
    }
  });
});
