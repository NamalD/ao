/**
 * Autopilot: ambient auto-switching between sketches, like MilkDrop's. Pure
 * parts only (settings, the shuffle bag and the switch scheduler), so they
 * can be tested with injected clocks and random numbers.
 */
import type { SectionEvent } from "./sections";

export interface AutopilotSettings {
  enabled: boolean;
  /** Switch after this long on one sketch when nothing in the music does it first, seconds. */
  dwellSeconds: number;
  /** Crossfade length for every sketch switch, seconds; 0 cuts. */
  fadeSeconds: number;
  /** Switch on drops and section changes, not only on the dwell timer. */
  switchOnSections: boolean;
  /** No section switch within this long of the last switch, unless a strong drop, seconds. */
  minSeconds: number;
}

export const defaultAutopilot: AutopilotSettings = {
  enabled: false, dwellSeconds: 120, fadeSeconds: 4, switchOnSections: true, minSeconds: 45,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const number = (value: unknown, fallback: number, lo: number, hi: number) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;

/** Fills in `fallback` for missing or mistyped fields and clamps the numbers. */
export function normalizeAutopilot(raw: unknown, fallback: AutopilotSettings = defaultAutopilot): AutopilotSettings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    enabled: bool(r.enabled, fallback.enabled),
    dwellSeconds: number(r.dwellSeconds, fallback.dwellSeconds, 5, 24 * 3600),
    fadeSeconds: number(r.fadeSeconds, fallback.fadeSeconds, 0, 60),
    switchOnSections: bool(r.switchOnSections, fallback.switchOnSections),
    minSeconds: number(r.minSeconds, fallback.minSeconds, 5, 24 * 3600),
  };
}

/** Challenge attempts never come up in the shuffle. */
export const shuffleable = (name: string) => !name.startsWith("challenge-");

/** True for a sketch with nothing but whitespace and comments: nothing to show. */
export function isEmptySketch(code: string): boolean {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").trim() === "";
}

/**
 * Shuffle without playlists: every sketch plays once, in random order, before
 * any repeats, and a new round never starts with the one that just played.
 * The list is re-read on every pick, so new and deleted sketches take effect.
 */
export class ShuffleBag {
  private bag: string[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  /** The next sketch other than `current`, or undefined when there is none. */
  next(names: readonly string[], current = ""): string | undefined {
    const available = new Set(names.filter(shuffleable));
    available.delete(current);
    if (!available.size) return undefined;
    this.bag = this.bag.filter((name) => available.has(name));
    if (!this.bag.length) this.refill([...available].sort(), current);
    return this.bag.shift();
  }

  /** Takes `name` out of this round, e.g. because it turned out to be empty. */
  skip(name: string): void {
    this.bag = this.bag.filter((n) => n !== name);
  }

  private refill(names: string[], current: string): void {
    // Fisher-Yates with the injected random source.
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    this.bag = names.filter((n) => n !== current);
  }
}

export type SwitchReason = "timer" | "drop" | "change" | "breakdown";

export interface SchedulerOptions {
  dwellSeconds: number;
  minSeconds: number;
  switchOnSections: boolean;
  /** A drop at least this strong may switch before `minSeconds`... */
  strongDrop: number;
  /** ...but never sooner than this after the last switch, seconds. */
  strongDropMinSeconds: number;
  /** Autopilot waits while the editor is showing and was typed in within this long, seconds. */
  editPauseSeconds: number;
  /** Which section events may switch. Breakdowns only arm the drop that follows. */
  sectionKinds: readonly SwitchReason[];
}

export const defaultSchedulerOptions: Omit<SchedulerOptions, "dwellSeconds" | "minSeconds" | "switchOnSections"> = {
  strongDrop: 0.6, strongDropMinSeconds: 15, editPauseSeconds: 60, sectionKinds: ["drop", "change"],
};

/**
 * Decides when autopilot switches. Clocks are passed in (seconds), so it's
 * testable; the renderer calls `tick` often and `event` for each section
 * event. Switches are held back while the user is editing: the sketch they
 * are working on must not vanish under them.
 */
export class AutopilotScheduler {
  private options: SchedulerOptions;
  private lastSwitch: number;
  private lastEdit = -Infinity;
  private editorVisible = false;

  constructor(options: Partial<SchedulerOptions> & Pick<SchedulerOptions, "dwellSeconds" | "minSeconds" | "switchOnSections">,
              now: number) {
    this.options = { ...defaultSchedulerOptions, ...options };
    this.lastSwitch = now;
  }

  configure(options: Partial<SchedulerOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /** Any switch, automatic or by hand, restarts the dwell timer. */
  switched(now: number): void {
    this.lastSwitch = now;
  }

  /** Typing or running code in the editor. */
  edited(now: number): void {
    this.lastEdit = now;
  }

  setEditorVisible(visible: boolean): void {
    this.editorVisible = visible;
  }

  /** Whether the user is editing, so autopilot holds off. */
  paused(now: number): boolean {
    return this.editorVisible && now - this.lastEdit < this.options.editPauseSeconds;
  }

  /** Seconds on the current sketch. */
  elapsed(now: number): number {
    return now - this.lastSwitch;
  }

  /** The dwell timer's verdict: "timer" once the dwell has passed, unless paused. */
  tick(now: number): SwitchReason | null {
    if (this.paused(now)) return null;
    return this.elapsed(now) >= this.options.dwellSeconds ? "timer" : null;
  }

  /**
   * A section event's verdict. Events that aren't allowed now are dropped,
   * not queued: a drop that came too soon is no reason to switch later.
   */
  event(event: SectionEvent, now: number): SwitchReason | null {
    const o = this.options;
    if (!o.switchOnSections || !o.sectionKinds.includes(event.kind) || this.paused(now)) return null;
    const elapsed = this.elapsed(now);
    if (elapsed >= o.minSeconds) return event.kind;
    const strong = event.kind === "drop" && event.strength >= o.strongDrop;
    return strong && elapsed >= Math.min(o.strongDropMinSeconds, o.minSeconds) ? event.kind : null;
  }
}
