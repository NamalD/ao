import { AudioFeatures, SPECTRUM_BANDS } from "./features";

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

/** In-place iterative radix-2 FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k), wi = Math.sin(step * k);
        const a = start + k, b = a + size / 2;
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

/**
 * Turns interleaved stereo float samples into the features visualizers use.
 * Keep it pure: the caller supplies the clock so tests can drive it.
 */
export class Analyser {
  private ring = new Float64Array(FFT_SIZE);
  private written = 0;
  private window = Float64Array.from({ length: FFT_SIZE },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  private edges = bandEdges();
  private levels = new Array<number>(SPECTRUM_BANDS).fill(0);
  private baseline = 0;
  private loudness = 0;
  private impulse = 0;
  private beat = 0;
  private lastBeat = -Infinity;
  private lastTime: number | null = null;

  constructor(private sampleRate = 48000) {}

  push(interleaved: Float32Array, now: number): AudioFeatures {
    for (let i = 0; i + 1 < interleaved.length; i += 2) {
      this.ring[this.written % FFT_SIZE] = 0.5 * (interleaved[i] + interleaved[i + 1]);
      this.written++;
    }
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
    const centre = (i: number) => Math.sqrt(this.edges[i] * this.edges[i + 1]);
    const average = (lo: number, hi: number) => {
      let sum = 0, count = 0;
      this.levels.forEach((level, i) => {
        const hz = centre(i);
        if (hz >= lo && hz < hi) { sum += level; count++; }
      });
      return count ? sum / count : 0;
    };
    return {
      time: now,
      loudness: this.loudness,
      impulse: this.impulse,
      beat: this.beat,
      bass: average(0, 250),
      mid: average(250, 2000),
      high: average(2000, Infinity),
      spectrum: this.levels.slice(),
    };
  }

  private sample(age: number): number {
    return this.ring[(this.written - 1 - age + FFT_SIZE * 2) % FFT_SIZE];
  }

  private recentRms(): number {
    const n = Math.min(ENERGY_WINDOW, this.written);
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.sample(i) ** 2;
    return Math.sqrt(sum / n);
  }

  private updateSpectrum(dt: number): void {
    const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) re[i] = this.sample(FFT_SIZE - 1 - i) * this.window[i];
    fft(re, im);
    const binHz = this.sampleRate / FFT_SIZE;
    // A Hann window halves the coherent gain, so a full-scale sine reads 1.0.
    const scale = 4 / FFT_SIZE;
    for (let band = 0; band < SPECTRUM_BANDS; band++) {
      const lo = Math.floor(this.edges[band] / binHz);
      const hi = Math.max(lo, Math.floor(this.edges[band + 1] / binHz));
      let peak = 0;
      for (let bin = lo; bin <= hi && bin < FFT_SIZE / 2; bin++) {
        peak = Math.max(peak, Math.hypot(re[bin], im[bin]) * scale);
      }
      const db = 20 * Math.log10(peak + 1e-9);
      const target = clamp01((db - FLOOR_DB) / (CEIL_DB - FLOOR_DB));
      this.levels[band] = dt === 0 ? target : follow(this.levels[band], target, dt, 0.015, 0.15);
    }
  }
}
