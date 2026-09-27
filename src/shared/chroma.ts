/**
 * Chroma: how much of each pitch class (C, C#, … B) is sounding, folded
 * across octaves, from FFT bins. Pure, so it can be tested.
 */

export const PITCH_CLASSES = 12;
export const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Frequency range read. Below ~110 Hz a 2048-point FFT's 23 Hz bins are
 * wider than a semitone and can't tell neighbouring notes apart; above
 * ~5 kHz there is mostly noise and upper partials.
 */
const MIN_HZ = 110;
const MAX_HZ = 5000;
/** Peaks quieter than this, relative to the loudest in range, are ignored. */
const RELATIVE_FLOOR = 1e-3; // -30 dB in power
/** Below this amplitude (-60 dBFS) the range counts as silent. */
const SILENCE = 1e-3;
/** Seconds to rise and fall towards a new chroma. */
const RISE = 0.06;
const FALL = 0.35;
/** A new key needs this much more chroma than the current one to take over. */
const KEY_HYSTERESIS = 1.15;

export class Chroma {
  /** Smoothed chroma, 0..1, the strongest class at or near 1. */
  readonly values = new Array<number>(PITCH_CLASSES).fill(0);
  /** Dominant pitch class, 0 (C) .. 11 (B), with hysteresis so it doesn't flicker. */
  key = 0;
  private readonly first: number;
  private readonly last: number;
  private readonly target = new Float64Array(PITCH_CLASSES);
  private started = false;

  /**
   * `scale` turns a bin magnitude into a sine amplitude (4 / N for a
   * Hann-windowed N-point FFT).
   */
  constructor(private readonly sampleRate: number, private readonly fftSize: number, private readonly scale: number) {
    const binHz = sampleRate / fftSize;
    this.first = Math.max(1, Math.ceil(MIN_HZ / binHz));
    this.last = Math.min(fftSize / 2 - 2, Math.floor(MAX_HZ / binHz));
  }

  /** Updates from the real and imaginary FFT output, `dt` seconds after the last update. */
  update(re: ArrayLike<number>, im: ArrayLike<number>, dt: number): void {
    const target = this.target;
    target.fill(0);
    const { first, last } = this;
    const power = (k: number) => re[k] * re[k] + im[k] * im[k];
    let loudest = 0;
    for (let k = first; k <= last; k++) loudest = Math.max(loudest, power(k));
    const silent = Math.sqrt(loudest) * this.scale < SILENCE;
    if (!silent) {
      const floor = loudest * RELATIVE_FLOOR;
      const binHz = this.sampleRate / this.fftSize;
      let before = power(first - 1), here = power(first);
      for (let k = first; k <= last; k++) {
        const after = power(k + 1);
        if (here > floor && here > before && here >= after) {
          // Refine the peak's frequency with a parabola through the log
          // powers; for a Hann window this is within a tenth of a bin.
          const a = Math.log(before + 1e-30), b = Math.log(here), c = Math.log(after + 1e-30);
          const curve = a - 2 * b + c;
          const offset = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curve)) : 0;
          const midi = 69 + 12 * Math.log2(((k + offset) * binHz) / 440);
          const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
          target[pitchClass] += Math.sqrt(here);
        }
        before = here;
        here = after;
      }
      let max = 0;
      for (let i = 0; i < PITCH_CLASSES; i++) max = Math.max(max, target[i]);
      if (max > 0) for (let i = 0; i < PITCH_CLASSES; i++) target[i] /= max;
    }
    const values = this.values;
    for (let i = 0; i < PITCH_CLASSES; i++) {
      const t = target[i], v = values[i];
      values[i] = !this.started ? t : t + (v - t) * Math.exp(-dt / (t > v ? RISE : FALL));
    }
    this.started = true;
    let best = 0;
    for (let i = 1; i < PITCH_CLASSES; i++) if (values[i] > values[best]) best = i;
    if (values[best] > values[this.key] * KEY_HYSTERESIS) this.key = best;
  }
}

/** The dominant pitch class as a colour hue, 0..1: C is 0, each semitone 1/12 further round. */
export function keyHue(key: number): number {
  return (((key % 12) + 12) % 12) / 12;
}
