import type { AudioFeatures } from "../shared/features";
import { Deck } from "./deck";

/** Eases the fade in and out, so neither end starts with a jolt. */
export const easeFade = (p: number) => {
  const x = Math.min(1, Math.max(0, p));
  return x * x * (3 - 2 * x);
};

interface Fade {
  /** When the fade began (performance.now), or null while the incoming sketch starts up. */
  start: number | null;
  ms: number;
  /** Eased progress, 0..1: the incoming deck's opacity. */
  mix: number;
}

/**
 * Two decks and the crossfade between them.
 *
 * Normally one deck is showing and the other is parked: reset, shrunk to a
 * couple of pixels, not rendered. A crossfade wakes the parked deck, makes it
 * current (so the editor and Ctrl+Enter address the incoming sketch), and for
 * the length of the fade renders both, the incoming canvas stacked above the
 * outgoing one with its CSS opacity rising. Then the outgoing deck is reset
 * and parked again. A cut (`cut`) is the old behaviour: hush the current
 * deck and run the next sketch on it.
 *
 * The visible result is the stacked deck canvases, which page captures
 * (screenshots, challenge snapshots) see as they are. A canvas capture
 * stream can't see CSS, so while the recorder is capturing `#stage`, the
 * mixer draws the same blend into `#stage` (a 2D canvas) each frame and shows
 * that instead. Otherwise `#stage` stays hidden and tiny, costing nothing.
 */
export class Mixer {
  private readonly decks: Deck[] = [];
  private current_: Deck;
  private outgoing: Deck | null = null;
  private fade: Fade | null = null;
  private readonly context: CanvasRenderingContext2D;
  private compositing = false;
  private exposed = new Set<string>();

  /** Whether something (the recorder) is capturing `#stage`'s stream. */
  capturing: () => boolean = () => false;

  constructor(private readonly stage: HTMLCanvasElement, private width: number, private height: number,
              private readonly onError: (message: string) => void) {
    this.context = stage.getContext("2d")!;
    this.stage.width = this.stage.height = 1;
    this.stage.style.visibility = "hidden";
    this.current_ = this.addDeck();
    this.exposeGlobals();
  }

  /** The deck the editor addresses: the one showing, or fading in. */
  get current(): Deck {
    return this.current_;
  }

  get fading(): boolean {
    return this.fade !== null;
  }

  /** Progress of the running fade, 0..1, or null. */
  get mix(): number | null {
    return this.fade?.mix ?? null;
  }

  /**
   * Starts switching to a new sketch: the parked deck, reset and resized,
   * becomes current, while the old one keeps playing at full opacity until
   * `startFade`. Run the incoming sketch on `current` in between. A fade
   * still running finishes at once.
   */
  beginCrossfade(): Deck {
    this.finishFade();
    const incoming = this.decks.find((d) => d !== this.current_) ?? this.addDeck();
    incoming.reset();
    incoming.resize(this.width, this.height);
    this.outgoing = this.current_;
    this.current_ = incoming;
    this.fade = { start: null, ms: 0, mix: 0 };
    // Above the outgoing deck, below #stage and every overlay after it.
    this.stage.before(incoming.canvas);
    incoming.canvas.style.display = "";
    incoming.canvas.style.opacity = "0";
    this.exposeGlobals();
    return incoming;
  }

  /** Starts the fade prepared by `beginCrossfade`, over `seconds`. */
  startFade(seconds: number): void {
    if (!this.fade || this.fade.start !== null) return;
    this.fade.start = performance.now();
    this.fade.ms = Math.max(0, seconds * 1000);
    if (this.fade.ms === 0) this.finishFade();
  }

  /** A hard cut on the current deck: what switching sketches always did. */
  cut(): void {
    this.finishFade();
    this.current_.reset();
  }

  /** Ends the fade now: the incoming deck shows alone, the outgoing one parks. */
  finishFade(): void {
    const out = this.outgoing;
    this.fade = null;
    this.outgoing = null;
    this.current_.canvas.style.opacity = "";
    if (!out) return;
    out.park();
    out.canvas.style.display = "none";
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.current_.resize(width, height);
    this.outgoing?.resize(width, height);
  }

  /** Renders one frame: one deck, or two while fading. `now` is performance.now(). */
  frame(dt: number, features: AudioFeatures, now: number): void {
    const fade = this.fade;
    if (fade?.start != null) {
      const p = fade.ms > 0 ? (now - fade.start) / fade.ms : 1;
      if (p >= 1) this.finishFade();
      else fade.mix = easeFade(p);
    }
    const pending = this.fade !== null && this.fade.start === null;
    this.outgoing?.render(dt, features);
    if (!pending) this.current_.render(dt, features);
    if (this.fade) this.current_.canvas.style.opacity = this.fade.mix.toFixed(3);
    this.composite();
  }

  /** Mirrors the stacked canvases into #stage while the recorder captures it. */
  private composite(): void {
    const capturing = this.capturing();
    if (capturing !== this.compositing) {
      this.compositing = capturing;
      this.stage.style.visibility = capturing ? "" : "hidden";
      for (const deck of this.decks) deck.canvas.style.visibility = capturing ? "hidden" : "";
      if (!capturing) this.stage.width = this.stage.height = 1;
    }
    if (!capturing) return;
    const { stage, context: g } = this;
    if (stage.width !== this.width || stage.height !== this.height) {
      stage.width = this.width;
      stage.height = this.height;
    }
    g.globalAlpha = 1;
    g.clearRect(0, 0, stage.width, stage.height);
    if (this.outgoing) g.drawImage(this.outgoing.canvas, 0, 0, stage.width, stage.height);
    const mix = this.fade ? this.fade.mix : 1;
    if (mix > 0) {
      g.globalAlpha = mix;
      g.drawImage(this.current_.canvas, 0, 0, stage.width, stage.height);
    }
  }

  private addDeck(): Deck {
    const deck = new Deck(this.width, this.height, `deck ${this.decks.length + 1}`, this.onError);
    this.decks.push(deck);
    this.stage.before(deck.canvas);
    deck.canvas.style.visibility = this.compositing ? "hidden" : "";
    return deck;
  }

  /**
   * Keeps Hydra's names on `window`, as `makeGlobal` did, for code outside a
   * sketch's scope (the DevTools console, string timers): each one reads and
   * writes the current deck. Call again after a run, for `setFunction`'s
   * new names.
   */
  exposeGlobals(): void {
    const target = window as unknown as Record<string, unknown>;
    target.loadScript ??= this.current_.hydra.loadScript;
    for (const name of Object.keys(this.current_.synth)) {
      if (this.exposed.has(name)) continue;
      this.exposed.add(name);
      try {
        Object.defineProperty(target, name, {
          configurable: true,
          get: () => this.current_.synth[name],
          set: (value) => { this.current_.synth[name] = value; },
        });
      } catch {
        // A browser global that can't be redefined keeps its meaning.
      }
    }
  }
}
