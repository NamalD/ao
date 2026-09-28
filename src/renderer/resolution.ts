/**
 * Automatic render scale for solids (`scale: "auto"`, their default). Each
 * solid reports how long the GPU took to draw it; the governor picks one scale for all of them that keeps their combined
 * time within a frame budget. Drawing time grows with the pixel count, the
 * square of the scale, so the scale follows the square root of budget over
 * cost. No DOM or WebGL here, so it can be tested.
 */

/** GPU milliseconds a frame that automatic solids may take together. */
export const SOLID_BUDGET_MS = 10;
export const MIN_SCALE = 0.25;
/** Scales are multiples of this, so small swings in cost don't resize canvases. */
const STEP = 0.05;
/** A solid that hasn't reported for this long no longer counts. */
const STALE_MS = 1000;
/** How far the cost moves toward a heavier frame, and toward a lighter one. */
const EASE_UP = 0.3;
const EASE_DOWN = 0.05;
/** After any change, wait this long before climbing again. */
const SETTLE_MS = 2000;

interface Cost { fullScaleMs: number; at: number }

export class ResolutionGovernor {
  private costs = new Map<object, Cost>();
  /** Every full-scale cost reported, unsmoothed, for measuring a sketch. */
  private totals = new Map<object, { sum: number; count: number }>();
  private current = 1;
  private changedAt = -Infinity;

  constructor(private readonly budgetMs = SOLID_BUDGET_MS) {}

  /**
   * Records that `solid` took `ms` of GPU time at `scale`, at time `now`
   * (milliseconds), and returns the scale to draw at next.
   */
  report(solid: object, ms: number, scale: number, now: number): number {
    if (!(ms >= 0) || !(scale > 0)) return this.scaleAt(now);
    const fullScaleMs = ms / (scale * scale);
    const total = this.totals.get(solid) ?? { sum: 0, count: 0 };
    this.totals.set(solid, { sum: total.sum + fullScaleMs, count: total.count + 1 });
    const old = this.costs.get(solid);
    // Loud passages make displaced solids suddenly slower: follow heavier
    // frames within a few frames, and lighter ones slowly, so neither one
    // stray frame nor a brief lull resizes the canvas.
    const ease = !old ? 1 : fullScaleMs > old.fullScaleMs ? EASE_UP : EASE_DOWN;
    const eased = old ? old.fullScaleMs + ease * (fullScaleMs - old.fullScaleMs) : fullScaleMs;
    this.costs.set(solid, { fullScaleMs: eased, at: now });
    return this.scaleAt(now);
  }

  /** The scale automatic solids draw at, at time `now`. */
  scaleAt(now: number): number {
    let total = 0;
    for (const [solid, cost] of this.costs) {
      if (now - cost.at > STALE_MS) this.costs.delete(solid);
      else total += cost.fullScaleMs;
    }
    // With no automatic solids left, the next sketch starts afresh.
    if (!total) {
      this.changedAt = -Infinity;
      return (this.current = 1);
    }
    const ideal = Math.sqrt(this.budgetMs / total);
    const target = Math.min(1, Math.max(MIN_SCALE, Math.round(Math.floor(ideal / STEP + 1e-9) * STEP * 100) / 100));
    // Drop once clearly over budget; climb only with room to spare and not
    // straight after a change, so music that swells and fades doesn't keep
    // resizing the canvas.
    const drop = ideal < this.current - STEP;
    const climb = ideal >= this.current + 2 * STEP && now - this.changedAt >= SETTLE_MS;
    if (target !== this.current && (drop || climb)) {
      this.current = target;
      this.changedAt = now;
    }
    return this.current;
  }

  /**
   * The mean GPU milliseconds a frame of every solid reported so far would
   * take at full scale, summed over the solids: what screenshots print.
   */
  measuredMs(): number {
    let sum = 0;
    for (const total of this.totals.values()) sum += total.sum / total.count;
    return sum;
  }

  /** Whether any automatic solid has reported recently. */
  active(now: number): boolean {
    this.scaleAt(now);
    return this.costs.size > 0;
  }
}

/** The governor every deck's automatic solids share, since they share the GPU. */
export const shaderResolution = new ResolutionGovernor();
