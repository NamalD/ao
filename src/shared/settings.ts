import { AutopilotSettings, defaultAutopilot, normalizeAutopilot } from "./autopilot";
import { defaultNight, NightSettings, normalizeNight } from "./night";

/** User preferences kept in `state/settings.json`. */
export interface Settings {
  /** Whether the audio meter overlay is shown. */
  meter: boolean;
  night: NightSettings;
  autopilot: AutopilotSettings;
}

export const defaultSettings: Settings = { meter: false, night: defaultNight, autopilot: defaultAutopilot };

/**
 * Settings from untrusted JSON: known keys are validated and defaulted,
 * unknown top-level keys are kept so hand-written notes survive a save.
 */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    ...r,
    meter: typeof r.meter === "boolean" ? r.meter : defaultSettings.meter,
    night: normalizeNight(r.night),
    autopilot: normalizeAutopilot(r.autopilot),
  };
}

/**
 * Applies a partial update from the renderer. Only known keys are taken from
 * the patch, and `night` and `autopilot` merge field by field.
 */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  return {
    ...current,
    meter: typeof p.meter === "boolean" ? p.meter : current.meter,
    night: p.night && typeof p.night === "object" ? normalizeNight({ ...current.night, ...p.night }, current.night) : current.night,
    autopilot: p.autopilot && typeof p.autopilot === "object"
      ? normalizeAutopilot({ ...current.autopilot, ...p.autopilot }, current.autopilot) : current.autopilot,
  };
}
