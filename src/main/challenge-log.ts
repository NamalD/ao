import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { challengeRecord, type ChallengeRecord, validateResult } from "../shared/challenges";
import type { Store } from "./store";

const LOG = "challenges";

/** Past challenges, oldest first, from state/challenges.json. */
export function readChallenges(store: Store): ChallengeRecord[] {
  const { challenges } = store.read<{ challenges: unknown }>(LOG, { challenges: [] });
  return Array.isArray(challenges) ? challenges : [];
}

/** Appends one record to state/challenges.json, keeping a corrupt file aside rather than losing it. */
export function appendChallenge(store: Store, record: ChallengeRecord): void {
  const path = join(store.stateDir, `${LOG}.json`);
  if (existsSync(path)) {
    let intact = false;
    try {
      intact = Array.isArray(JSON.parse(readFileSync(path, "utf8")).challenges);
    } catch {
      // Unreadable: moved aside below.
    }
    if (!intact) renameSync(path, join(store.stateDir, `${LOG}.corrupt-${Date.now()}.json`));
  }
  store.write(LOG, { challenges: [...readChallenges(store), record] });
}

/**
 * Ends a challenge: saves a PNG of the visuals to state/challenges/<sketch>.png
 * and appends the record. A failed capture still records the attempt, with a
 * null snapshot, and is logged.
 */
export async function saveChallenge(store: Store, result: unknown, capture: () => Promise<Buffer>): Promise<ChallengeRecord> {
  const clean = validateResult(result);
  let snapshot: string | null = `state/challenges/${clean.sketch}.png`;
  try {
    const png = await capture();
    mkdirSync(join(store.stateDir, "challenges"), { recursive: true });
    writeFileSync(join(store.stateDir, "challenges", `${clean.sketch}.png`), png);
  } catch (error) {
    store.log(`challenge snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    snapshot = null;
  }
  const record = challengeRecord(clean, snapshot);
  appendChallenge(store, record);
  return record;
}
