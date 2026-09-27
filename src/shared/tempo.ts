import { fft } from "./analysis";

/**
 * Tempo and beat phase detected from the audio, sent with each analysis step.
 * `beats` is a continuous beat count: its fractional part is the phase within
 * the beat. Which beat starts a bar is not detected; the renderer counts bars
 * from its own offset, which tapping sets.
 */
export interface TempoState {
  /** Tempo in beats per minute; 120 until the first lock. */
  bpm: number;
  /** Continuous beat count at the newest sample; advances bpm / 60 per second. */
  beats: number;
  /** 0..1: how periodic the recent onsets are. Decays while held through silence. */
  confidence: number;
}

/** Detected tempos are folded into this range. */
export const TEMPO_MIN = 70;
export const TEMPO_MAX = 180;
/** Tempo before anything is detected, so phase still runs. */
export const DEFAULT_BPM = 120;

/** Onset-strength frames per second (a 256-sample hop at 48 kHz). */
const ODF_RATE = 187.5;
/** Hops of level history an onset must rise above (~21 ms). */
const LOOKBACK = 4;
/** Onset strength below this (a log-energy rise of ~1 dB) is ripple, not a hit. */
const ODF_FLOOR = 0.25;
/** Onset-strength history used for tempo induction: about 8 seconds. */
const HISTORY = 1536;
/** Zero-padded FFT length for the autocorrelation; fits HISTORY plus the longest lag. */
const FFT_N = 4096;
/** Seconds over which older onsets fade in the autocorrelation. */
const RECENCY = 4;
/** Seconds without onsets after which the tempo is held. */
const RECENT = 1.5;
/** Half-width in frames of the blur applied to onset strength before induction. */
const BLUR = 3;
/** Tempo induction runs every this many frames: about 6 times a second. */
const INDUCE_EVERY = 32;
/** Induction waits for this much history (about 4.3 s), enough for the slowest tempo's harmonics. */
const MIN_HISTORY = 800;
/** Candidate tempos are scored on this grid (bpm), then refined. */
const GRID_STEP = 0.5;
/** Autocorrelation harmonics summed per candidate: lags L, 2L, 3L, 4L. */
const HARMONICS = 4;
/** Periodicity below this counts as no evidence: breakdowns, silence, noise. */
const MIN_PERIODICITY = 0.12;
/** Onset-strength frames of delay between an onset and its detection-function peak. */
const ODF_DELAY = 1.5;
/** Phase corrections change the clock's rate by at most this fraction. */
const MAX_NUDGE = 0.3;
/** Seconds for confidence to fall by 1/e while the tempo is held. */
const HOLD_DECAY = 8;

const frac = (x: number) => x - Math.floor(x);
const wrapHalf = (x: number) => x - Math.round(x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Detects tempo and tracks beat phase from raw PCM. Pure: time is the sample
 * count, so tests replay audio exactly.
 *
 * 1. Onset strength: the signal is split into low (<150 Hz), mid and high
 *    (>2 kHz) bands with one-pole filters; each band's energy envelope is
 *    log-compressed every hop (~5.3 ms) and its positive difference (energy
 *    novelty, a cheap stand-in for spectral flux) is summed with the low band
 *    weighted most, so kicks lead.
 * 2. Tempo induction (~6 Hz): the autocorrelation of the last ~8 s of onset
 *    strength (via FFT), after an adaptive threshold, is scored for every
 *    candidate tempo in TEMPO_MIN..TEMPO_MAX by summing it at the first four
 *    multiples of the beat period (a comb over the autocorrelation). The
 *    harmonics make the true beat level beat both its half (fewer supporting
 *    peaks) and its double (every other peak missing), and a mild log-tempo
 *    prior around 120 bpm settles what remains, deterministically.
 * 3. Decision with hysteresis: estimates near the current tempo refine it
 *    smoothly; a different tempo must win consistently for ~0.7 s (~2 s for an
 *    octave jump) before it replaces the current one. Without periodic
 *    evidence the tempo is held and confidence decays.
 * 4. Beat phase: the recent onset strength is folded at the current period and
 *    the best-aligned offset measured; a free-running clock at the current
 *    tempo is nudged toward it through a temporary rate change, so phase stays
 *    continuous and never jumps on single onsets.
 */
export class TempoTracker {
  private readonly hop: number;
  private readonly rate: number;
  // Band-split filter state.
  private readonly lpLow: number;
  private readonly lpMid: number;
  private readonly envCoef: [number, number, number];
  private low = 0;
  private mid = 0;
  private env = [0, 0, 0];
  /** Each band's log level over the last LOOKBACK hops, newest last. */
  private history = [0, 1, 2].map(() => new Array<number>(LOOKBACK).fill(0));
  private inHop = 0;
  // Onset-strength history (ring) and induction scratch.
  private odf = new Float64Array(HISTORY);
  private frames = 0;
  private re = new Float64Array(FFT_N);
  private im = new Float64Array(FFT_N);
  private frame = new Float64Array(HISTORY);
  private smooth = new Float64Array(HISTORY);
  private acf = new Float64Array(FFT_N / 2);
  private recency = Float64Array.from({ length: HISTORY }, (_, i) => Math.exp(-(HISTORY - 1 - i) / (RECENCY * ODF_RATE)));
  private readonly candidates: number[] = [];
  private readonly prior: number[] = [];
  private scores: number[] = [];
  private phaseScores = new Float64Array(0);
  // Decision state.
  private tempo = 0;
  private pending = 0;
  private pendingCount = 0;
  private confidence = 0;
  // Clock, at the end of the newest hop.
  private beats = 0;
  private nudgeRate = 0;
  private nudgeLeft = 0;

  constructor(private readonly sampleRate = 48000) {
    this.hop = Math.max(1, Math.round(sampleRate / ODF_RATE));
    this.rate = sampleRate / this.hop;
    const onePole = (hz: number) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
    const envelope = (seconds: number) => 1 - Math.exp(-1 / (seconds * sampleRate));
    this.lpLow = onePole(150);
    this.lpMid = onePole(2000);
    // The low band's envelope is slower so a bass note's waveform doesn't ripple.
    this.envCoef = [envelope(0.012), envelope(0.006), envelope(0.004)];
    for (let bpm = TEMPO_MIN; bpm <= TEMPO_MAX + 1e-9; bpm += GRID_STEP) {
      this.candidates.push(bpm);
      const octaves = Math.log2(bpm / 120);
      this.prior.push(Math.exp(-0.5 * octaves * octaves));
    }
    this.scores = new Array(this.candidates.length).fill(0);
  }

  /** The current tempo, beat count and confidence. */
  get state(): TempoState {
    // The clock runs hop by hop; extrapolate through the unfinished hop.
    const bpm = this.tempo || DEFAULT_BPM;
    const beats = this.beats + (this.inHop / this.sampleRate) * (bpm / 60 + this.nudgeRate * (this.nudgeLeft > 0 ? 1 : 0));
    return { bpm, beats, confidence: this.confidence };
  }

  /** Feeds interleaved stereo samples; returns the state at the newest sample. */
  push(interleaved: Float32Array): TempoState {
    const frames = interleaved.length >> 1;
    const { lpLow, lpMid, envCoef } = this;
    const [cLow, cMid, cHigh] = envCoef;
    let [eLow, eMid, eHigh] = this.env;
    let low = this.low, mid = this.mid;
    for (let i = 0; i < frames; i++) {
      const x = 0.5 * (interleaved[2 * i] + interleaved[2 * i + 1]);
      low += lpLow * (x - low);
      mid += lpMid * (x - mid);
      const bMid = mid - low, bHigh = x - mid;
      eLow += cLow * (low * low - eLow);
      eMid += cMid * (bMid * bMid - eMid);
      eHigh += cHigh * (bHigh * bHigh - eHigh);
      if (++this.inHop === this.hop) {
        this.inHop = 0;
        this.low = low; this.mid = mid;
        this.env[0] = eLow; this.env[1] = eMid; this.env[2] = eHigh;
        this.endHop();
      }
    }
    this.low = low; this.mid = mid;
    this.env[0] = eLow; this.env[1] = eMid; this.env[2] = eHigh;
    return this.state;
  }

  private endHop(): void {
    const weights = [1, 0.6, 0.4];
    let strength = 0;
    for (let b = 0; b < 3; b++) {
      const level = Math.log(1 + 1e4 * this.env[b]);
      // Compare with the loudest of the previous few hops, not just the last
      // one (SuperFlux's trick): beating tones and vibrato ripple the level
      // faster than that, so only real rises count.
      const past = this.history[b];
      let before = past[0];
      for (let i = 1; i < LOOKBACK; i++) if (past[i] > before) before = past[i];
      strength += weights[b] * Math.max(0, level - before);
      past.shift();
      past.push(level);
    }
    this.odf[this.frames % HISTORY] = strength;
    this.frames++;
    this.advance(this.hop / this.sampleRate);
    if (this.frames >= MIN_HISTORY && this.frames % INDUCE_EVERY === 0) this.induce();
  }

  /** Runs the clock forward, spreading any phase correction over the interval. */
  private advance(dt: number): void {
    let step = dt * (this.tempo || DEFAULT_BPM) / 60;
    if (this.nudgeLeft > 0) {
      const used = Math.min(dt, this.nudgeLeft);
      step += this.nudgeRate * used;
      this.nudgeLeft -= used;
    }
    this.beats += step;
  }

  private induce(): void {
    const n = Math.min(this.frames, HISTORY);
    const { frame, smooth, re, im, acf } = this;
    // Oldest first, then an adaptive threshold: keep what stands above the
    // local mean (±~45 ms) and a floor, so peaks count and swells don't.
    const start = this.frames - n;
    for (let i = 0; i < n; i++) frame[i] = this.odf[(start + i) % HISTORY];
    const w = 8;
    let sum = 0, count = 0;
    for (let i = 0; i < Math.min(w, n); i++) { sum += frame[i]; count++; }
    let energy = 0;
    for (let i = 0; i < n; i++) {
      if (i + w < n) { sum += frame[i + w]; count++; }
      if (i - w - 1 >= 0) { sum -= frame[i - w - 1]; count--; }
      smooth[i] = Math.max(0, frame[i] - sum / count - ODF_FLOOR);
    }
    // A triangular blur (±BLUR frames) widens each peak so hits that drift
    // off the grid by a few milliseconds still line up.
    for (let i = 0; i < n; i++) {
      let v = 0, total = 0;
      for (let k = -BLUR; k <= BLUR; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        const weight = BLUR + 1 - Math.abs(k);
        v += weight * smooth[j];
        total += weight;
      }
      frame[i] = v / total;
      energy += frame[i];
    }
    smooth.set(frame.subarray(0, n));
    const mean = energy / n;
    re.fill(0);
    im.fill(0);
    // Recent onsets weigh more, so a tempo change wins within a few seconds.
    for (let i = 0; i < n; i++) re[i] = (smooth[i] - mean) * this.recency[HISTORY - n + i];
    // Autocorrelation: inverse transform of the power spectrum. The power
    // spectrum is real and even, so a forward FFT does the inverse.
    fft(re, im);
    for (let i = 0; i < FFT_N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft(re, im);
    const zero = re[0];
    // Silence or a breakdown without hits: the last RECENT seconds hold only a
    // sliver of the window's onset strength.
    let recent = 0;
    const recentFrames = Math.min(n, Math.round(RECENT * this.rate));
    for (let i = n - recentFrames; i < n; i++) recent += smooth[i];
    const silent = !(zero > 1e-9) || mean < 1e-4 || recent / recentFrames < 0.15 * mean;
    if (!silent) for (let i = 0; i < acf.length; i++) acf[i] = re[i] / zero;

    let best = -1, bestScore = 0;
    if (!silent) {
      for (let c = 0; c < this.candidates.length; c++) {
        const s = this.periodicity(this.candidates[c]) * this.prior[c];
        this.scores[c] = s;
        if (s > bestScore) { bestScore = s; best = c; }
      }
    }
    const raw = best >= 0 ? this.periodicity(this.candidates[best]) : 0;
    const dtInduce = INDUCE_EVERY / this.rate;
    if (best < 0 || raw < MIN_PERIODICITY) {
      // No periodic evidence: hold the tempo, let confidence fade.
      this.confidence *= Math.exp(-dtInduce / HOLD_DECAY);
      this.pendingCount = 0;
      return;
    }
    // Parabolic refinement between grid neighbours.
    let estimate = this.candidates[best];
    if (best > 0 && best < this.scores.length - 1) {
      const a = this.scores[best - 1], b = this.scores[best], c = this.scores[best + 1];
      const denom = a - 2 * b + c;
      if (denom < 0) estimate += GRID_STEP * Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
    }
    this.decide(estimate, bestScore);
    if (!this.tempo) return;
    const own = this.periodicity(this.tempo);
    const target = clamp01((own - MIN_PERIODICITY) / 0.45);
    this.confidence += 0.2 * (target - this.confidence);
    this.trackPhase(n, dtInduce);
  }

  /** Mean normalized autocorrelation at the first HARMONICS multiples of the beat period. */
  private periodicity(bpm: number): number {
    const lag = (60 * this.rate) / bpm;
    let total = 0;
    for (let k = 1; k <= HARMONICS; k++) total += this.acfAt(k * lag);
    return total / HARMONICS;
  }

  private acfAt(lag: number): number {
    const i = Math.floor(lag), f = lag - i;
    if (i + 1 >= this.acf.length) return 0;
    return this.acf[i] * (1 - f) + this.acf[i + 1] * f;
  }

  private decide(estimate: number, score: number): void {
    if (!this.tempo) {
      // First lock after two agreeing estimates.
      if (this.pendingCount > 0 && Math.abs(estimate / this.pending - 1) < 0.03) {
        this.tempo = estimate;
        this.pendingCount = 0;
      } else {
        this.pending = estimate;
        this.pendingCount = 1;
      }
      return;
    }
    const ratio = estimate / this.tempo;
    if (Math.abs(ratio - 1) < 0.03) {
      // Refine: follow the estimate gently.
      this.tempo += 0.1 * (estimate - this.tempo);
      this.pendingCount = 0;
      return;
    }
    if (this.pendingCount > 0 && Math.abs(estimate / this.pending - 1) < 0.03) {
      this.pending += 0.5 * (estimate - this.pending);
      this.pendingCount++;
    } else {
      this.pending = estimate;
      this.pendingCount = 1;
    }
    const octave = Math.abs(Math.log2(ratio) - Math.round(Math.log2(ratio))) < 0.04;
    const needed = octave ? 12 : 4;
    const current = this.periodicity(this.tempo) * this.priorAt(this.tempo);
    if (this.pendingCount >= needed && score > current * (octave ? 1.2 : 1.05)) {
      this.tempo = this.pending;
      this.pendingCount = 0;
    }
  }

  private priorAt(bpm: number): number {
    const octaves = Math.log2(bpm / 120);
    return Math.exp(-0.5 * octaves * octaves);
  }

  /**
   * Folds the recent onset strength at the beat period to find when the last
   * beat fell, then steers the clock toward it over the next interval.
   */
  private trackPhase(n: number, interval: number): void {
    const { smooth } = this;
    const period = (60 * this.rate) / this.tempo;
    const last = n - 1;
    const beatsBack = Math.min(16, Math.floor((n - 2) / period));
    const at = (x: number) => {
      const i = Math.floor(x), f = x - i;
      return i < 0 ? 0 : smooth[i] * (1 - f) + smooth[Math.min(i + 1, last)] * f;
    };
    const score = (offset: number) => {
      let s = 0, weight = 1;
      for (let k = 0; k < beatsBack; k++, weight *= 0.85) s += weight * at(last - offset - k * period);
      return s;
    };
    const steps = Math.ceil(period);
    const values = this.phaseScores.length >= steps ? this.phaseScores : (this.phaseScores = new Float64Array(steps));
    let globalBest = 0;
    for (let o = 0; o < steps; o++) {
      values[o] = score(o);
      if (values[o] > values[globalBest]) globalBest = o;
    }
    // Stay with the peak nearest the clock unless another is clearly
    // stronger: straight eighths or offbeat hats offer two nearly equal
    // alignments, and flipping between them would wobble the phase.
    const predicted = Math.round(frac(this.beats) * period - ODF_DELAY);
    let localBest = -1;
    for (let d = -Math.floor(steps / 4); d <= Math.floor(steps / 4); d++) {
      const o = (((predicted + d) % steps) + steps) % steps;
      if (localBest < 0 || values[o] > values[localBest]) localBest = o;
    }
    const bestOffset = values[globalBest] > 1.25 * values[localBest] ? globalBest : localBest;
    const bestScore = values[bestOffset];
    if (bestScore <= 0) return;
    const a = values[(bestOffset - 1 + steps) % steps], c = values[(bestOffset + 1) % steps];
    const denom = a - 2 * bestScore + c;
    let offset = bestOffset;
    if (denom < 0) offset += Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
    // Time since the last beat, at the newest sample.
    const sinceFrames = offset + ODF_DELAY;
    const measured = frac(sinceFrames / period);
    const error = wrapHalf(measured - frac(this.beats));
    // Large errors (a fresh lock, a tempo change) close faster than drift.
    const gain = Math.abs(error) > 0.15 ? 0.5 : 0.2;
    // Never more than MAX_NUDGE faster or slower than the tempo itself.
    const limit = (MAX_NUDGE * this.tempo) / 60;
    this.nudgeRate = Math.max(-limit, Math.min(limit, (gain * error) / interval));
    this.nudgeLeft = interval;
  }
}
