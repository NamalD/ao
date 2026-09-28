/**
 * Night fade: the visuals dim over a nightly window so they aren't glaring
 * late at night. Pure, so the schedule can be tested without a clock.
 */

/** "schedule" follows `start`..`end`; "on" and "off" force it either way. */
export type NightMode = "schedule" | "on" | "off";
export const NIGHT_MODES: readonly NightMode[] = ["schedule", "on", "off"];

export interface NightSettings {
  mode: NightMode;
  /** Local wall-clock times, "HH:MM". The window may cross midnight. */
  start: string;
  end: string;
  /** Brightness at full night, 0..1: 0.4 keeps 40% of the light. */
  brightness: number;
  /** Minutes to ease down after `start`, and back up before `end`. */
  fadeMinutes: number;
  /** Hydra and solid time multiplier at full night, 0.1..1; 1 leaves speed alone. */
  speed: number;
}

export const defaultNight: NightSettings = {
  mode: "schedule", start: "22:00", end: "07:00", brightness: 0.4, fadeMinutes: 45, speed: 1,
};

const DAY = 24 * 60;

/** Minutes since midnight for "HH:MM", or undefined if it isn't a valid time. */
export function parseClock(text: unknown): number | undefined {
  if (typeof text !== "string") return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return undefined;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const number = (value: unknown, fallback: number, lo: number, hi: number) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
const clock = (value: unknown, fallback: string) => {
  const minutes = parseClock(value);
  if (minutes === undefined) return fallback;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

/** Fills in `fallback` for missing or mistyped fields and clamps the numbers. */
export function normalizeNight(raw: unknown, fallback: NightSettings = defaultNight): NightSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    mode: NIGHT_MODES.includes(r.mode as NightMode) ? (r.mode as NightMode) : fallback.mode,
    start: clock(r.start, fallback.start),
    end: clock(r.end, fallback.end),
    brightness: number(r.brightness, fallback.brightness, 0, 1),
    fadeMinutes: number(r.fadeMinutes, fallback.fadeMinutes, 0, 12 * 60),
    speed: number(r.speed, fallback.speed, 0.1, 1),
  };
}

/** Smoothstep, so the fade starts and ends gently. */
const ease = (x: number) => x * x * (3 - 2 * x);

/**
 * How far into night it is at `date`, 0 (day) to 1 (full night). Inside the
 * window the level eases up over `fadeMinutes` after `start` and back down
 * over the `fadeMinutes` before `end`; outside it, it is 0. A window with
 * `start` equal to `end` is empty.
 */
export function nightLevel(night: NightSettings, date: Date): number {
  if (night.mode === "on") return 1;
  if (night.mode === "off") return 0;
  const start = parseClock(night.start), end = parseClock(night.end);
  if (start === undefined || end === undefined) return 0;
  const length = (end - start + DAY) % DAY;
  const now = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const since = (now - start + DAY) % DAY;
  if (since >= length) return 0;
  if (night.fadeMinutes <= 0) return 1;
  return ease(clamp(Math.min(since, length - since) / night.fadeMinutes, 0, 1));
}

/** Brightness multiplier at `date`: 1 by day, `night.brightness` at full night. */
export function nightBrightness(night: NightSettings, date: Date): number {
  return 1 - nightLevel(night, date) * (1 - night.brightness);
}

/** Time multiplier for Hydra and solids at `date`: 1 by day, `night.speed` at full night. */
export function nightSpeed(night: NightSettings, date: Date): number {
  return 1 - nightLevel(night, date) * (1 - night.speed);
}

/** The next mode for the toggle key: schedule, then on, then off. */
export function nextNightMode(mode: NightMode): NightMode {
  return NIGHT_MODES[(NIGHT_MODES.indexOf(mode) + 1) % NIGHT_MODES.length];
}

/** A short status line, e.g. "night fade: scheduled (active 22:00–07:00)". */
export function describeNight(night: NightSettings): string {
  if (night.mode === "on") return `night fade: on (${Math.round(night.brightness * 100)}% brightness)`;
  if (night.mode === "off") return "night fade: off";
  return `night fade: scheduled (active ${night.start}–${night.end})`;
}

/**
 * The tooltip for the status bar's night indicator at `date`, or undefined
 * when the fade isn't dimming anything (off, or outside the window).
 */
export function nightIndicator(night: NightSettings, date: Date): string | undefined {
  const level = nightLevel(night, date);
  if (level <= 0) return undefined;
  const brightness = Math.round(nightBrightness(night, date) * 100);
  if (night.mode === "on") return `night fade on: ${brightness}% brightness`;
  return `night fade until ${night.end}: ${brightness}% brightness${level < 1 ? ", easing" : ""}`;
}
