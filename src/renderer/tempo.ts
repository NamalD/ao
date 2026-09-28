import arrayUtils from "hydra-synth/src/lib/array-utils.js";
import { BpmDriver, describeTempo, TempoClock, msUntilNextBar } from "../shared/tempo-clock";
import type { TempoState } from "../shared/tempo";

/**
 * The renderer's tempo: a beat clock following the detector or taps, the
 * values `ao` and solids read, and Hydra's `bpm` kept in step.
 */
export const clock = new TempoClock();
const seconds = () => performance.now() / 1000;
const frac = (x: number) => x - Math.floor(x);

/** Detected tempo arrives with every audio update. */
export function followTempo(state: TempoState | undefined): void {
  if (state) clock.follow(state, seconds());
}

/** Tap tempo; returns the status text to show. */
export function tapTempo(): string {
  clock.tap(seconds());
  return describeTempo(clock);
}

export const beatsNow = () => clock.beatsAt(seconds());
export const phaseNow = () => frac(beatsNow());
export const barNow = () => clock.barAt(seconds());

/** 0..1 ramp over every `n` beats, aligned to the bar: ramp(4) is the bar's phase. */
export function ramp(n = 1): number {
  return n > 0 && Number.isFinite(n) ? frac(beatsNow() / n) : 0;
}

/** 1 on every 1/div of a beat, easing to 0 by the next: pulse(2) on eighths, pulse(1/4) once a bar. */
export function pulse(div = 1): number {
  if (!(div > 0 && Number.isFinite(div))) return 0;
  return (1 - frac(beatsNow() * div)) ** 4;
}

// --- Hydra -------------------------------------------------------------------

/** Detection must reach this confidence before autopilot trusts the bar. */
const TRUST_CONFIDENCE = 0.3;
type HydraGlobals = { bpm?: number };
const globals = () => window as unknown as HydraGlobals;
let driver: BpmDriver | null = null;

/**
 * Keeps Hydra's global `bpm` on `ao.bpm`, as if every sketch began with
 * `bpm = ao.bpm` but kept following it, and makes array
 * sequences step on Ao's beats: Hydra indexes `[a, b, c].fast(s)` by
 * `time * s * bpm / 60`, so while Ao drives `bpm` it hands arrays the time at
 * which that product equals Ao's beat count. `[1, 2, 3, 4]` then changes
 * exactly on each beat and starts over on each bar.
 */
export function installHydraTempo(): void {
  driver = new BpmDriver(globals().bpm ?? 30);
  const original = arrayUtils.getValue;
  arrayUtils.getValue = (arr) => {
    const read = original(arr);
    return (props) => driver?.driving && props.bpm > 0
      ? read({ ...props, time: (beatsNow() * 60) / props.bpm })
      : read(props);
  };
}

/** Time until the next bar, so autopilot's fades start on the one; 0 until the tempo is trusted. */
export function msToNextBar(): number {
  const trusted = clock.source === "tap" || clock.confidence >= TRUST_CONFIDENCE;
  return msUntilNextBar(barNow(), phaseNow(), clock.bpm, trusted);
}

/** Called each frame before Hydra ticks. */
export function syncHydraBpm(): void {
  if (!driver) return;
  const value = driver.frame(globals().bpm ?? 30, Math.round(clock.bpm * 100) / 100);
  if (value !== undefined) globals().bpm = value;
}

/** Before the whole sketch runs: Ao may drive `bpm` again unless the sketch sets it. */
export function releaseHydraBpm(): void {
  driver?.release(globals().bpm ?? 30);
}
