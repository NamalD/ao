import { AudioFeatures, SPECTRUM_BANDS } from "./features";
import { Chroma } from "./chroma";
import { StereoImage } from "./stereo";
import { triggeredWave } from "./waveform";

const FFT_SIZE = 2048;
// Long enough to average over a few cycles of a low tone, so steady notes do
// not read as a stream of tiny hits.
const ENERGY_WINDOW = 1024;
/** Energy rises smaller than this are waveform ripple, not transients. */
const ATTACK_DEADBAND = 0.01;
const MIN_HZ = 30;
const MAX_HZ = 16000;
/** Band levels map this dB range onto 0..1. */
const FLOOR_DB = -65;
const CEIL_DB = -10;

/** Approaches `target` with separate rise and fall time constants (seconds). */
function follow(current: number, target: number, dt: number, rise: number, fall: number): number {
  const tau = target > current ? rise : fall;
  return target + (current - target) * Math.exp(-dt / tau);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

interface FftTables {
  /** Bit-reversal permutation: swap i with rev[i] when i < rev[i]. */
  rev: Uint32Array;
  /**
   * Twiddle factors for every stage, packed stage after stage: the stage of
   * `size` starts at `size / 2 - 1` and holds cos/sin(-2πk / size) for
   * k < size / 2. Computed with the same expression the butterflies used to
   * evaluate inline, so results are bit-identical.
   */
  cos: Float64Array;
  sin: Float64Array;
}

const fftTables = new Map<number, FftTables>();

function tablesFor(n: number): FftTables {
  let tables = fftTables.get(n);
  if (tables) return tables;
  const rev = new Uint32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    rev[i] = j;
  }
  const cos = new Float64Array(Math.max(1, n - 1)), sin = new Float64Array(Math.max(1, n - 1));
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size, base = size / 2 - 1;
    for (let k = 0; k < size / 2; k++) {
      cos[base + k] = Math.cos(step * k);
      sin[base + k] = Math.sin(step * k);
    }
  }
  tables = { rev, cos, sin };
  fftTables.set(n, tables);
  return tables;
}

/**
 * In-place iterative radix-2 FFT. `re` and `im` must have a power-of-two
 * length. Bit-reversal and twiddle tables are cached per length.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { rev, cos, sin } = tablesFor(n);
  for (let i = 1; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      const r = re[i]; re[i] = re[j]; re[j] = r;
      const m = im[i]; im[i] = im[j]; im[j] = m;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, base = half - 1;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[base + k], wi = sin[base + k];
        const a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** Log-spaced band edges in Hz: SPECTRUM_BANDS + 1 values. */
export function bandEdges(): number[] {
  return Array.from({ length: SPECTRUM_BANDS + 1 },
    (_, i) => MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / SPECTRUM_BANDS));
}

/** Band centres in Hz (geometric mean of each band's edges): SPECTRUM_BANDS values. */
export function bandCentres(): number[] {
  const edges = bandEdges();
  return Array.from({ length: SPECTRUM_BANDS }, (_, i) => Math.sqrt(edges[i] * edges[i + 1]));
}

/** The half-open run of bands whose centres fall in lo..hi Hz, as [first, end). */
function bandRange(centres: number[], lo: number, hi: number): [number, number] {
  let first = 0;
  while (first < centres.length && centres[first] < lo) first++;
  let end = first;
  while (end < centres.length && centres[end] < hi) end++;
  return [first, end];
}

/**
 * Turns interleaved stereo float samples into the features visualizers use.
 * Keep it pure: the caller supplies the clock so tests can drive it.
 */
export class Analyser {
  private ring = new Float64Array(FFT_SIZE);
  /** Total samples written; the next one goes to `written % FFT_SIZE`. */
  private written = 0;
  private window = Float64Array.from({ length: FFT_SIZE },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  private levels = new Array<number>(SPECTRUM_BANDS).fill(0);
  // FFT scratch, reused every push.
  private re = new Float64Array(FFT_SIZE);
  private im = new Float64Array(FFT_SIZE);
  /** First and last FFT bin (inclusive) each band takes its peak from. */
  private binLo = new Uint16Array(SPECTRUM_BANDS);
  private binHi = new Uint16Array(SPECTRUM_BANDS);
  /** Band index ranges [first, end) averaged into bass, mid and high. */
  private bassBands: [number, number];
  private midBands: [number, number];
  private highBands: [number, number];
  private baseline = 0;
  private loudness = 0;
  private impulse = 0;
  private beat = 0;
  private lastBeat = -Infinity;
  private lastTime: number | null = null;
  private stereo = new StereoImage();
  private chroma: Chroma;

  constructor(private sampleRate = 48000) {
    const edges = bandEdges();
    const binHz = sampleRate / FFT_SIZE;
    for (let band = 0; band < SPECTRUM_BANDS; band++) {
      const lo = Math.floor(edges[band] / binHz);
      const hi = Math.max(lo, Math.floor(edges[band + 1] / binHz));
      // Bins at or above Nyquist are skipped; an empty range (lo > hi) reads 0.
      this.binLo[band] = lo;
      this.binHi[band] = Math.min(hi, FFT_SIZE / 2 - 1);
    }
    const centres = bandCentres();
    this.bassBands = bandRange(centres, 0, 250);
    this.midBands = bandRange(centres, 250, 2000);
    this.highBands = bandRange(centres, 2000, Infinity);
    this.chroma = new Chroma(sampleRate, FFT_SIZE, 4 / FFT_SIZE);
  }

  push(interleaved: Float32Array, now: number): AudioFeatures {
    let head = this.written % FFT_SIZE;
    for (let i = 0; i + 1 < interleaved.length; i += 2) {
      this.ring[head] = 0.5 * (interleaved[i] + interleaved[i + 1]);
      if (++head === FFT_SIZE) head = 0;
    }
    this.written += interleaved.length >> 1;
    const dt = this.lastTime === null ? 0 : Math.max(0, now - this.lastTime);
    this.lastTime = now;

    const energy = this.recentRms();
    // Compare against a ~27 ms energy baseline: a sudden hit gives a strong
    // response while a sustained loud passage settles back down.
    const attack = Math.max(0, energy - this.baseline - ATTACK_DEADBAND);
    this.impulse = Math.max(clamp01(9 * attack), this.impulse * Math.exp(-7 * dt));
    const onset = energy > this.baseline * 1.35 + 0.012 && now - this.lastBeat > 0.18;
    if (onset) this.lastBeat = now;
    this.beat = onset ? 1 : this.beat * Math.exp(-20 * dt);
    this.baseline = dt === 0 ? energy : follow(this.baseline, energy, dt, 0.027, 0.027);
    this.loudness = follow(this.loudness, clamp01(5 * energy), dt, 0.03, 0.4);

    this.updateSpectrum(dt);
    this.stereo.push(interleaved, dt);
    this.chroma.update(this.re, this.im, dt);
    return {
      time: now,
      loudness: this.loudness,
      impulse: this.impulse,
      beat: this.beat,
      bass: this.average(this.bassBands),
      mid: this.average(this.midBands),
      high: this.average(this.highBands),
      spectrum: this.levels.slice(),
      wave: triggeredWave(this.ring, this.written),
      balance: this.stereo.balance,
      width: this.stereo.width,
      chroma: this.chroma.values.slice(),
      key: this.chroma.key,
    };
  }

  private average([first, end]: [number, number]): number {
    let sum = 0;
    for (let i = first; i < end; i++) sum += this.levels[i];
    return end > first ? sum / (end - first) : 0;
  }

  /** RMS of the newest ENERGY_WINDOW samples, summed newest first. */
  private recentRms(): number {
    const n = Math.min(ENERGY_WINDOW, this.written);
    if (n === 0) return 0;
    const ring = this.ring;
    let sum = 0;
    let index = (this.written - 1) % FFT_SIZE;
    for (let i = 0; i < n; i++) {
      const x = ring[index];
      sum += x * x;
      if (--index < 0) index = FFT_SIZE - 1;
    }
    return Math.sqrt(sum / n);
  }

  private updateSpectrum(dt: number): void {
    const { re, im, ring, window } = this;
    // Oldest sample first. Before the ring first fills, the unwritten slots
    // are still zero, exactly as reading "ahead" of the writes used to give.
    const oldest = this.written % FFT_SIZE;
    for (let i = 0, j = oldest; i < FFT_SIZE; i++) {
      re[i] = ring[j] * window[i];
      if (++j === FFT_SIZE) j = 0;
    }
    im.fill(0);
    fft(re, im);
    // A Hann window halves the coherent gain, so a full-scale sine reads 1.0.
    const scale = 4 / FFT_SIZE;
    for (let band = 0; band < SPECTRUM_BANDS; band++) {
      // Compare squared magnitudes and take one square root per band.
      let peakSq = 0;
      for (let bin = this.binLo[band], hi = this.binHi[band]; bin <= hi; bin++) {
        const power = re[bin] * re[bin] + im[bin] * im[bin];
        if (power > peakSq) peakSq = power;
      }
      const peak = Math.sqrt(peakSq) * scale;
      const db = 20 * Math.log10(peak + 1e-9);
      const target = clamp01((db - FLOOR_DB) / (CEIL_DB - FLOOR_DB));
      this.levels[band] = dt === 0 ? target : follow(this.levels[band], target, dt, 0.015, 0.15);
    }
  }
}
