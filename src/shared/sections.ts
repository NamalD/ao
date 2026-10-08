/**
 * Section events autopilot reacts to. Detection runs in the listen addon, in
 * the main process; the renderer receives events with the audio frames.
 */

export type SectionKind = "drop" | "breakdown" | "change";

export interface SectionEvent {
  kind: SectionKind;
  /** `features.time` when it fired, seconds. */
  time: number;
  /** How pronounced it was, 0..1. */
  strength: number;
  /** A few words on why, for the log. */
  detail: string;
}

/** How quickly `drop` fades after a drop: its time constant, seconds. */
export const DROP_FADE = 0.5;
