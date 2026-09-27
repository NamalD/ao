import { defaultNight, NightSettings, normalizeNight } from "./night";

/** User preferences kept in `state/settings.json`. */
export interface Settings {
  /** Whether the audio meter overlay is shown. */
  meter: boolean;
  /** Whether live values show beside `ao` expressions in the editor. */
  liveValues: boolean;
  night: NightSettings;
}

export const defaultSettings: Settings = { meter: false, liveValues: true, night: defaultNight };

/**
 * Settings from untrusted JSON: known keys are validated and defaulted,
 * unknown top-level keys are kept so hand-written notes survive a save.
 */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    ...r,
    meter: typeof r.meter === "boolean" ? r.meter : defaultSettings.meter,
    liveValues: typeof r.liveValues === "boolean" ? r.liveValues : defaultSettings.liveValues,
    night: normalizeNight(r.night),
  };
}

/**
 * Applies a partial update from the renderer. Only known keys are taken from
 * the patch, and `night` merges field by field.
 */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  return {
    ...current,
    meter: typeof p.meter === "boolean" ? p.meter : current.meter,
    liveValues: typeof p.liveValues === "boolean" ? p.liveValues : current.liveValues,
    night: p.night && typeof p.night === "object" ? normalizeNight({ ...current.night, ...p.night }, current.night) : current.night,
  };
}
