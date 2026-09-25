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
}

export const SPECTRUM_BANDS = 64;

export function silentFeatures(time = 0): AudioFeatures {
  return {
    time, loudness: 0, impulse: 0, beat: 0, bass: 0, mid: 0, high: 0,
    spectrum: new Array(SPECTRUM_BANDS).fill(0),
  };
}
