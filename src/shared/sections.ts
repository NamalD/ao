import type { AudioFeatures } from "./features";

/**
 * Musical section detection for autopilot: drops, breakdowns and changes of
 * timbre, from the feature stream alone. Pure and time-based (it reads
 * `features.time`), so it doesn't care how often features arrive and can be
 * tested with synthetic sequences.
 *
 * - **breakdown**: the energy (loudness and bass together) falls well below
 *   its recent level and stays there, while the music keeps playing.
 * - **drop**: after a breakdown, the energy jumps back up abruptly and holds.
 *   A slow recovery isn't a drop; neither is a single hit in the lull.
 * - **change**: the spectral shape over the last few seconds differs from
 *   that of the last half minute (a new section or instrument), or the
 *   music comes back after a silence (a new track).
 *
 * Nothing fires in silence, and every event has hysteresis: a breakdown must
 * end before another can start, and a change must settle before another.
 * Deciding whether an event is worth a switch is the scheduler's job.
 */

export type SectionKind = "drop" | "breakdown" | "change";

export interface SectionEvent {
  kind: SectionKind;
  /** `features.time` when it fired, seconds. */
  time: number;
  /** How pronounced it was, 0..1. */
  strength: number;
  /** A few words on why, for the log. */
  detail: string;
}

export interface SectionOptions {
  /** Time constants of the energy followers, seconds. */
  fastTau: number;
  midTau: number;
  longTau: number;
  /** Time constants of the short and long spectral shapes, seconds. */
  shapeShortTau: number;
  shapeLongTau: number;
  /** Energy (fast follower) below which the music counts as silent, and above which it's back. */
  silenceLevel: number;
  resumeLevel: number;
  /** Energy must stay below `silenceLevel` this long to count as silence, seconds. */
  silenceHold: number;
  /** Silence at least this long forgets the music before it, and the music after is a "change" (new track). */
  resumeAfter: number;
  /** A breakdown: mid energy below this fraction of the long level for `breakdownHold` seconds... */
  breakdownRatio: number;
  breakdownHold: number;
  /** ...when the long level was at least this, i.e. there was music to break down from. */
  breakdownFloor: number;
  /** A drop: fast energy back above this fraction of the pre-breakdown level... */
  dropRecover: number;
  /** ...and at least this many times the lull's level... */
  dropRatio: number;
  /** ...rising abruptly (fast follower this far above the mid follower when it crosses)... */
  dropAbrupt: number;
  /** ...and holding for this long, seconds. */
  dropHold: number;
  /** A breakdown that lasts longer than this is the new normal: no drop is expected. */
  lullTimeout: number;
  /** Spectral novelty (RMS change of the level shape) that fires a change, and that re-arms it. */
  noveltyOn: number;
  noveltyOff: number;
  /** Novelty must stay above `noveltyOn` this long, seconds. */
  noveltyHold: number;
  /** Seconds of music needed before the long shape means anything. */
  warmup: number;
  /** No change fires within this long after a breakdown ends (the drop already told). */
  changeQuiet: number;
}

export const defaultSectionOptions: SectionOptions = {
  fastTau: 0.25, midTau: 2, longTau: 15,
  shapeShortTau: 3, shapeLongTau: 30,
  silenceLevel: 0.03, resumeLevel: 0.06, silenceHold: 0.5, resumeAfter: 3,
  breakdownRatio: 0.6, breakdownHold: 1.5, breakdownFloor: 0.12,
  dropRecover: 0.8, dropRatio: 1.5, dropAbrupt: 1.2, dropHold: 0.3,
  lullTimeout: 90,
  noveltyOn: 0.09, noveltyOff: 0.05, noveltyHold: 2,
  warmup: 20, changeQuiet: 20,
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** One step of an exponential follower with time constant `tau`. */
const approach = (current: number, target: number, dt: number, tau: number) =>
  target + (current - target) * Math.exp(-dt / tau);

interface Lull {
  /** Long energy just before the breakdown: what a drop returns to. */
  before: number;
  /** Lowest mid energy during the lull. */
  floor: number;
  started: number;
}

export class SectionDetector {
  private readonly o: SectionOptions;
  private last: number | null = null;
  private fast = 0;
  private mid = 0;
  private long = 0;
  private shortShape: Float64Array | null = null;
  private longShape: Float64Array | null = null;
  private silent = true;
  /** When the energy first fell below the silence line. */
  private quietSince: number | null = null;
  private everPlayed = false;
  /** Seconds of non-silent music since the start or the last silence. */
  private music = 0;
  /** When the energy first fell below the breakdown line, and the long level then. */
  private below: { since: number; before: number } | null = null;
  private lull: Lull | null = null;
  private recovering: { since: number; abrupt: boolean } | null = null;
  private lullEnded = -Infinity;
  private noveltyArmed = true;
  private noveltySince: number | null = null;
  /** The latest spectral novelty, for inspection and tests. */
  novelty = 0;

  constructor(options: Partial<SectionOptions> = {}) {
    this.o = { ...defaultSectionOptions, ...options };
  }

  /** The energy the detector follows: loudness and bass together. */
  static energy(f: AudioFeatures): number {
    return 0.4 * f.loudness + 0.6 * f.bass;
  }

  /** Feeds one feature frame; returns an event when one fires. */
  push(f: AudioFeatures): SectionEvent | null {
    const o = this.o;
    const now = f.time;
    const first = this.last === null;
    // A gap (a stalled capture) counts as at most a second.
    const dt = first ? 0 : Math.max(0, Math.min(1, now - this.last!));
    this.last = now;
    const e = SectionDetector.energy(f);
    this.fast = first ? e : approach(this.fast, e, dt, o.fastTau);
    this.mid = first ? e : approach(this.mid, e, dt, o.midTau);

    // Silence: nothing fires. A short one (the pause before a drop) keeps
    // what came before; a long one (between tracks) forgets it.
    if (this.silent ? this.fast < o.resumeLevel : this.fast < o.silenceLevel) {
      this.quietSince ??= now;
      if (!this.silent && now - this.quietSince >= o.silenceHold) {
        this.silent = true;
        // Silence mid-song is a lull a drop may end.
        if (!this.lull && this.long >= o.breakdownFloor) {
          this.lull = { before: this.long, floor: o.silenceLevel, started: this.quietSince };
        }
      }
      if (this.silent && now - this.quietSince >= o.resumeAfter && this.music > 0) this.resetMusic();
      if (this.silent) return null;
    } else if (!this.silent) {
      this.quietSince = null;
    }
    let resumed: SectionEvent | null = null;
    if (this.silent) {
      this.silent = false;
      const quiet = now - (this.quietSince ?? now);
      this.quietSince = null;
      // The very first music since start-up isn't a change of anything.
      if (this.everPlayed && quiet >= o.resumeAfter) {
        resumed = { kind: "change", time: now, strength: 0.5, detail: `music after ${quiet.toFixed(0)} s of silence` };
      }
      if (this.music === 0) this.long = this.mid;
      this.everPlayed = true;
    }
    this.music += dt;
    this.long = approach(this.long, this.mid, dt, o.longTau);
    this.updateShapes(f.spectrum, dt);

    return resumed ?? this.energyEvent(now) ?? this.changeEvent(now);
  }

  private resetMusic(): void {
    this.music = 0;
    this.shortShape = this.longShape = null;
    this.below = null;
    this.lull = null;
    this.recovering = null;
    this.noveltyArmed = true;
    this.noveltySince = null;
    this.novelty = 0;
    this.long = 0;
  }

  private energyEvent(now: number): SectionEvent | null {
    const o = this.o;
    if (!this.lull) {
      // The music must still be playing: a fade to silence is no breakdown.
      const low = this.long >= o.breakdownFloor && this.mid < o.breakdownRatio * this.long && this.fast >= o.resumeLevel;
      if (!low) {
        this.below = null;
        return null;
      }
      this.below ??= { since: now, before: this.long };
      if (now - this.below.since < o.breakdownHold) return null;
      // Measured against where the music was, not the long level decaying since.
      this.lull = { before: Math.max(this.below.before, this.long), floor: this.mid, started: now };
      this.below = null;
      return { kind: "breakdown", time: now, strength: clamp01(1 - this.mid / this.lull.before), detail: "energy fell" };
    }

    const lull = this.lull;
    lull.floor = Math.min(lull.floor, this.mid);
    if (now - lull.started > o.lullTimeout) return this.endLull(now);
    const target = Math.max(o.dropRecover * lull.before, o.dropRatio * Math.max(lull.floor, o.silenceLevel));
    if (this.fast < target) {
      this.recovering = null;
      // Crept back up without a jump: the breakdown is simply over.
      if (this.mid >= o.dropRecover * lull.before) return this.endLull(now);
      return null;
    }
    // Abruptness is judged when the fast follower first crosses the target.
    this.recovering ??= { since: now, abrupt: this.fast >= o.dropAbrupt * this.mid };
    if (!this.recovering.abrupt) {
      if (this.mid >= o.dropRecover * lull.before) return this.endLull(now);
      return null;
    }
    if (now - this.recovering.since < o.dropHold) return null;
    const lullSeconds = now - lull.started;
    const ratio = this.fast / Math.max(lull.floor, o.silenceLevel);
    const strength = clamp01(0.5 * clamp01((ratio - 1) / 2) + 0.5 * clamp01(lullSeconds / 8));
    this.endLull(now);
    return { kind: "drop", time: now, strength, detail: `energy ×${ratio.toFixed(1)} after ${lullSeconds.toFixed(0)} s lull` };
  }

  private endLull(now: number): null {
    this.lull = null;
    this.recovering = null;
    this.lullEnded = now;
    // The shapes learnt the breakdown; start the comparison afresh.
    if (this.shortShape && this.longShape) this.longShape.set(this.shortShape);
    this.noveltyArmed = true;
    this.noveltySince = null;
    return null;
  }

  private updateShapes(spectrum: readonly number[], dt: number): void {
    const n = spectrum.length;
    if (!n) return;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += spectrum[i];
    mean /= n;
    if (!this.shortShape || !this.longShape || this.shortShape.length !== n) {
      this.shortShape = new Float64Array(n);
      this.longShape = new Float64Array(n);
      for (let i = 0; i < n; i++) this.shortShape[i] = this.longShape[i] = spectrum[i] - mean;
      this.novelty = 0;
      return;
    }
    const ks = 1 - Math.exp(-dt / this.o.shapeShortTau), kl = 1 - Math.exp(-dt / this.o.shapeLongTau);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = spectrum[i] - mean;
      this.shortShape[i] += (x - this.shortShape[i]) * ks;
      this.longShape[i] += (x - this.longShape[i]) * kl;
      const d = this.shortShape[i] - this.longShape[i];
      sum += d * d;
    }
    this.novelty = Math.sqrt(sum / n);
  }

  private changeEvent(now: number): SectionEvent | null {
    const o = this.o;
    if (this.novelty < o.noveltyOff) this.noveltyArmed = true;
    const quiet = this.lull !== null || now - this.lullEnded < o.changeQuiet || this.music < o.warmup;
    if (!this.noveltyArmed || quiet || this.novelty < o.noveltyOn) {
      this.noveltySince = null;
      return null;
    }
    this.noveltySince ??= now;
    if (now - this.noveltySince < o.noveltyHold) return null;
    this.noveltyArmed = false;
    this.noveltySince = null;
    const strength = clamp01((this.novelty - o.noveltyOn) / (2 * o.noveltyOn) + 0.3);
    return { kind: "change", time: now, strength, detail: `timbre changed (${this.novelty.toFixed(2)})` };
  }
}
