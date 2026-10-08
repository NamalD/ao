import { WAVE_SIZE } from "./features";

export { WAVE_SIZE };
/** Mono frames a wave covers, two per value. */
export const WAVE_SPAN = 1024;

/** The waveform at position x (0..1), linearly interpolated like GLSL `aoWaveAt(x)`. */
export function waveAt(wave: ArrayLike<number>, x: number): number {
  const n = wave.length;
  if (n === 0) return 0;
  const p = Math.min(n - 1, Math.max(0, (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0) * n - 0.5));
  const i = Math.floor(p), t = p - i;
  return i + 1 < n ? wave[i] + (wave[i + 1] - wave[i]) * t : wave[i];
}
