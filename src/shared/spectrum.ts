import { bandEdges } from "./analysis";

/**
 * Helpers for reading a spectrum of log-spaced band levels. Positions run
 * 0..1 along the same log-frequency axis as GLSL `aoFFT(x)`: band `i` sits at
 * `(i + 0.5) / bands`, so a position maps straight onto a frequency.
 */

const EDGES = bandEdges();
const MIN_HZ = EDGES[0];
const MAX_HZ = EDGES[EDGES.length - 1];
const LOG_RANGE = Math.log(MAX_HZ / MIN_HZ);

/** The position of a frequency on the spectrum axis. Band centres land on their texel centres. */
export function hzToPosition(hz: number): number {
  return Math.log(Math.max(hz, 1e-6) / MIN_HZ) / LOG_RANGE;
}

/** The frequency at a spectrum position; the inverse of `hzToPosition`. */
export function positionToHz(x: number): number {
  return MIN_HZ * Math.exp(x * LOG_RANGE);
}

/**
 * The level at position `x` (0..1), linearly interpolated between band
 * centres and clamped at the ends, exactly like a linear, clamp-to-edge
 * texture lookup (GLSL `aoFFT`).
 */
export function spectrumAt(spectrum: ArrayLike<number>, x: number): number {
  const n = spectrum.length;
  if (n === 0) return 0;
  const p = Math.min(n - 1, Math.max(0, (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0) * n - 0.5));
  const i = Math.floor(p), t = p - i;
  return i + 1 < n ? spectrum[i] + (spectrum[i + 1] - spectrum[i]) * t : spectrum[i];
}

/**
 * The average level between two frequencies in Hz: the mean of the bands
 * whose centres fall in `lo..hi`. A range narrower than one band (or a single
 * frequency, when `hi` is omitted) reads the interpolated level at its
 * geometric middle instead of nothing.
 */
export function hzLevel(spectrum: ArrayLike<number>, lo: number, hi = lo): number {
  if (hi < lo) [lo, hi] = [hi, lo];
  const n = spectrum.length;
  // Band i's centre is at position (i + 0.5) / n.
  const first = Math.max(0, Math.ceil(hzToPosition(lo) * n - 0.5 - 1e-9));
  const last = Math.min(n - 1, Math.floor(hzToPosition(hi) * n - 0.5 + 1e-9));
  if (last < first) return spectrumAt(spectrum, hzToPosition(Math.sqrt(Math.max(lo, 1e-6) * hi)));
  let sum = 0;
  for (let i = first; i <= last; i++) sum += spectrum[i];
  return sum / (last - first + 1);
}

/**
 * The position (0..1) of the loudest band, refined between neighbouring
 * bands with a parabola so it glides rather than steps. 0 in silence.
 */
export function peakPosition(spectrum: ArrayLike<number>): number {
  const n = spectrum.length;
  let best = 0;
  for (let i = 1; i < n; i++) if (spectrum[i] > spectrum[best]) best = i;
  if (n === 0 || spectrum[best] <= 0) return 0;
  let offset = 0;
  if (best > 0 && best < n - 1) {
    const a = spectrum[best - 1], b = spectrum[best], c = spectrum[best + 1];
    const curve = a - 2 * b + c;
    if (curve < 0) offset = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve));
  }
  return (best + 0.5 + offset) / n;
}

/**
 * The spectral centroid as a position (0..1): the level-weighted mean band
 * position, a steady measure of how bright the sound is. 0 in silence.
 */
export function centroidPosition(spectrum: ArrayLike<number>): number {
  const n = spectrum.length;
  let weight = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const w = spectrum[i] * spectrum[i];
    weight += w;
    sum += w * (i + 0.5);
  }
  return weight > 0 ? sum / weight / n : 0;
}
