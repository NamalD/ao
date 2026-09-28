import { defaultNight, nextNightMode, nightBrightness, NightSettings, nightSpeed } from "../shared/night";

/** How often the schedule is re-read; the CSS transition smooths the steps. */
const TICK_MS = 30_000;

/**
 * Night fade: a black layer over the stage, under the editor, whose opacity
 * follows the nightly schedule. It updates on a slow timer, not per frame.
 * `timeScale` is the optional night slowdown for Hydra and solids.
 */
export class NightFade {
  private readonly layer = document.createElement("div");
  private settings: NightSettings = { ...defaultNight, mode: "off" };
  timeScale = 1;

  constructor(stage: HTMLElement) {
    this.layer.id = "night";
    stage.after(this.layer);
    this.apply();
    setInterval(() => this.apply(), TICK_MS);
  }

  get current(): NightSettings {
    return this.settings;
  }

  set(settings: NightSettings): void {
    this.settings = settings;
    this.apply();
  }

  /** Schedule, then forced on, then forced off; returns the new settings. */
  cycle(): NightSettings {
    this.set({ ...this.settings, mode: nextNightMode(this.settings.mode) });
    return this.settings;
  }

  private apply(): void {
    const now = new Date();
    this.layer.style.opacity = (1 - nightBrightness(this.settings, now)).toFixed(3);
    this.timeScale = nightSpeed(this.settings, now);
  }
}
