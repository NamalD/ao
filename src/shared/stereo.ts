/**
 * Stereo image from interleaved samples: balance (which side is louder) and
 * width (how different the channels are). Pure, so it can be tested.
 */

/** Seconds the channel energies take to follow a change. */
const SMOOTHING = 0.12;
/**
 * Soft floor on the RMS sums, so silence and near-silent tails read as
 * centred and narrow instead of amplifying noise.
 */
const FLOOR = 0.003;

export class StereoImage {
  /** Smoothed mean squares of left, right, mid (L+R)/2 and side (L-R)/2. */
  private left = 0;
  private right = 0;
  private mid = 0;
  private side = 0;
  private started = false;

  /** Folds in a chunk of interleaved stereo samples, `dt` seconds after the last one. */
  push(interleaved: Float32Array, dt: number): void {
    const frames = interleaved.length >> 1;
    if (frames === 0) return;
    let ll = 0, rr = 0, lr = 0;
    for (let i = 0; i + 1 < interleaved.length; i += 2) {
      const l = interleaved[i], r = interleaved[i + 1];
      ll += l * l;
      rr += r * r;
      lr += l * r;
    }
    ll /= frames; rr /= frames; lr /= frames;
    // mid² = (L² + 2LR + R²) / 4, side² = (L² - 2LR + R²) / 4.
    const mid = (ll + 2 * lr + rr) / 4, side = Math.max(0, (ll - 2 * lr + rr) / 4);
    const keep = this.started ? Math.exp(-dt / SMOOTHING) : 0;
    this.started = true;
    this.left = ll + (this.left - ll) * keep;
    this.right = rr + (this.right - rr) * keep;
    this.mid = mid + (this.mid - mid) * keep;
    this.side = side + (this.side - side) * keep;
  }

  /** -1 (all left) .. 0 (centred) .. 1 (all right), from the channels' RMS levels. */
  get balance(): number {
    const l = Math.sqrt(this.left), r = Math.sqrt(this.right);
    return (r - l) / (r + l + FLOOR);
  }

  /**
   * 0 for mono, about 1 for uncorrelated (wide) or hard-panned stereo:
   * the side level relative to the mid level, clamped to 0..1.
   */
  get width(): number {
    const m = Math.sqrt(this.mid), s = Math.sqrt(this.side);
    return Math.min(1, s / (m + FLOOR));
  }
}
