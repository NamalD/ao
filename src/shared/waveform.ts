/**
 * A short, trigger-aligned waveform for oscilloscope visuals, like the
 * waveform row of a music visualiser's audio texture. Pure, so it can be tested.
 */

import { WAVE_SIZE } from "./features";

export { WAVE_SIZE };

/** Samples a frame covers: 1024 at 48 kHz is ~21 ms, decimated by two. */
export const WAVE_SPAN = 1024;
/** Arm the trigger once the signal dips below this fraction of its lowest point. */
const ARM = 0.9;
/** Below this peak level there is nothing to trigger on; the frame free-runs. */
const SILENCE = 1e-4;

/**
 * The newest `WAVE_SPAN` samples of a mono ring buffer that can start on a
 * rising zero crossing, decimated to `WAVE_SIZE` values, -1..1.
 *
 * Like an oscilloscope trigger, the frame starts where the signal rises
 * through zero after dipping below half of its lowest point, found to a
 * fraction of a sample, so a steady tone draws in the same place frame after
 * frame instead of sliding. The latest such crossing that still leaves a
 * full frame is used, keeping latency down. Without one (silence, noise-free
 * DC) the frame is simply the newest samples.
 *
 * `ring` holds mono samples, oldest overwritten first; `written` is the total
 * written so far, so the newest sample is at `(written - 1) % ring.length`.
 * The ring must hold more than `WAVE_SPAN` samples: the rest is the search
 * range for the trigger, and bounds the lowest frequency that stays still.
 */
export function triggeredWave(ring: ArrayLike<number>, written: number, out = new Float32Array(WAVE_SIZE)): Float32Array {
  const n = ring.length;
  const search = n - WAVE_SPAN;
  // Unroll the ring oldest first, so the scans below index it directly.
  if (line.length !== n + 1) line = new Float64Array(n + 1);
  const d = line;
  const oldest = written % n;
  if (ring instanceof Float64Array) {
    d.set(ring.subarray(oldest), 0);
    d.set(ring.subarray(0, oldest), n - oldest);
  } else {
    for (let r = 0, j = oldest; r < n; r++) {
      d[r] = ring[j];
      if (++j === n) j = 0;
    }
  }
  d[n] = d[n - 1];
  let low = 0;
  for (let r = 0; r <= search; r++) if (d[r] < low) low = d[r];
  let start = search;
  if (low < -SILENCE) {
    const arm = ARM * low;
    let armed = false;
    for (let r = 1; r <= search; r++) {
      const previous = d[r - 1], x = d[r];
      if (previous < arm) armed = true;
      if (armed && previous < 0 && x >= 0) {
        // Where the line between the two samples crosses zero.
        start = r - 1 + previous / (previous - x);
        armed = false;
      }
    }
  }
  // Each value averages neighbouring samples read by linear interpolation
  // from the fractional start: a gentle low-pass that also keeps the frame
  // free of sub-sample jitter.
  const step = WAVE_SPAN / out.length;
  const base = Math.floor(start), frac = start - base;
  for (let i = 0, r = base; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < step; k++, r++) sum += d[r] + (d[r + 1] - d[r]) * frac;
    const v = sum / step;
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return out;
}

/** Scratch for `triggeredWave`: the ring unrolled, plus one sample of padding. */
let line = new Float64Array(0);

/** The waveform at position x (0..1), linearly interpolated like GLSL `aoWaveAt(x)`. */
export function waveAt(wave: ArrayLike<number>, x: number): number {
  const n = wave.length;
  if (n === 0) return 0;
  const p = Math.min(n - 1, Math.max(0, (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0) * n - 0.5));
  const i = Math.floor(p), t = p - i;
  return i + 1 < n ? wave[i] + (wave[i + 1] - wave[i]) * t : wave[i];
}
