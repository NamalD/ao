import { describe, expect, it } from "vitest";
import { BUCKETS, type Bucket, PROMPTS } from "../src/shared/challenge-prompts";
import {
  challengeHeader, challengeRecord, challengeResult, challengeSketchName, formatRemaining,
  generateChallenge, localDate, seededRng, slugify, validateResult,
} from "../src/shared/challenges";

/** An RNG that replays fixed values, failing loudly if asked for more. */
function scripted(values: number[]) {
  let i = 0;
  const rng = () => {
    if (i >= values.length) throw new Error("RNG exhausted");
    return values[i++];
  };
  return Object.assign(rng, { used: () => i });
}

describe("prompt buckets", () => {
  it("has at least 15 distinct, non-empty prompts per bucket", () => {
    for (const bucket of BUCKETS) {
      const texts = PROMPTS[bucket].map((p) => p.text);
      expect(texts.length).toBeGreaterThanOrEqual(15);
      expect(new Set(texts).size).toBe(texts.length);
      for (const p of PROMPTS[bucket]) {
        expect(p.text.trim()).toBe(p.text);
        expect(p.text.length).toBeGreaterThan(3);
        if (p.hint !== undefined) expect(p.hint.length).toBeGreaterThan(3);
      }
    }
  });

  it("gives every technique drill a hint", () => {
    expect(PROMPTS.technique.every((p) => p.hint)).toBe(true);
  });
});

describe("generateChallenge", () => {
  it("stops after one item when the first extension roll fails", () => {
    // bucket index, item index, extension roll (0.5 is not < 1/2)
    const rng = scripted([0, 0, 0.5]);
    const items = generateChallenge(rng);
    expect(items).toEqual([{ bucket: "recreate", ...PROMPTS.recreate[0] }]);
    expect(rng.used()).toBe(3);
  });

  it("follows the halving chain: 1/2, then 1/4, then 1/8", () => {
    // 2nd: 0.49 < 1/2; 3rd: 0.24 < 1/4; 4th: 0.124 < 1/8
    const all = generateChallenge(scripted([0, 0, 0.49, 0, 0, 0.24, 0, 0, 0.124, 0, 0]));
    expect(all.map((i) => i.bucket)).toEqual(["recreate", "constraint", "audio-reactive", "technique"]);
    // The 3rd roll must beat 1/4, not 1/2.
    expect(generateChallenge(scripted([0, 0, 0.49, 0, 0, 0.26])).length).toBe(2);
    // The 4th roll must beat 1/8.
    expect(generateChallenge(scripted([0, 0, 0.49, 0, 0, 0.24, 0, 0, 0.126])).length).toBe(3);
  });

  it("never asks for a fifth item once every bucket is used", () => {
    const rng = scripted([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(generateChallenge(rng).length).toBe(4);
    expect(rng.used()).toBe(11);
  });

  it("draws later items only from unused buckets", () => {
    // Always choosing the last remaining bucket: technique, audio-reactive, constraint, recreate.
    const items = generateChallenge(scripted([0.99, 0.99, 0, 0.99, 0.99, 0, 0.99, 0.99, 0, 0.99, 0.99]));
    expect(items.map((i) => i.bucket)).toEqual(["technique", "audio-reactive", "constraint", "recreate"]);
    expect(items[0]).toEqual({ bucket: "technique", ...PROMPTS.technique.at(-1) });
  });

  it("tolerates an RNG that returns exactly 1", () => {
    const items = generateChallenge(scripted([1, 1, 0.9]));
    expect(items).toEqual([{ bucket: "technique", ...PROMPTS.technique.at(-1) }]);
  });

  it("skips empty buckets", () => {
    const prompts = { recreate: [], constraint: [{ text: "c" }], "audio-reactive": [], technique: [{ text: "t" }] };
    for (let seed = 0; seed < 200; seed++) {
      const buckets = generateChallenge(seededRng(seed), prompts).map((i) => i.bucket);
      expect(buckets.every((b) => b === "constraint" || b === "technique")).toBe(true);
    }
  });

  it("is deterministic for a seeded RNG", () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(generateChallenge(seededRng(seed))).toEqual(generateChallenge(seededRng(seed)));
    }
    const draws = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(generateChallenge(seededRng(s)))));
    expect(draws.size).toBeGreaterThan(15);
  });

  it("always uses distinct buckets, and its item counts and buckets match the rule over many draws", () => {
    const rng = seededRng(12345);
    const n = 200_000;
    const counts = [0, 0, 0, 0, 0];
    const firstBucket: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const items = generateChallenge(rng);
      const buckets = items.map((it) => it.bucket);
      expect(new Set(buckets).size).toBe(buckets.length);
      for (const item of items) expect(PROMPTS[item.bucket as Bucket].some((p) => p.text === item.text)).toBe(true);
      counts[items.length]++;
      firstBucket[buckets[0]] = (firstBucket[buckets[0]] ?? 0) + 1;
    }
    // P(1) = 1/2, P(2) = 1/2 · 3/4, P(3) = 1/2 · 1/4 · 7/8, P(4) = 1/2 · 1/4 · 1/8
    const expected = [0, 1 / 2, 3 / 8, 7 / 64, 1 / 64];
    expect(counts[0]).toBe(0);
    for (let k = 1; k <= 4; k++) expect(Math.abs(counts[k] / n - expected[k])).toBeLessThan(0.005);
    for (const bucket of BUCKETS) expect(Math.abs(firstBucket[bucket] / n - 0.25)).toBeLessThan(0.01);
  });
});

describe("challenge sketches", () => {
  const items = [
    { bucket: "recreate" as const, text: "a Bridget Riley op-art stripe field" },
    { bucket: "constraint" as const, text: "at most 3 lines of code" },
  ];
  const date = new Date(2026, 8, 7, 23, 30);

  it("slugs the meaningful words of a prompt", () => {
    expect(slugify("a lava lamp")).toBe("lava-lamp");
    expect(slugify("a Bridget Riley op-art stripe field")).toBe("bridget-riley-op-art");
    expect(slugify("the only audio value you may use is ao.impulse")).toBe("audio-value-you-may-use");
    expect(slugify("!!!")).toBe("attempt");
    expect(slugify("supercalifragilisticexpialidocious")).toBe("supercalifragilisticexpi");
  });

  it("names sketches by local date and slug, avoiding existing names", () => {
    expect(localDate(date)).toBe("2026-09-07");
    const name = challengeSketchName(items, date);
    expect(name).toBe("challenge-2026-09-07-bridget-riley-op-art");
    expect(name).toMatch(/^[\w-]+$/);
    expect(challengeSketchName(items, date, [name, `${name}-2`])).toBe(`${name}-3`);
  });

  it("names every prompt validly", () => {
    for (const bucket of BUCKETS) {
      for (const p of PROMPTS[bucket]) expect(challengeSketchName([{ bucket, ...p }], date)).toMatch(/^challenge-2026-09-07-[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("seeds the sketch with the prompt as a comment header", () => {
    expect(challengeHeader(items, 10, date)).toBe(
      "// Challenge, 10 min, 2026-09-07\n" +
      "//   recreate:   a Bridget Riley op-art stripe field\n" +
      "//   constraint: at most 3 lines of code\n\n");
  });

  it("formats the countdown", () => {
    expect(formatRemaining(600_000)).toBe("10:00");
    expect(formatRemaining(545_000)).toBe("9:05");
    expect(formatRemaining(100)).toBe("0:01");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-5)).toBe("0:00");
  });
});

describe("challenge records", () => {
  const items = [{ bucket: "technique" as const, text: "masks", hint: "mask()" }];
  const start = new Date("2026-09-27T10:00:00Z");
  const end = new Date("2026-09-27T10:04:30.400Z");

  it("builds a result without hints and a record with the duration", () => {
    const result = challengeResult(items, "challenge-x", 5, start, end, true);
    expect(result).toEqual({
      sketch: "challenge-x", items: [{ bucket: "technique", text: "masks" }],
      startedAt: "2026-09-27T10:00:00.000Z", endedAt: "2026-09-27T10:04:30.400Z",
      timeBoxMinutes: 5, finishedEarly: true,
    });
    expect(challengeRecord(result, "state/challenges/challenge-x.png")).toEqual({
      ...result, durationSeconds: 270, snapshot: "state/challenges/challenge-x.png",
    });
  });

  it("validates results from the renderer", () => {
    const good = challengeResult(items, "challenge-x", 5, start, end, false);
    expect(validateResult({ ...good, extra: "dropped" })).toEqual(good);
    expect(() => validateResult(null)).toThrow(/not an object/);
    expect(() => validateResult({ ...good, sketch: "../x" })).toThrow(/sketch name/);
    expect(() => validateResult({ ...good, items: [] })).toThrow(/items/);
    expect(() => validateResult({ ...good, items: [{ bucket: "nope", text: "x" }] })).toThrow(/item/);
    expect(() => validateResult({ ...good, endedAt: "2026-09-27T09:00:00Z" })).toThrow(/times/);
    expect(() => validateResult({ ...good, timeBoxMinutes: 0 })).toThrow(/time box/);
    expect(() => validateResult({ ...good, finishedEarly: "yes" })).toThrow(/finishedEarly/);
  });
});
