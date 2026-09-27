import { AudioFeatures, silentFeatures } from "../shared/features";
import { centroidPosition, hzLevel, peakPosition, spectrumAt } from "../shared/spectrum";

type Level = "loudness" | "impulse" | "beat" | "bass" | "mid" | "high" | "peak" | "centroid";

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
  /** The spectrum at position x (0..1, low to high), interpolated like GLSL `aoFFT(x)`. */
  fftAt(x: number) { return spectrumAt(this.features.spectrum, x); },
  /** Average level between two frequencies in Hz, or the level at one: `ao.hz(40, 100)`. */
  hz(lo: number, hi?: number) { return hzLevel(this.features.spectrum, lo, hi); },
  /** Position (0..1) of the loudest band, on the same axis as `fftAt`. */
  get peak() { return peakPosition(this.features.spectrum); },
  /** Spectral centroid (0..1): how bright the sound is, on the same axis as `fftAt`. */
  get centroid() { return centroidPosition(this.features.spectrum); },
  /**
   * A Hydra argument that maps a level, or any function returning 0..1, onto
   * lo..hi: `rotate(ao.map("bass", 0, 1))`, `scale(ao.map(() => ao.hz(40, 100), 1, 2))`.
   */
  map(level: Level | (() => number), lo = 0, hi = 1) {
    const read = typeof level === "function" ? level : () => this[level];
    return () => lo + (hi - lo) * read();
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
  map: { signature: "ao.map(level, lo = 0, hi = 1)", description: "Maps a level name, or a function such as () => ao.hz(40, 100), onto lo..hi; returns a function Hydra re-reads every frame." },
  fftAt: { signature: "ao.fftAt(x)", description: "Spectrum level at position x, 0..1 from low to high, interpolated like GLSL aoFFT(x)." },
  hz: { signature: "ao.hz(lo, hi?)", description: "Average level between two frequencies in Hz, or at one frequency: ao.hz(40, 100) for kicks." },
  peak: { signature: "ao.peak", description: "Position of the loudest band, 0..1 from low to high; glides between bands." },
  centroid: { signature: "ao.centroid", description: "Spectral centroid, 0..1 from low to high: how bright the sound is. Steadier than peak." },
};

export function updateAudio(features: AudioFeatures): void {
  ao.features = features;
}
