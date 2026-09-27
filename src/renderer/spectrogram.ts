/**
 * Spectrum history for scenes' `aoSpectrogram` texture: a ring of the last
 * HISTORY_ROWS spectrum frames at a fixed HISTORY_RATE rows a second. It
 * lives in the renderer, fed by the features that already arrive, so it adds
 * nothing to IPC. No DOM or WebGL here, so it can be tested.
 */

/** Rows kept: 256 at 50 rows/s is the last 5.12 s. */
export const HISTORY_ROWS = 256;
/** Rows a second, by the capture clock (`AudioFeatures.time`), however the chunks arrive. */
export const HISTORY_RATE = 50;

export class SpectrumHistory {
  /** `rows × bands` levels, row-major; row `(written - 1) % rows` is the newest. */
  data: Float32Array;
  /** Total rows written. Scenes compare it with what they uploaded. */
  written = 0;
  /** Bumped on every change, including rewrites of the newest row. */
  version = 0;
  private tick = -1;
  private last: Float32Array;
  private scratch: Float32Array;

  constructor(readonly bands = 64, readonly rows = HISTORY_ROWS, readonly rate = HISTORY_RATE) {
    this.data = new Float32Array(bands * rows);
    this.last = new Float32Array(bands);
    this.scratch = new Float32Array(bands);
  }

  /** The row index holding the newest frame. */
  get newest(): number {
    return (this.written + this.rows - 1) % this.rows;
  }

  /**
   * Adds a spectrum captured at `time` seconds. Rows fall due at `rate` per
   * second: when several are due at once they are filled by interpolating
   * from the previous frame, and when none is due the newest row is
   * refreshed, so the rows stay evenly spaced in time.
   */
  push(spectrum: ArrayLike<number>, time: number): void {
    const { bands, rows, data, last } = this;
    const current = this.scratch;
    for (let b = 0; b < bands; b++) current[b] = b < spectrum.length ? spectrum[b] : 0;
    const tick = Math.floor(time * this.rate);
    // The first frame, or a clock that went backwards (capture restarted).
    const restart = this.tick < 0 || tick < this.tick;
    if (restart) last.set(current);
    const due = restart ? 1 : Math.min(tick - this.tick, rows);
    if (due === 0) {
      data.set(current, this.newest * bands);
    } else {
      for (let k = 1; k <= due; k++) {
        const t = k / due, offset = (this.written % rows) * bands;
        for (let b = 0; b < bands; b++) data[offset + b] = last[b] + (current[b] - last[b]) * t;
        this.written++;
      }
    }
    this.tick = tick;
    last.set(current);
    this.version++;
  }

  /** The level of `band` `age` rows before the newest (0 = newest). */
  at(band: number, age: number): number {
    const row = (((this.written - 1 - age) % this.rows) + this.rows) % this.rows;
    return this.data[row * this.bands + band];
  }
}

/** The history every scene samples, fed by `updateAudio`. */
export const spectrogram = new SpectrumHistory();
