import { describe, expect, it } from "vitest";
import {
  AutopilotScheduler, defaultAutopilot, isEmptySketch, normalizeAutopilot, ShuffleBag, shuffleable,
} from "../src/shared/autopilot";
import type { SectionEvent } from "../src/shared/sections";

/** A repeatable random source. */
function seeded(seed = 1): () => number {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe("ShuffleBag", () => {
  const names = ["aurora", "dunes", "halo", "ink", "prism", "rothko"];

  it("plays every sketch once per round, never the current one twice in a row", () => {
    const bag = new ShuffleBag(seeded(7));
    let current = "aurora";
    const played: string[] = [];
    for (let i = 0; i < 60; i++) {
      const next = bag.next(names, current)!;
      expect(next).not.toBe(current);
      played.push(next);
      current = next;
    }
    // Every window of a round's length (minus the skipped current) repeats nothing.
    for (let i = 0; i + 5 <= played.length; i += 5) {
      const round = played.slice(i, i + 5);
      expect(new Set(round).size).toBe(round.length);
    }
    expect(new Set(played)).toEqual(new Set(names));
  });

  it("differs from round to round", () => {
    const bag = new ShuffleBag(seeded(3));
    const rounds = new Set<string>();
    let current = "";
    for (let r = 0; r < 10; r++) {
      const round: string[] = [];
      for (let i = 0; i < names.length - (r === 0 ? 0 : 1); i++) round.push((current = bag.next(names, current)!));
      rounds.add(round.join());
    }
    expect(rounds.size).toBeGreaterThan(5);
  });

  it("leaves out challenge attempts and follows sketches coming and going", () => {
    const bag = new ShuffleBag(seeded(5));
    const withChallenges = [...names, "challenge-2026-09-01-lava-lamp"];
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(bag.next(withChallenges)!);
    expect([...seen].some((n) => n.startsWith("challenge-"))).toBe(false);
    // "halo" is deleted mid-round; "new" appears.
    const changed = names.filter((n) => n !== "halo").concat("new");
    const next = new Set<string>();
    for (let i = 0; i < 12; i++) next.add(bag.next(changed)!);
    expect(next.has("halo")).toBe(false);
    expect(next.has("new")).toBe(true);
  });

  it("has nothing to offer with one sketch or none", () => {
    const bag = new ShuffleBag();
    expect(bag.next(["prism"], "prism")).toBeUndefined();
    expect(bag.next([], "")).toBeUndefined();
    expect(bag.next(["challenge-x", "prism"], "prism")).toBeUndefined();
    expect(bag.next(["prism"], "")).toBe("prism");
  });

  it("can skip a sketch for the rest of the round", () => {
    const bag = new ShuffleBag(seeded(2));
    const first = bag.next(names, "")!;
    const remaining = names.filter((n) => n !== first);
    bag.skip(remaining[0]);
    const rest = [1, 2, 3, 4].map(() => bag.next(names, "")!);
    expect(rest).not.toContain(remaining[0]);
  });
});

describe("shuffle eligibility", () => {
  it("excludes challenges", () => {
    expect(shuffleable("prism")).toBe(true);
    expect(shuffleable("challenge-2026-01-01-heartbeat")).toBe(false);
  });

  it("treats whitespace and comments as empty", () => {
    expect(isEmptySketch("")).toBe(true);
    expect(isEmptySketch("  \n\t\n")).toBe(true);
    expect(isEmptySketch("// Challenge: a lava lamp\n/* 10 minutes */\n")).toBe(true);
    expect(isEmptySketch("osc().out()")).toBe(false);
    expect(isEmptySketch("// title\nosc().out() // go")).toBe(false);
  });
});

describe("normalizeAutopilot", () => {
  it("defaults, clamps and keeps valid values", () => {
    expect(normalizeAutopilot(undefined)).toEqual(defaultAutopilot);
    expect(normalizeAutopilot({ enabled: "yes", dwellSeconds: -3, fadeSeconds: 500 }))
      .toEqual({ ...defaultAutopilot, dwellSeconds: 5, fadeSeconds: 60 });
    expect(normalizeAutopilot({ enabled: true, fadeSeconds: 0, switchOnSections: false }))
      .toEqual({ ...defaultAutopilot, enabled: true, fadeSeconds: 0, switchOnSections: false });
  });
});

describe("AutopilotScheduler", () => {
  const drop = (strength: number, time = 0): SectionEvent => ({ kind: "drop", time, strength, detail: "" });
  const change = (time = 0): SectionEvent => ({ kind: "change", time, strength: 0.5, detail: "" });
  const breakdown = (time = 0): SectionEvent => ({ kind: "breakdown", time, strength: 0.5, detail: "" });
  const make = (start = 0) => new AutopilotScheduler({ dwellSeconds: 120, minSeconds: 45, switchOnSections: true }, start);

  it("switches on the dwell timer", () => {
    const s = make(1000);
    expect(s.tick(1000 + 119.9)).toBeNull();
    expect(s.tick(1000 + 120)).toBe("timer");
    s.switched(1120);
    expect(s.tick(1200)).toBeNull();
    expect(s.tick(1240)).toBe("timer");
  });

  it("switches on a section change or drop once minSeconds have passed", () => {
    const s = make();
    expect(s.event(change(), 44)).toBeNull();
    expect(s.event(change(), 45)).toBe("change");
    expect(s.event(drop(0.3), 46)).toBe("drop");
  });

  it("lets a strong drop through early, but not right after a switch", () => {
    const s = make();
    expect(s.event(drop(0.9), 10)).toBeNull();
    expect(s.event(drop(0.5), 20)).toBeNull();
    expect(s.event(drop(0.9), 20)).toBe("drop");
  });

  it("doesn't switch on a breakdown: it waits for the drop", () => {
    expect(make().event(breakdown(), 100)).toBeNull();
  });

  it("ignores sections when switchOnSections is off, but keeps the timer", () => {
    const s = new AutopilotScheduler({ dwellSeconds: 60, minSeconds: 45, switchOnSections: false }, 0);
    expect(s.event(drop(1), 50)).toBeNull();
    expect(s.event(change(), 59)).toBeNull();
    expect(s.tick(60)).toBe("timer");
  });

  it("holds off while the user is editing, and resumes a minute after the last keystroke", () => {
    const s = make();
    s.setEditorVisible(true);
    s.edited(100);
    expect(s.paused(130)).toBe(true);
    expect(s.tick(130)).toBeNull();
    expect(s.event(drop(1), 130)).toBeNull();
    expect(s.event(change(), 150)).toBeNull();
    // The dwell is long past, so the switch comes as soon as the pause ends.
    expect(s.tick(159.9)).toBeNull();
    expect(s.tick(160)).toBe("timer");
  });

  it("doesn't pause for typing it can't see, or long ago", () => {
    const s = make();
    s.edited(100);
    expect(s.paused(101)).toBe(false); // editor hidden
    s.setEditorVisible(true);
    expect(s.paused(101)).toBe(true);
    expect(s.paused(200)).toBe(false);
    expect(s.event(change(), 200)).toBe("change");
  });

  it("can be reconfigured without losing its clock", () => {
    const s = make();
    s.configure({ dwellSeconds: 30 });
    expect(s.tick(30)).toBe("timer");
    expect(s.elapsed(30)).toBe(30);
  });
});
