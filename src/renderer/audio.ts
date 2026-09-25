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

export function updateAudio(features: AudioFeatures): void {
  ao.features = features;
}
