import Hydra from "hydra-synth";
import type { AudioFeatures } from "../shared/features";
import { describeError } from "./runtime-errors";
import { Scene, SceneOptions } from "./scenes";
import { evaluateInScope, sketchScope } from "./scope";
import { makeSolidShapes } from "./solids";

/** Timer functions a sketch gets from its deck, so switching away can stop them. */
const TIMERS = ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] as const;
type TimerName = typeof TIMERS[number];

/** Size an idle deck shrinks to, so its buffers cost next to nothing. */
const PARKED = 2;

type Synth = Record<string, unknown> & { time: number; speed: number; hush(): void; update: unknown; afterUpdate: unknown };
type Texture = { destroy?: () => void };

/**
 * One Hydra instance on its own canvas, with its own scenes, running one
 * sketch. Ao has two, so an outgoing and an incoming sketch can both animate
 * during a crossfade (see crossfade.ts).
 *
 * Hydra's globals (`osc`, `o0`, `s0`, `time`, `update`, `speed`, ...) belong
 * to one instance, so a deck's Hydra is created without `makeGlobal` and its
 * sketch is evaluated in a scope onto this deck's synth (see scope.ts), with
 * timers of its own that `reset` can clear.
 */
export class Deck {
  readonly canvas = document.createElement("canvas");
  readonly hydra: Hydra;
  readonly synth: Synth;
  private readonly scenes = new Map<HydraSource, Scene>();
  private readonly scope: object;
  private readonly timeouts = new Set<number>();
  private readonly intervals = new Set<number>();
  private readonly frames = new Set<number>();
  private readonly timers: Record<TimerName, unknown>;

  constructor(width: number, height: number, readonly label: string, private readonly onError: (message: string) => void) {
    this.canvas.className = "deck";
    this.canvas.width = width;
    this.canvas.height = height;
    this.hydra = new Hydra({
      canvas: this.canvas, width, height,
      detectAudio: false, autoLoop: false, makeGlobal: false,
      enableStreamCapture: false, precision: "highp",
    });
    this.synth = this.hydra.synth as unknown as Synth;
    for (const source of this.hydra.s) this.patchSource(source);
    this.timers = this.makeTimers();
    // Solids render into this deck's s0 when `.out()` is given no source.
    this.scope = sketchScope(this.synth, { ...this.timers, ...makeSolidShapes(() => this.hydra.s[0]) });
  }

  /**
   * Runs sketch code against this deck. Each call gets its own function
   * scope, so re-running a block that declares `const` works.
   */
  evaluate(code: string): Promise<unknown> {
    return evaluateInScope(code, this.scope);
  }

  /** Renders one frame: scenes first, then Hydra, which samples them. */
  render(dt: number, features: AudioFeatures): void {
    const hydra = this.hydra;
    const time = this.synth.time + dt * 0.001 * this.synth.speed;
    for (const [source, scene] of this.scenes) {
      if (source.src !== scene.canvas) continue;
      try {
        scene.render(hydra.width, hydra.height, time, dt / 1000, features);
      } catch (e) {
        this.onError(`scene: ${describeError(e)}`);
      }
    }
    try {
      hydra.tick(dt);
    } catch (e) {
      this.onError(`Hydra: ${describeError(e)}`);
    }
  }

  resize(width: number, height: number): void {
    if (width > 0 && height > 0 && (width !== this.hydra.width || height !== this.hydra.height)) {
      this.hydra.setResolution(width, height);
    }
  }

  /**
   * Stops everything the sketch left running, ready for the next one:
   * Hydra's outputs, sources and `update`, the sketch's timers, and its
   * scenes' buffers. `speed` and friends go back to Hydra's defaults.
   */
  reset(): void {
    for (const id of this.timeouts) clearTimeout(id);
    for (const id of this.intervals) clearInterval(id);
    for (const id of this.frames) cancelAnimationFrame(id);
    this.timeouts.clear();
    this.intervals.clear();
    this.frames.clear();
    this.synth.hush();
    Object.assign(this.synth, { speed: 1, bpm: 30, fps: undefined });
    // Scenes stay, so their WebGL contexts are reused rather than churned, but
    // give up their drawing buffers; hush has detached them from the sources.
    for (const scene of this.scenes.values()) scene.canvas.width = scene.canvas.height = 1;
  }

  /** Resets and shrinks an idle deck, so it holds almost no GPU memory. */
  park(): void {
    this.reset();
    this.resize(PARKED, PARKED);
  }

  get parked(): boolean {
    return this.hydra.width === PARKED && this.hydra.height === PARKED;
  }

  /** Each Hydra source can also host a GLSL scene: `s0.initScene(glsl)`. */
  private patchSource(source: HydraSource): void {
    source.initScene = (code: string, options?: SceneOptions) => {
      let scene = this.scenes.get(source);
      if (!scene) this.scenes.set(source, (scene = new Scene((message) => this.onError(message))));
      scene.load(code, options);
      if (source.src !== scene.canvas) source.init({ src: scene.canvas });
      source.dynamic = true;
    };
    // hydra-synth makes a new texture on every init and clear without freeing
    // the old one; free it, so switching sketches for hours doesn't leak.
    const holder = source as unknown as { tex: Texture };
    let tex = holder.tex;
    Object.defineProperty(holder, "tex", {
      configurable: true,
      get: () => tex,
      set: (next: Texture) => {
        if (tex && tex !== next) tex.destroy?.();
        tex = next;
      },
    });
  }

  /** Timer functions that remember their ids, so `reset` can clear them. */
  private makeTimers(): Record<TimerName, unknown> {
    const { timeouts, intervals, frames } = this;
    return {
      setTimeout: (handler: TimerHandler, ms?: number, ...args: unknown[]) => {
        // A string handler runs as global code, as the browser's would.
        const run = typeof handler === "function" ? handler : () => (0, eval)(handler);
        const id = window.setTimeout((...a: unknown[]) => {
          timeouts.delete(id);
          run(...a);
        }, ms, ...args);
        timeouts.add(id);
        return id;
      },
      setInterval: (handler: TimerHandler, ms?: number, ...args: unknown[]) => {
        const id = window.setInterval(handler, ms, ...args);
        intervals.add(id);
        return id;
      },
      clearTimeout: (id?: number) => { if (id !== undefined) timeouts.delete(id); window.clearTimeout(id); },
      clearInterval: (id?: number) => { if (id !== undefined) intervals.delete(id); window.clearInterval(id); },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = window.requestAnimationFrame((t) => {
          frames.delete(id);
          callback(t);
        });
        frames.add(id);
        return id;
      },
      cancelAnimationFrame: (id: number) => { frames.delete(id); window.cancelAnimationFrame(id); },
    };
  }
}
