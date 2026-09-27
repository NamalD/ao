import { AudioFeatures, silentFeatures } from "../shared/features";

type Level = "loudness" | "impulse" | "beat" | "bass" | "mid" | "high";

/**
 * The live audio state sketches read, exposed globally as `ao`.
 * Hydra re-reads function arguments every frame: `osc(10, .1, () => ao.bass)`.
 */
export const ao = {
  features: silentFeatures(),
  get time() { return this.features.time; },
  get loudness() { return this.features.loudness; },
  get impulse() { return this.features.impulse; },
  get beat() { return this.features.beat; },
  get bass() { return this.features.bass; },
  get mid() { return this.features.mid; },
  get high() { return this.features.high; },
  /** Band levels, 0..1, low to high frequency. */
  get fft() { return this.features.spectrum; },
  /** A Hydra argument that maps a level onto lo..hi: `rotate(ao.map("bass", 0, 1))`. */
  map(level: Level, lo = 0, hi = 1) {
    return () => lo + (hi - lo) * this.features[level];
  },
};

/**
 * Documentation for each public `ao` member, used by the editor's completion
 * and signature help. Every public member of `ao` must have an entry.
 */
export const aoDocs: Record<string, { signature: string; description: string }> = {
  time: { signature: "ao.time", description: "Seconds since capture started." },
  loudness: { signature: "ao.loudness", description: "Smoothed overall level, 0..1. Rises quickly, falls slowly." },
  impulse: { signature: "ao.impulse", description: "Transient envelope, 0..1. Jumps on hits, then decays within ~0.3s." },
  beat: { signature: "ao.beat", description: "Onset pulse, 0..1. Set to 1 on a detected beat, decays within ~0.15s." },
  bass: { signature: "ao.bass", description: "Average level below 250 Hz, 0..1." },
  mid: { signature: "ao.mid", description: "Average level from 250 Hz to 2 kHz, 0..1." },
  high: { signature: "ao.high", description: "Average level above 2 kHz, 0..1." },
  fft: { signature: "ao.fft", description: "64 log-spaced band levels, 0..1, from ~30 Hz to ~16 kHz." },
  map: { signature: "ao.map(level, lo = 0, hi = 1)", description: "Maps an audio level onto lo..hi and returns a function Hydra re-reads every frame." },
};

export function updateAudio(features: AudioFeatures): void {
  ao.features = features;
}
