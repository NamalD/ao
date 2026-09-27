import { describe, expect, it } from "vitest";
import { AudioFeatures, SPECTRUM_BANDS } from "../src/shared/features";
import { SectionDetector, SectionEvent } from "../src/shared/sections";

const RATE = 50; // feature frames a second, as the capture sends them

/** A spectral shape: levels per band from a function of position 0..1. */
type Shape = (x: number) => number;
const full: Shape = (x) => 0.7 - 0.3 * x;          // kick, bass, pads, hats
const noBass: Shape = (x) => (x < 0.25 ? 0.1 : 0.55 - 0.2 * x); // breakdown: bass filtered out
const bright: Shape = (x) => 0.35 + 0.35 * x;       // a different section: highs up, lows down
const silent: Shape = () => 0;

interface Segment {
  seconds: number;
  /** Loudness and bass at the segment's start and end; linear in between. */
  loudness: [number, number];
  bass: [number, number];
  shape: Shape | [Shape, Shape];
  /** Add a kick every half second, as music has. */
  beats?: boolean;
}

/** Feature frames for a sequence of segments, at RATE frames a second. */
function sequence(segments: Segment[]): AudioFeatures[] {
  const frames: AudioFeatures[] = [];
  let t = 0;
  for (const seg of segments) {
    const n = Math.round(seg.seconds * RATE);
    for (let i = 0; i < n; i++, t += 1 / RATE) {
      const u = n > 1 ? i / (n - 1) : 0;
      const lerp = ([a, b]: [number, number]) => a + (b - a) * u;
      const kick = seg.beats === false ? 0 : Math.exp(-((t % 0.5) * 18));
      const [from, to] = Array.isArray(seg.shape) ? seg.shape : [seg.shape, seg.shape];
      const loudness = lerp(seg.loudness) * (0.85 + 0.15 * kick);
      const bass = lerp(seg.bass) * (0.8 + 0.2 * kick);
      const spectrum = Array.from({ length: SPECTRUM_BANDS }, (_, b) => {
        const x = b / (SPECTRUM_BANDS - 1);
        const level = (1 - u) * from(x) + u * to(x);
        return Math.max(0, level * (x < 0.2 ? 0.85 + 0.15 * kick : 1) * (lerp(seg.loudness) > 0 ? 1 : 0));
      });
      frames.push({ time: t, loudness, impulse: kick, beat: kick > 0.9 ? 1 : 0, bass, mid: 0.3, high: 0.2, spectrum });
    }
  }
  return frames;
}

function run(segments: Segment[], detector = new SectionDetector()): SectionEvent[] {
  const events: SectionEvent[] = [];
  for (const f of sequence(segments)) {
    const e = detector.push(f);
    if (e) events.push(e);
  }
  return events;
}

const steady = (seconds: number, shape: Shape = full): Segment =>
  ({ seconds, loudness: [0.6, 0.6], bass: [0.7, 0.7], shape });

describe("SectionDetector", () => {
  it("stays quiet through steady music, beats and all", () => {
    expect(run([steady(240)])).toEqual([]);
  });

  it("never fires in silence", () => {
    expect(run([{ seconds: 120, loudness: [0, 0], bass: [0, 0], shape: silent, beats: false }])).toEqual([]);
  });

  it("finds the breakdown, then the drop after a build-up, and nothing else", () => {
    const events = run([
      steady(60),
      // Breakdown: bass gone, quieter.
      { seconds: 16, loudness: [0.3, 0.3], bass: [0.1, 0.1], shape: noBass, beats: false },
      // Build-up: louder and louder, still no bass.
      { seconds: 8, loudness: [0.3, 0.5], bass: [0.1, 0.15], shape: noBass, beats: false },
      // The drop.
      steady(60),
    ]);
    expect(events.map((e) => e.kind)).toEqual(["breakdown", "drop"]);
    const [breakdown, drop] = events;
    // Energy falls at 60 s; the slow follower needs a moment, then the hold.
    expect(breakdown.time).toBeGreaterThan(60);
    expect(breakdown.time).toBeLessThan(65);
    // The drop lands at 84 s and is reported within a second.
    expect(drop.time).toBeGreaterThan(84);
    expect(drop.time).toBeLessThan(85);
    expect(drop.strength).toBeGreaterThan(0.6);
  });

  it("doesn't call a slow recovery from a breakdown a drop", () => {
    const events = run([
      steady(60),
      { seconds: 16, loudness: [0.3, 0.3], bass: [0.1, 0.1], shape: noBass, beats: false },
      // Bass and level creep back over 40 seconds.
      { seconds: 40, loudness: [0.3, 0.6], bass: [0.1, 0.7], shape: [noBass, full] },
      steady(30),
    ]);
    expect(events.map((e) => e.kind)).toEqual(["breakdown"]);
  });

  it("doesn't take a single hit in a lull for a drop", () => {
    const events = run([
      steady(60),
      { seconds: 10, loudness: [0.3, 0.3], bass: [0.1, 0.1], shape: noBass, beats: false },
      { seconds: 0.2, loudness: [0.8, 0.8], bass: [0.9, 0.9], shape: full, beats: false },
      { seconds: 10, loudness: [0.3, 0.3], bass: [0.1, 0.1], shape: noBass, beats: false },
    ]);
    expect(events.map((e) => e.kind)).toEqual(["breakdown"]);
  });

  it("reports a sudden change of timbre once, after it has held", () => {
    const events = run([steady(60, full), steady(90, bright)]);
    expect(events.map((e) => e.kind)).toEqual(["change"]);
    expect(events[0].time).toBeGreaterThan(61);
    expect(events[0].time).toBeLessThan(68);
  });

  it("follows a gradual change of timbre without firing", () => {
    const events = run([
      steady(60, full),
      { seconds: 180, loudness: [0.6, 0.6], bass: [0.7, 0.7], shape: [full, bright] },
      steady(60, bright),
    ]);
    expect(events).toEqual([]);
  });

  it("calls music after a long silence a change (a new track), but not the first music", () => {
    const quiet: Segment = { seconds: 6, loudness: [0, 0], bass: [0, 0], shape: silent, beats: false };
    const events = run([quiet, steady(40), quiet, steady(20)]);
    expect(events.map((e) => e.kind)).toEqual(["change"]);
    expect(events[0].detail).toMatch(/silence/);
    expect(events[0].time).toBeGreaterThan(52);
    expect(events[0].time).toBeLessThan(55);
  });

  it("calls full energy after a short pause a drop", () => {
    const pause: Segment = { seconds: 2, loudness: [0, 0], bass: [0, 0], shape: silent, beats: false };
    const events = run([steady(60), pause, steady(30)]);
    expect(events.map((e) => e.kind)).toEqual(["drop"]);
    expect(events[0].time).toBeGreaterThan(62);
    expect(events[0].time).toBeLessThan(63);
  });

  it("ignores a short gap between quiet passages", () => {
    const soft = (seconds: number): Segment => ({ seconds, loudness: [0.15, 0.15], bass: [0.1, 0.1], shape: full });
    const gap: Segment = { seconds: 1, loudness: [0, 0], bass: [0, 0], shape: silent, beats: false };
    expect(run([soft(40), gap, soft(40)])).toEqual([]);
  });

  it("ignores a short gap between songs", () => {
    const gap: Segment = { seconds: 1, loudness: [0, 0], bass: [0, 0], shape: silent, beats: false };
    expect(run([steady(40), gap, steady(40)])).toEqual([]);
  });

  it("works the same at a different frame rate", () => {
    // Every other frame: 25 per second.
    const frames = sequence([
      steady(60),
      { seconds: 16, loudness: [0.3, 0.3], bass: [0.1, 0.1], shape: noBass, beats: false },
      steady(30),
    ]).filter((_, i) => i % 2 === 0);
    const detector = new SectionDetector();
    const kinds = frames.map((f) => detector.push(f)?.kind).filter(Boolean);
    expect(kinds).toEqual(["breakdown", "drop"]);
  });
});
