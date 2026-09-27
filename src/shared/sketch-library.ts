/**
 * Pure pieces of the sketch browser and its thumbnails: name checks, fuzzy
 * filtering, sort order, grid navigation, frame cropping and the batch plan.
 * No DOM and no file system, so all of it is unit-tested.
 */

/** Thumbnails are this size, 16:9, cropped to cover. */
export const THUMB_WIDTH = 320;
export const THUMB_HEIGHT = 180;
/** How many recently opened sketches are remembered. */
export const RECENT_LIMIT = 200;

/** Sketch names are file stems: letters, digits, `_` and `-`, nothing that walks a path. */
export function isSketchName(name: unknown): name is string {
  return typeof name === "string" && /^[\w-]+$/.test(name);
}

export const isChallengeSketch = (name: string) => name.startsWith("challenge-");

// --- Fuzzy filter --------------------------------------------------------------

export interface FuzzyMatch {
  score: number;
  /** Indices of the matched characters in the name, for highlighting. */
  indices: number[];
}

const isBoundary = (name: string, i: number) => i === 0 || /[-_\s.]/.test(name[i - 1]) ||
  (/[a-z]/.test(name[i - 1]) && /[A-Z]/.test(name[i]));

/**
 * Matches `query` as a case-insensitive subsequence of `name`, preferring
 * prefixes, word starts (after `-` or `_`) and consecutive runs; gaps and
 * long names cost a little. Returns null when it doesn't match. Spaces in the
 * query are ignored, so "ch lava" finds "challenge-…-lava-lamp".
 */
export function fuzzyMatch(query: string, name: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, indices: [] };
  const lower = name.toLowerCase();
  // Best score for matching q[0..qi] with q[qi] at name[ni], by dynamic programming,
  // so "lamp" in "lava-lamp" picks the word start rather than the first "l".
  const n = lower.length, m = q.length;
  if (m > n) return null;
  const NONE = -Infinity;
  const score: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(NONE));
  const from: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(-1));
  for (let qi = 0; qi < m; qi++) {
    for (let ni = qi; ni < n; ni++) {
      if (lower[ni] !== q[qi]) continue;
      let bonus = 1;
      if (ni === 0) bonus += 8;
      else if (isBoundary(name, ni)) bonus += 5;
      if (qi === 0) {
        score[qi][ni] = bonus - Math.min(ni, 6) * 0.5;
        continue;
      }
      for (let pi = qi - 1; pi < ni; pi++) {
        const prev = score[qi - 1][pi];
        if (prev === NONE) continue;
        const gap = ni - pi - 1;
        const s = prev + bonus + (gap === 0 ? 4 : -Math.min(gap, 8) * 0.3);
        if (s > score[qi][ni]) { score[qi][ni] = s; from[qi][ni] = pi; }
      }
    }
  }
  let best = NONE, end = -1;
  for (let ni = 0; ni < n; ni++) if (score[m - 1][ni] > best) { best = score[m - 1][ni]; end = ni; }
  if (end < 0) return null;
  const indices: number[] = [];
  for (let qi = m - 1, ni = end; qi >= 0; ni = from[qi][ni], qi--) indices.unshift(ni);
  return { score: best - (n - m) * 0.05, indices };
}

/**
 * Filters `names` (already in display order) by `query`: best matches first,
 * ties keeping the display order. An empty query keeps everything as is.
 */
export function fuzzyFilter(query: string, names: readonly string[]): { name: string; indices: number[] }[] {
  if (!query.trim()) return names.map((name) => ({ name, indices: [] }));
  return names
    .map((name, order) => ({ name, order, match: fuzzyMatch(query, name) }))
    .filter((r): r is { name: string; order: number; match: FuzzyMatch } => r.match !== null)
    .sort((a, b) => b.match.score - a.match.score || a.order - b.order)
    .map(({ name, match }) => ({ name, indices: match.indices }));
}

// --- Order and visibility --------------------------------------------------------

export type SortMode = "recent" | "name";

const byName = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

/**
 * Display order. "recent": sketches opened recently first, most recent at the
 * front, then the rest alphabetically. "name": alphabetical, numbers in order.
 */
export function sortSketches(names: readonly string[], recent: readonly string[], mode: SortMode): string[] {
  const alphabetical = [...names].sort(byName);
  if (mode === "name") return alphabetical;
  const present = new Set(names);
  const seen = new Set<string>();
  const first = recent.filter((n) => present.has(n) && !seen.has(n) && seen.add(n));
  return [...first, ...alphabetical.filter((n) => !seen.has(n))];
}

/** Hides challenge attempts unless asked; the open sketch always shows. */
export function visibleSketches(names: readonly string[], showChallenges: boolean, current = ""): string[] {
  return showChallenges ? [...names] : names.filter((n) => !isChallengeSketch(n) || n === current);
}

/** Moves `name` to the front of the recent list, without duplicates, capped. */
export function noteRecent(recent: readonly string[], name: string, limit = RECENT_LIMIT): string[] {
  return [name, ...recent.filter((n) => n !== name)].slice(0, limit);
}

/** After a rename: `to` takes `from`'s place, and loses any older place of its own. */
export function renameRecent(recent: readonly string[], from: string, to: string): string[] {
  if (from === to) return [...recent];
  const out: string[] = [];
  for (const n of recent) {
    const name = n === from ? to : n;
    if (n === to || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

// --- Grid navigation ---------------------------------------------------------

export type Move = "left" | "right" | "up" | "down" | "home" | "end" | "pageup" | "pagedown";

/**
 * The next selected index in a row-major grid of `count` cards and `columns`
 * columns. Left/right step through the list (crossing rows); up/down move a
 * row, and down from a row above a shorter last row lands on its last card.
 * Page moves go `rows` rows. Selection stays put at the edges.
 */
export function moveSelection(index: number, count: number, columns: number, move: Move, rows = 3): number {
  if (count <= 0) return -1;
  const cols = Math.max(1, Math.floor(columns));
  const i = Math.min(Math.max(index, 0), count - 1);
  const last = count - 1;
  const down = (by: number) => {
    const target = i + by * cols;
    if (target <= last) return target;
    // Only drop to the last card if it is on a lower row.
    return Math.floor(last / cols) > Math.floor(i / cols) ? last : i;
  };
  switch (move) {
    case "left": return Math.max(0, i - 1);
    case "right": return Math.min(last, i + 1);
    case "up": return i - cols >= 0 ? i - cols : i;
    case "down": return down(1);
    case "pageup": return Math.max(i - rows * cols, i % cols);
    case "pagedown": return down(Math.max(1, rows));
    case "home": return 0;
    case "end": return last;
  }
}

// --- Thumbnails ---------------------------------------------------------------

export interface Rect { x: number; y: number; width: number; height: number }

/** The centred source rectangle of a `width`×`height` frame that covers a `tw`×`th` thumbnail. */
export function coverRect(width: number, height: number, tw = THUMB_WIDTH, th = THUMB_HEIGHT): Rect {
  const target = tw / th;
  if (width / height > target) {
    const w = Math.round(height * target);
    return { x: Math.floor((width - w) / 2), y: 0, width: w, height };
  }
  const h = Math.round(width / target);
  return { x: 0, y: Math.floor((height - h) / 2), width, height: h };
}

/**
 * True when every sampled pixel of a 4-byte-per-pixel frame (RGBA or BGRA) is
 * transparent or all but black (no channel above 12, which covers Ao's
 * #020208 page background): a sketch that failed to run, or a WebGL buffer
 * read after it was cleared. Such frames never replace a thumbnail.
 */
export function isBlankFrame(pixels: ArrayLike<number>, step = 7): boolean {
  for (let p = 0; p + 3 < pixels.length; p += 4 * step) {
    if (pixels[p + 3] > 0 && Math.max(pixels[p], pixels[p + 1], pixels[p + 2]) > 12) return false;
  }
  return true;
}

/** Two hues (degrees) derived from the name, for a sketch's placeholder gradient. */
export function placeholderHues(name: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  const a = h % 360;
  return [a, (a + 40 + ((h >>> 9) % 100)) % 360];
}

export interface ThumbnailPlan {
  /** Sketches to render, in order. */
  render: string[];
  /** Sketches that already have a thumbnail. */
  skip: string[];
  /** Thumbnails whose sketch no longer exists. */
  prune: string[];
}

/**
 * What a batch run does: render sketches without a thumbnail (all of them if
 * `force`), and prune thumbnails of sketches that are gone. `only` limits the
 * run to the named sketches.
 */
export function planThumbnails(sketches: readonly string[], existing: readonly string[], force = false, only: readonly string[] = []): ThumbnailPlan {
  const have = new Set(existing);
  const wanted = only.length ? sketches.filter((s) => only.includes(s)) : [...sketches];
  const all = new Set(sketches);
  return {
    render: wanted.filter((s) => force || !have.has(s)),
    skip: wanted.filter((s) => !force && have.has(s)),
    prune: existing.filter((t) => !all.has(t)),
  };
}
