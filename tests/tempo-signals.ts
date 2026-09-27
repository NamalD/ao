// Synthetic drum tracks for the tempo tests: clicks, kicks, snares, hats and
// pads on a known beat grid, with jitter, swing, tempo changes and silence.

export const RATE = 48000;
/** parec's 20 ms chunk. */
export const CHUNK = 960;

export interface TrackOptions {
  bpm: number;
  seconds: number;
  /** Switch to `bpm` at `at` seconds. */
  change?: { at: number; bpm: number };
  /** Kick on every beat, or on beats 1 and 3 only. */
  kick?: "every" | "half";
  click?: boolean;
  /** Snare on beats 2 and 4. */
  snare?: boolean;
  /** Hats on every eighth note. */
  hats?: boolean;
  /** Delay of the off-beat eighths as a fraction of the beat (0 = straight, 1/6 = triplet swing). */
  swing?: number;
  /** Uniform random timing error of each hit, ± seconds. */
  jitter?: number;
  pad?: boolean;
  /** Breakdowns: drums drop out, the pad plays on. Spans in seconds: [from, to]. */
  drop?: [number, number][];
  /** Muted spans in seconds: [from, to]. */
  silence?: [number, number][];
  seed?: number;
}

export interface Track {
  mono: Float32Array;
  /** Ideal (unjittered) beat times in seconds; beat 0 is a downbeat. */
  beats: number[];
}

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderTrack(o: TrackOptions): Track {
  const n = Math.round(o.seconds * RATE);
  const mono = new Float32Array(n);
  const rand = random(o.seed ?? 1);
  const beats: number[] = [];
  for (let t = 0.1; t < o.seconds + 1; ) {
    beats.push(t);
    t += 60 / (o.change && t >= o.change.at ? o.change.bpm : o.bpm);
  }
  const add = (at: number, length: number, voice: (t: number) => number) => {
    if (o.drop?.some(([from, to]) => at >= from && at < to)) return;
    const t0 = at + (o.jitter ? (rand() * 2 - 1) * o.jitter : 0);
    const first = Math.max(0, Math.ceil(t0 * RATE));
    const last = Math.min(n, Math.ceil((t0 + length) * RATE));
    for (let i = first; i < last; i++) mono[i] += voice(i / RATE - t0);
  };
  const kick = (t: number) => 0.6 * Math.exp(-t * 18) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-t * 30)) * t);
  const click = (t: number) => 0.5 * Math.exp(-t * 400) * Math.sin(2 * Math.PI * 1500 * t);
  let previous = 0;
  const noise = () => { const x = rand() * 2 - 1, y = x - previous; previous = x; return y; };
  const hat = (t: number) => 0.08 * Math.exp(-t * 90) * noise();
  const snare = (t: number) => Math.exp(-t * 25) * (0.25 * (rand() * 2 - 1) + 0.2 * Math.sin(2 * Math.PI * 190 * t));
  beats.forEach((b, i) => {
    const next = beats[i + 1] ?? b + 60 / o.bpm;
    if (o.kick === "every" || (o.kick === "half" && i % 2 === 0)) add(b, 0.4, kick);
    if (o.click) add(b, 0.03, click);
    if (o.snare && i % 2 === 1) add(b, 0.25, snare);
    if (o.hats) {
      add(b, 0.06, hat);
      add(b + (next - b) * (0.5 + (o.swing ?? 0)), 0.06, hat);
    }
  });
  if (o.pad) {
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      mono[i] += 0.12 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t + Math.sin(t)))
        + 0.08 * Math.sin(2 * Math.PI * 55 * t);
    }
  }
  for (const [from, to] of o.silence ?? []) mono.fill(0, Math.round(from * RATE), Math.min(n, Math.round(to * RATE)));
  return { mono, beats };
}

/** The track as interleaved stereo chunks, with each chunk's end time. */
export function* chunks(mono: Float32Array, frames = CHUNK): Generator<{ samples: Float32Array; end: number }> {
  for (let start = 0; start + frames <= mono.length; start += frames) {
    const samples = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) samples[2 * i] = samples[2 * i + 1] = mono[start + i];
    yield { samples, end: (start + frames) / RATE };
  }
}

/** Phase within the ideal beat at time t, 0..1. */
export function truePhase(beats: number[], t: number): number {
  let i = 0;
  while (i + 1 < beats.length && beats[i + 1] <= t) i++;
  const next = beats[i + 1] ?? beats[i] + (beats[i] - beats[i - 1]);
  return (t - beats[i]) / (next - beats[i]);
}

/** Circular distance between two phases, 0..0.5. */
export function phaseError(a: number, b: number): number {
  const d = (((a - b) % 1) + 1) % 1;
  return Math.min(d, 1 - d);
}
