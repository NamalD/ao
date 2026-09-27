import { DEFAULT_BPM, TempoState } from "./tempo";

export type TempoSource = "auto" | "tap";

/** A pause longer than this (seconds) starts a new tap sequence. */
export const TAP_GAP = 2;
/** Two taps closer than this (seconds, faster than 240 bpm) return to automatic tempo. */
export const DOUBLE_TAP = 0.25;
/** Tapped tempo is the median of this many recent intervals. */
const TAP_INTERVALS = 8;
/** Tapped tempos are clamped to this range. */
const TAP_MIN = 30, TAP_MAX = 300;
/** Share of the gap to the detector's beat count closed per update (~50/s). */
const FOLLOW_GAIN = 0.1;
export const BEATS_PER_BAR = 4;

const frac = (x: number) => x - Math.floor(x);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

/**
 * The renderer's beat clock. It free-runs between updates, so phase is smooth
 * at any frame rate, and follows either the detector (auto) or tapping.
 *
 * - Auto: each detector update nudges the clock a tenth of the way toward the
 *   detector's beat count, smoothing IPC jitter. The detector doesn't know
 *   where bars start, so the clock keeps an integer offset that tapping sets.
 * - Tap: the first tap of a sequence is the one (bar 0, phase 0); each later
 *   tap is the next beat, and the tempo is the median of the last 8 intervals.
 *   A pause over TAP_GAP starts a new sequence. Tapped tempo overrides the
 *   detector until two quick taps (under DOUBLE_TAP apart) return to auto,
 *   keeping the bar where it is.
 *
 * Times are seconds on any monotonic clock. Pure, so tests drive it.
 */
export class TempoClock {
  source: TempoSource = "auto";
  private anchorTime = 0;
  private anchorBeats = 0;
  private rate = DEFAULT_BPM;
  /** Whole beats added to the detector's count so bars start where tapped. */
  private offset = 0;
  private detected: (TempoState & { at: number }) | null = null;
  private taps: number[] = [];
  private tapCount = 0;
  private firstTapBeat = 0;

  get bpm(): number { return this.rate; }
  /** 1 while tapped; otherwise the detector's confidence. */
  get confidence(): number { return this.source === "tap" ? 1 : this.detected?.confidence ?? 0; }
  /** Taps in the current sequence. */
  get tapsInSequence(): number { return this.tapCount; }

  /** Continuous beat count at time t: floor is the beat, fraction the phase. */
  beatsAt(t: number): number {
    return this.anchorBeats + ((t - this.anchorTime) * this.rate) / 60;
  }

  phaseAt(t: number): number { return frac(this.beatsAt(t)); }

  /** Beat within the bar at time t, 0..BEATS_PER_BAR - 1. */
  barAt(t: number): number {
    return Math.floor(frac(this.beatsAt(t) / BEATS_PER_BAR) * BEATS_PER_BAR);
  }

  /** A detector update received at time t. */
  follow(state: TempoState, t: number): void {
    this.detected = { ...state, at: t };
    if (this.source === "tap") return;
    const current = this.beatsAt(t);
    let error = state.beats + this.offset - current;
    if (Math.abs(error) > 0.5) {
      // Keep the nearest beat rather than sliding a whole beat or more.
      const whole = Math.round(error);
      this.offset -= whole;
      error -= whole;
    }
    this.rebase(t, current + FOLLOW_GAIN * error);
    this.rate = state.bpm;
  }

  /** A tap at time t. */
  tap(t: number): void {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && t - last < DOUBLE_TAP) {
      this.backToAuto(t);
      return;
    }
    if (last === undefined || t - last > TAP_GAP) {
      this.taps = [];
      this.tapCount = 0;
      // The first tap is the one: the nearest bar start from here.
      this.firstTapBeat = BEATS_PER_BAR * Math.round(this.beatsAt(t) / BEATS_PER_BAR);
    }
    this.taps.push(t);
    if (this.taps.length > TAP_INTERVALS + 1) this.taps.shift();
    this.tapCount++;
    if (this.taps.length >= 2) {
      const intervals = this.taps.slice(1).map((time, i) => time - this.taps[i]);
      this.rate = Math.min(TAP_MAX, Math.max(TAP_MIN, 60 / median(intervals)));
    }
    this.source = "tap";
    this.rebase(t, this.firstTapBeat + this.tapCount - 1);
  }

  private backToAuto(t: number): void {
    const current = this.beatsAt(t);
    this.source = "auto";
    this.taps = [];
    this.tapCount = 0;
    if (this.detected) {
      const { beats, bpm, at } = this.detected;
      const detectedNow = beats + ((t - at) * bpm) / 60;
      // Line the detector's beats up with the bar as tapped.
      this.offset = Math.round(current - detectedNow);
      this.rate = bpm;
    }
    this.rebase(t, current);
  }

  private rebase(t: number, beats: number): void {
    this.anchorTime = t;
    this.anchorBeats = beats;
  }
}

/**
 * Decides when Ao may set Hydra's global `bpm`. Hydra copies `window.bpm`
 * into its clock every tick, so Ao writes it each frame, but only while the
 * value there is still the one Ao wrote last: once a sketch assigns `bpm`
 * itself, Ao leaves it alone until `release` (a whole-sketch run).
 */
export class BpmDriver {
  private written: number;
  private owned = false;
  private drove = false;

  /** `initial` is Hydra's own starting value. */
  constructor(initial: number) { this.written = initial; }

  /** Whether Ao set the current value, so arrays may follow Ao's beat clock. */
  get driving(): boolean { return this.drove && !this.owned; }

  /**
   * Called each frame with Hydra's current `bpm` and the tempo to drive, or
   * null when there's none yet. Returns the value to assign, or undefined.
   */
  frame(current: number, tempo: number | null): number | undefined {
    if (this.owned) return undefined;
    if (current !== this.written) {
      this.owned = true;
      return undefined;
    }
    if (tempo === null) return undefined;
    this.written = tempo;
    this.drove = true;
    return tempo;
  }

  /** Hand `bpm` back to Ao, e.g. before the whole sketch runs again. */
  release(current: number): void {
    this.owned = false;
    this.written = current;
  }
}

/** Status text, e.g. "tempo 128.0 (tap)" or "tempo 127.9 (auto, 82%)". */
export function describeTempo(clock: { source: TempoSource; bpm: number; confidence: number; tapsInSequence: number }): string {
  const bpm = clock.bpm.toFixed(1);
  if (clock.source === "tap") {
    return clock.tapsInSequence === 1 ? `tempo ${bpm} (tap: bar reset; keep tapping each beat)` : `tempo ${bpm} (tap)`;
  }
  if (clock.confidence < 0.05) return `tempo ${bpm} (auto, listening)`;
  return `tempo ${bpm} (auto, ${Math.round(clock.confidence * 100)}%)`;
}

/**
 * Milliseconds from now until the next bar starts, for lining a switch up
 * with the one; 0 (switch now) when the tempo can't be trusted.
 */
export function msUntilNextBar(bar: number, phase: number, bpm: number, trusted: boolean, beatsPerBar = 4): number {
  if (!trusted || !(bpm > 0)) return 0;
  const beatsLeft = beatsPerBar - (((bar % beatsPerBar) + beatsPerBar) % beatsPerBar) - Math.min(Math.max(phase, 0), 1);
  return (Math.max(0, beatsLeft) * 60000) / bpm;
}
