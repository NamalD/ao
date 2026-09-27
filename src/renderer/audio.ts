import { AudioFeatures, silentFeatures } from "../shared/features";
import { centroidPosition, hzLevel, peakPosition, spectrumAt } from "../shared/spectrum";
import { keyHue } from "../shared/chroma";
import { waveAt } from "../shared/waveform";
import { spectrogram } from "./spectrogram";

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
  // --- Waveform, stereo image and chroma ---
  /** The newest ~21 ms of waveform, 512 values -1..1, starting on a rising zero crossing. */
  get wave() { return this.features.wave; },
  /** The waveform at position x (0..1), interpolated like GLSL `aoWaveAt(x)`. */
  waveAt(x: number) { return waveAt(this.features.wave, x); },
  /** Stereo balance, -1 (left) .. 1 (right). */
  get balance() { return this.features.balance; },
  /** Stereo width, 0 (mono) .. 1 (wide). */
  get width() { return this.features.width; },
  /** Pitch-class strengths, 0..1, for C, C#, D, … B. */
  get chroma() { return this.features.chroma; },
  /** The dominant pitch class, 0 (C) .. 11 (B). */
  get key() { return this.features.key; },
  /** The dominant pitch class as a hue, 0..1 (key / 12), so colour can follow the harmony. */
  get hue() { return keyHue(this.features.key); },
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
  wave: { signature: "ao.wave", description: "The newest ~21 ms of waveform: 512 values, -1..1, starting on a rising zero crossing so a scope holds still." },
  waveAt: { signature: "ao.waveAt(x)", description: "Waveform value, -1..1, at position x, 0..1 across ao.wave, interpolated like GLSL aoWaveAt(x)." },
  balance: { signature: "ao.balance", description: "Stereo balance, -1 (left) .. 0 (centre) .. 1 (right), smoothed." },
  width: { signature: "ao.width", description: "Stereo width, 0 for mono up to 1 for wide or hard-panned sound, smoothed." },
  chroma: { signature: "ao.chroma", description: "12 pitch-class levels, 0..1, for C, C#, D, … B (110 Hz..5 kHz); the strongest is near 1." },
  key: { signature: "ao.key", description: "The dominant pitch class, 0 (C) .. 11 (B); changes only when another clearly takes over." },
  hue: { signature: "ao.hue", description: "The dominant pitch class as a hue, 0..1 (ao.key / 12): colour that follows the harmony." },
};

export function updateAudio(features: AudioFeatures): void {
  ao.features = features;
  spectrogram.push(features.spectrum, features.time);
}
