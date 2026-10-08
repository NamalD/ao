/** Pitch-class names, C through B. Analysis itself lives in the listen addon. */
export const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The dominant pitch class as a colour hue, 0..1: C is 0, each semitone 1/12 further round. */
export function keyHue(key: number): number {
  return (((key % 12) + 12) % 12) / 12;
}
