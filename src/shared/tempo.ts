/**
 * Tempo and beat phase detected from the audio, sent with each analysis step.
 * `beats` is a continuous beat count: its fractional part is the phase within
 * the beat. Which beat starts a bar is not detected; the renderer counts bars
 * from its own offset, which tapping sets.
 *
 * Detection runs in the listen addon. This file is the type the renderer and
 * the tempo clock share.
 */
export interface TempoState {
  /** Tempo in beats per minute; 120 until the first lock. */
  bpm: number;
  /** Continuous beat count at the newest sample; advances bpm / 60 per second. */
  beats: number;
  /** 0..1: how periodic the recent onsets are. Decays while held through silence. */
  confidence: number;
}

/** Detected tempos are folded into this range. */
export const TEMPO_MIN = 70;
export const TEMPO_MAX = 180;
/** Tempo before anything is detected, so phase still runs. */
export const DEFAULT_BPM = 120;
