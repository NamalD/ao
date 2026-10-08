/**
 * The listen addon. Analysis runs here, in the main process. napi measured
 * faster than WASM (20.7 µs vs 29.5 µs) and does not copy the input. The
 * shipped push, which also writes features back into arrays created once,
 * measures about 27 µs. A chunk does not allocate across the boundary.
 *
 * The renderer is sandboxed and cannot load this. It receives features, and
 * section events, over IPC.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { AudioFeatures } from "../shared/features";
import type { SectionEvent } from "../shared/sections";
import type { TempoState } from "../shared/tempo";

const require = createRequire(join(process.cwd(), "package.json"));
const addon = require(join(process.cwd(), "native/ao-listen.node")) as Addon;

interface Addon {
  Engine: new (rate: number) => NativeEngine;
  SectionDetector: new () => NativeSections;
  EnergyTracker: new () => NativeEnergy;
  TempoTracker: new (rate: number) => NativeTempo;
  Synthetic: new (rate: number) => NativeSynthetic;
  parecCommand(target: string, executable: string): string[];
}

export interface NativeEngine {
  push(samples: Float32Array): void;
  resetSections(): void;
  takeSection(): SectionEvent | null;
  readonly scalars: Float64Array;
  readonly spectrum: Float32Array;
  readonly wave: Float32Array;
  readonly chroma: Float32Array;
}

interface NativeSections {
  push(time: number, loudness: number, bass: number, spectrum: number[]): SectionEvent | null;
  readonly energy: number;
  reset(): void;
}

interface NativeEnergy {
  push(time: number, loudness: number, bass: number, spectrum: number[]): { energy: number; drop: number };
}

interface NativeTempo {
  push(samples: Float32Array): TempoState;
}

interface NativeSynthetic {
  fill(samples: Float32Array): void;
}

/** Scalars written by `Engine.push`, in order. */
const TIME = 0, LOUDNESS = 1, IMPULSE = 2, BEAT = 3, BASS = 4, MID = 5, HIGH = 6;
const BALANCE = 7, WIDTH = 8, KEY = 9, ENERGY = 10, DROP = 11, BPM = 12, BEATS = 13, CONFIDENCE = 14;

/** A copy of the engine's latest features. The engine's own arrays are reused. */
export function snapshot(engine: NativeEngine): AudioFeatures {
  const s = engine.scalars;
  return {
    time: s[TIME], loudness: s[LOUDNESS], impulse: s[IMPULSE], beat: s[BEAT],
    bass: s[BASS], mid: s[MID], high: s[HIGH],
    spectrum: Array.from(engine.spectrum),
    wave: new Float32Array(engine.wave),
    balance: s[BALANCE], width: s[WIDTH],
    chroma: Array.from(engine.chroma), key: s[KEY],
    energy: s[ENERGY], drop: s[DROP],
    tempo: { bpm: s[BPM], beats: s[BEATS], confidence: s[CONFIDENCE] },
  };
}

export class Engine {
  readonly native: NativeEngine;
  constructor(rate: number) { this.native = new addon.Engine(rate); }
  push(samples: Float32Array): void { this.native.push(samples); }
  resetSections(): void { this.native.resetSections(); }
  takeSection(): SectionEvent | null { return this.native.takeSection(); }
  features(): AudioFeatures { return snapshot(this.native); }
}

/**
 * The old analyser shape, so tests drive PCM the way capture does. Time is
 * frames pushed ÷ sample rate; the clock argument is ignored.
 */
export class Analyser {
  private readonly engine: Engine;
  constructor(rate = 48000) { this.engine = new Engine(rate); }
  push(interleaved: Float32Array, _now = 0): AudioFeatures {
    this.engine.push(interleaved);
    return this.engine.features();
  }
}

export class SectionDetector {
  private readonly inner = new addon.SectionDetector();
  push(features: AudioFeatures): SectionEvent | null {
    return this.inner.push(features.time, features.loudness, features.bass, features.spectrum);
  }
  get energy(): number { return this.inner.energy; }
  reset(): void { this.inner.reset(); }
}

export class EnergyTracker {
  private readonly inner = new addon.EnergyTracker();
  push(features: AudioFeatures): { energy: number; drop: number } {
    return this.inner.push(features.time, features.loudness, features.bass, features.spectrum);
  }
}

export class TempoTracker {
  private readonly inner: NativeTempo;
  constructor(rate = 48000) { this.inner = new addon.TempoTracker(rate); }
  push(interleaved: Float32Array): TempoState { return this.inner.push(interleaved); }
}

export class Synthetic {
  private readonly inner: NativeSynthetic;
  constructor(rate = 48000) { this.inner = new addon.Synthetic(rate); }
  fill(samples: Float32Array): void { this.inner.fill(samples); }
}

/** `[command, args]` for parec. `executable` is spawned as given. */
export function parecCommand(target: string, executable: string): [string, string[]] {
  const [command, ...args] = addon.parecCommand(target, executable);
  return [command, args];
}
