/**
 * Challenge mode's pure logic: drawing a challenge from the prompt buckets,
 * naming and seeding its sketch, and the record kept once it ends.
 */
import { BUCKETS, type Bucket, type Prompt, PROMPTS } from "./challenge-prompts";

export type { Bucket, Prompt } from "./challenge-prompts";

/** A random number in [0, 1), like Math.random. */
export type Rng = () => number;

export interface ChallengeItem extends Prompt {
  bucket: Bucket;
}

export const TIME_BOXES = [5, 10, 20] as const;
export const DEFAULT_TIME_BOX = 10;

function pick<T>(items: readonly T[], rng: Rng): T {
  // Clamp so an RNG that returns exactly 1 can't index past the end.
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/**
 * One random item from one random bucket. Then, with halving chances, one
 * more item from a bucket not yet used: a 2nd with probability 1/2, a 3rd
 * with 1/4 (only after a 2nd), a 4th with 1/8 (only after a 3rd).
 */
export function generateChallenge(rng: Rng = Math.random, prompts: Record<Bucket, readonly Prompt[]> = PROMPTS): ChallengeItem[] {
  const unused = BUCKETS.filter((bucket) => prompts[bucket].length > 0);
  const items: ChallengeItem[] = [];
  let chance = 1;
  while (unused.length > 0) {
    if (items.length > 0) {
      chance /= 2;
      if (rng() >= chance) break;
    }
    const bucket = unused.splice(Math.min(unused.length - 1, Math.floor(rng() * unused.length)), 1)[0];
    items.push({ bucket, ...pick(prompts[bucket], rng) });
  }
  return items;
}

/** A small seeded RNG (mulberry32), for reproducible draws in tests. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILLER = new Set(["a", "an", "the", "of", "on", "in", "at", "and", "with", "to", "by", "via", "as", "no", "only", "one"]);

/** A few meaningful words of a prompt, lowercase and hyphenated. */
export function slugify(text: string, maxLength = 24): string {
  const words = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const meaningful = words.filter((w) => !FILLER.has(w));
  let slug = "";
  for (const word of meaningful.length ? meaningful : words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > maxLength) break;
    slug = next;
  }
  return slug || (words[0] ?? "").slice(0, maxLength) || "attempt";
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `challenge-YYYY-MM-DD-<slug>`, suffixed -2, -3, … if a sketch already has that name. */
export function challengeSketchName(items: readonly ChallengeItem[], date: Date, existing: readonly string[] = []): string {
  const base = `challenge-${localDate(date)}-${slugify(items[0]?.text ?? "")}`;
  let name = base;
  for (let n = 2; existing.includes(name); n++) name = `${base}-${n}`;
  return name;
}

/** The comment header a challenge sketch starts with. */
export function challengeHeader(items: readonly ChallengeItem[], minutes: number, date: Date): string {
  const width = Math.max(...items.map((item) => item.bucket.length));
  const lines = items.map((item) => `//   ${`${item.bucket}:`.padEnd(width + 1)} ${item.text}`);
  return [`// Challenge, ${minutes} min, ${localDate(date)}`, ...lines, "", ""].join("\n");
}

/** "9:05" for 545 000 ms; rounds up so the display reaches 0:00 only at the end. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** What the renderer reports when a challenge ends. */
export interface ChallengeResult {
  sketch: string;
  items: { bucket: Bucket; text: string }[];
  startedAt: string;
  endedAt: string;
  timeBoxMinutes: number;
  finishedEarly: boolean;
}

/** One entry in state/challenges.json. */
export interface ChallengeRecord extends ChallengeResult {
  durationSeconds: number;
  /** PNG of the visuals at the end, relative to the project root; null if capture failed. */
  snapshot: string | null;
}

export function challengeResult(
  items: readonly ChallengeItem[], sketch: string, timeBoxMinutes: number,
  startedAt: Date, endedAt: Date, finishedEarly: boolean,
): ChallengeResult {
  return {
    sketch,
    items: items.map(({ bucket, text }) => ({ bucket, text })),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    timeBoxMinutes,
    finishedEarly,
  };
}

const isBucket = (value: unknown): value is Bucket => BUCKETS.includes(value as Bucket);

/** Checks a result that crossed the IPC boundary; returns a clean copy or throws. */
export function validateResult(value: unknown): ChallengeResult {
  const r = value as Partial<ChallengeResult> | null;
  const fail = (why: string): never => { throw new Error(`invalid challenge result: ${why}`); };
  if (!r || typeof r !== "object") fail("not an object");
  if (typeof r!.sketch !== "string" || !/^[\w-]+$/.test(r!.sketch)) fail("sketch name");
  if (!Array.isArray(r!.items) || r!.items.length === 0) fail("items");
  const items = r!.items!.map((item) => {
    if (!item || !isBucket(item.bucket) || typeof item.text !== "string") fail("item");
    return { bucket: item.bucket, text: item.text };
  });
  const started = Date.parse(String(r!.startedAt)), ended = Date.parse(String(r!.endedAt));
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) fail("times");
  if (typeof r!.timeBoxMinutes !== "number" || !(r!.timeBoxMinutes > 0)) fail("time box");
  if (typeof r!.finishedEarly !== "boolean") fail("finishedEarly");
  return {
    sketch: r!.sketch!, items, startedAt: r!.startedAt!, endedAt: r!.endedAt!,
    timeBoxMinutes: r!.timeBoxMinutes!, finishedEarly: r!.finishedEarly!,
  };
}

export function challengeRecord(result: ChallengeResult, snapshot: string | null): ChallengeRecord {
  const durationSeconds = Math.round((Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 1000);
  return { ...result, durationSeconds, snapshot };
}
