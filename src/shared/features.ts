import type { TempoState } from "./tempo";

/** Audio features sent from the capture process to the renderer each analysis step. */
export interface AudioFeatures {
  /** Seconds since capture started. */
  time: number;
  /** Smoothed overall level, 0..1. Rises quickly, falls slowly. */
  loudness: number;
  /** Transient envelope, 0..1. Jumps on hits, then decays within ~0.3s. */
  impulse: number;
  /** Beat envelope, 0..1. Set to 1 on a detected onset, decays within ~0.15s. */
  beat: number;
  /** Average band energy, 0..1: below 250 Hz, 250 Hz..2 kHz, above 2 kHz. */
  bass: number;
  mid: number;
  high: number;
  /** Log-spaced band levels, 0..1, from ~30 Hz to ~16 kHz. */
  spectrum: number[];

  // --- Waveform, stereo image and chroma (shader audio) ---
  /** The newest ~21 ms of mono waveform, WAVE_SIZE values -1..1, starting on a rising zero crossing. */
  wave: Float32Array;
  /** Stereo balance, -1 (left) .. 1 (right), smoothed. */
  balance: number;
  /** Stereo width, 0 (mono) .. 1 (wide), from the side level relative to the mid. */
  width: number;
  /** Pitch-class strengths, 0..1, for C, C#, … B, smoothed; the strongest is near 1. */
  chroma: number[];
  /** The dominant pitch class, 0 (C) .. 11 (B). */
  key: number;
  /** Detected tempo and beat count (tempo.ts); absent before capture starts. */
  tempo?: TempoState;
}

export const SPECTRUM_BANDS = 64;
/** Values in `AudioFeatures.wave`. */
export const WAVE_SIZE = 512;

export function silentFeatures(time = 0): AudioFeatures {
  return {
    time, loudness: 0, impulse: 0, beat: 0, bass: 0, mid: 0, high: 0,
    spectrum: new Array(SPECTRUM_BANDS).fill(0),
    wave: new Float32Array(WAVE_SIZE), balance: 0, width: 0, chroma: new Array(12).fill(0), key: 0,
  };
}
