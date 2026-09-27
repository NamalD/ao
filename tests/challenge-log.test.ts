import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendChallenge, readChallenges, saveChallenge } from "../src/main/challenge-log";
import { Store } from "../src/main/store";
import { challengeRecord, challengeResult } from "../src/shared/challenges";

const tempStore = () => new Store(mkdtempSync(join(tmpdir(), "ao-challenges-")));
const result = (sketch: string, finishedEarly = false) => challengeResult(
  [{ bucket: "recreate", text: "a lava lamp" }, { bucket: "constraint", text: "at most 3 lines of code" }],
  sketch, 10, new Date("2026-09-27T10:00:00Z"), new Date("2026-09-27T10:10:00Z"), finishedEarly);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("challenge log", () => {
  it("starts empty and appends records in order", () => {
    const store = tempStore();
    expect(readChallenges(store)).toEqual([]);
    const a = challengeRecord(result("challenge-a"), null);
    const b = challengeRecord(result("challenge-b"), "state/challenges/challenge-b.png");
    appendChallenge(store, a);
    appendChallenge(store, b);
    expect(readChallenges(store)).toEqual([a, b]);
    expect(JSON.parse(readFileSync(join(store.stateDir, "challenges.json"), "utf8"))).toEqual({ challenges: [a, b] });
  });

  it("keeps a corrupt log aside instead of overwriting it", () => {
    const store = tempStore();
    writeFileSync(join(store.stateDir, "challenges.json"), "{ not json");
    const a = challengeRecord(result("challenge-a"), null);
    appendChallenge(store, a);
    expect(readChallenges(store)).toEqual([a]);
    const aside = readdirSync(store.stateDir).filter((f) => f.startsWith("challenges.corrupt-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(store.stateDir, aside[0]), "utf8")).toBe("{ not json");
  });

  it("saves the snapshot and the record with its duration", async () => {
    const store = tempStore();
    const record = await saveChallenge(store, result("challenge-2026-09-27-lava-lamp", true), async () => png);
    expect(record).toMatchObject({
      sketch: "challenge-2026-09-27-lava-lamp", durationSeconds: 600, finishedEarly: true, timeBoxMinutes: 10,
      snapshot: "state/challenges/challenge-2026-09-27-lava-lamp.png",
      items: [{ bucket: "recreate", text: "a lava lamp" }, { bucket: "constraint", text: "at most 3 lines of code" }],
    });
    expect(readFileSync(join(store.stateDir, "challenges", "challenge-2026-09-27-lava-lamp.png"))).toEqual(png);
    expect(readChallenges(store)).toEqual([record]);
  });

  it("records the attempt without a snapshot when capture fails", async () => {
    const store = tempStore();
    const record = await saveChallenge(store, result("challenge-x"), async () => { throw new Error("no window"); });
    expect(record.snapshot).toBeNull();
    expect(readChallenges(store)).toEqual([record]);
    expect(readFileSync(store.logPath, "utf8")).toMatch(/challenge snapshot failed: no window/);
  });

  it("rejects an invalid result before writing anything", async () => {
    const store = tempStore();
    await expect(saveChallenge(store, { ...result("x"), sketch: "../../etc/x" }, async () => png)).rejects.toThrow(/sketch name/);
    expect(existsSync(join(store.stateDir, "challenges.json"))).toBe(false);
    expect(existsSync(join(store.stateDir, "challenges"))).toBe(false);
  });
});
