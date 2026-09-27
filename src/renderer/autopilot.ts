import {
  AutopilotScheduler, AutopilotSettings, isEmptySketch, ShuffleBag, SwitchReason,
} from "../shared/autopilot";
import type { AudioFeatures } from "../shared/features";
import { SectionDetector, SectionEvent } from "../shared/sections";

export interface AutopilotHost {
  listSketches(): Promise<string[]>;
  readSketch(name: string): Promise<string>;
  /** The sketch showing now. */
  current(): string;
  /** Crossfades to `name`; resolves to false when the sketch failed to run. */
  switchTo(name: string): Promise<boolean>;
  /** Whether a crossfade is still running: no new switch starts until it ends. */
  fading(): boolean;
  flash(message: string): void;
  log(message: string): void;
  save(patch: Partial<AutopilotSettings>): void;
}

/** How often the dwell timer is checked, ms. */
const TICK_MS = 500;
/** Longest wait `alignSwitch` may ask for, ms. */
const MAX_ALIGN_MS = 4000;
/** Sketches tried in a row when some fail to run or are empty. */
const ATTEMPTS = 4;

const seconds = () => performance.now() / 1000;

/**
 * Ambient autopilot: shuffles through the sketches, switching with a
 * crossfade when the music drops or changes section, or when the dwell time
 * runs out. The decisions live in src/shared (SectionDetector,
 * AutopilotScheduler, ShuffleBag); this wires them to the audio stream, a
 * timer, and the renderer. Nothing runs while it's off.
 */
export class Autopilot {
  private settings: AutopilotSettings;
  private readonly scheduler: AutopilotScheduler;
  private detector = new SectionDetector();
  private readonly bag = new ShuffleBag();
  private timer: ReturnType<typeof setInterval> | undefined;
  private switching = false;
  private pendingAlign: ReturnType<typeof setTimeout> | undefined;
  /** Sketches shown, newest last, for "previous" while shuffling. */
  private readonly history: string[] = [];

  /**
   * Hook for aligning a switch to the music: how many ms to wait before
   * switching for `reason` (0, the default, switches now). Tempo tracking can
   * set it to the time left until the next bar boundary (from `ao.bar` and
   * its phase), so fades start on the one. Waits are capped at 4 s.
   */
  alignSwitch: (reason: SwitchReason | "skip") => number = () => 0;

  constructor(private readonly host: AutopilotHost, settings: AutopilotSettings) {
    this.settings = settings;
    this.scheduler = new AutopilotScheduler(settings, seconds());
    this.apply();
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }

  get fadeSeconds(): number {
    return this.settings.fadeSeconds;
  }

  /** Settings as read from settings.json. */
  configure(settings: AutopilotSettings): void {
    this.settings = settings;
    this.apply();
  }

  /** Ctrl+Shift+A and ambient `a`. */
  toggle(): void {
    this.settings = { ...this.settings, enabled: !this.settings.enabled };
    this.host.save({ enabled: this.settings.enabled });
    this.apply();
    const s = this.settings;
    this.host.flash(s.enabled
      ? `autopilot on: every ${s.dwellSeconds} s${s.switchOnSections ? ", or on drops and section changes" : ""}`
      : "autopilot off");
  }

  /** Every sketch switch, by hand or not, restarts the dwell timer. */
  switched(name: string): void {
    this.scheduler.switched(seconds());
    if (this.history.at(-1) !== name) this.history.push(name);
    if (this.history.length > 50) this.history.shift();
  }

  /** Typing or running code: autopilot holds off while the editor is in use. */
  edited(): void {
    this.scheduler.edited(seconds());
  }

  setEditorVisible(visible: boolean): void {
    this.scheduler.setEditorVisible(visible);
  }

  /** Each analysis frame from the capture. */
  feed(features: AudioFeatures): void {
    if (!this.settings.enabled || !this.settings.switchOnSections) return;
    const event = this.detector.push(features);
    if (event) this.consider(event);
  }

  /** Crossfades to the next sketch in the shuffle now (ambient `k`). */
  skip(): Promise<void> {
    return this.advance("skip");
  }

  /** The sketch shown before this one, if any (ambient `j` while shuffling). */
  previous(): string | undefined {
    this.history.pop();
    return this.history.pop();
  }

  private consider(event: SectionEvent): void {
    const now = seconds();
    const reason = this.scheduler.event(event, now);
    const why = reason ? "switching" : this.scheduler.paused(now) ? "editing, ignored" : "ignored";
    this.host.log(`autopilot: ${event.kind} (${event.detail}, strength ${event.strength.toFixed(2)}) after ${this.scheduler.elapsed(now).toFixed(0)} s: ${why}`);
    if (reason) this.schedule(reason, event.detail);
  }

  private schedule(reason: SwitchReason, detail = ""): void {
    if (this.switching || this.pendingAlign !== undefined || this.host.fading()) return;
    const wait = Math.min(MAX_ALIGN_MS, Math.max(0, this.alignSwitch(reason) || 0));
    if (wait === 0) {
      void this.advance(reason, detail);
      return;
    }
    this.pendingAlign = setTimeout(() => {
      this.pendingAlign = undefined;
      void this.advance(reason, detail);
    }, wait);
  }

  private async advance(reason: SwitchReason | "skip", detail = ""): Promise<void> {
    if (this.switching) return;
    this.switching = true;
    try {
      const names = await this.host.listSketches();
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const name = this.bag.next(names, this.host.current());
        if (!name) {
          if (reason === "skip") this.host.flash("autopilot: no other sketch to switch to");
          return;
        }
        if (isEmptySketch(await this.host.readSketch(name).catch(() => ""))) continue;
        const label = reason === "skip" ? "" : ` (${reason})`;
        this.host.flash(`autopilot → ${name}${label}`);
        this.host.log(`autopilot → ${name}${label}${detail ? `: ${detail}` : ""}`);
        if (await this.host.switchTo(name)) return;
        this.host.log(`autopilot: ${name} failed to run; trying another`);
      }
    } finally {
      // Switching took time; the dwell counts from its end either way.
      this.scheduler.switched(seconds());
      this.switching = false;
    }
  }

  private apply(): void {
    const s = this.settings;
    this.scheduler.configure({ dwellSeconds: s.dwellSeconds, minSeconds: s.minSeconds, switchOnSections: s.switchOnSections });
    clearInterval(this.timer);
    clearTimeout(this.pendingAlign);
    this.pendingAlign = undefined;
    this.timer = undefined;
    if (!s.enabled) return;
    // A fresh start: the dwell counts from now, and the detector relearns the music.
    this.scheduler.switched(seconds());
    this.detector = new SectionDetector();
    this.timer = setInterval(() => {
      const reason = this.scheduler.tick(seconds());
      if (reason) this.schedule(reason);
    }, TICK_MS);
  }
}
