import { describe, expect, it } from "vitest";
import { DEFAULT_BPM, TempoState, TempoTracker } from "../src/shared/tempo";
import { chunks, phaseError, renderTrack, TrackOptions, truePhase } from "./tempo-signals";

interface Sample { t: number; state: TempoState; phaseError: number }

/** Runs a track through a tracker, sampling its state after every chunk. */
function run(options: TrackOptions, frames?: number | (() => number)): Sample[] {
  const track = renderTrack(options);
  const tracker = new TempoTracker(48000);
  const samples: Sample[] = [];
  if (typeof frames === "function") {
    // Irregular chunk sizes, as a real pipe delivers them.
    for (let start = 0; start < track.mono.length; ) {
      const n = Math.min(frames(), track.mono.length - start);
      const chunk = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) chunk[2 * i] = chunk[2 * i + 1] = track.mono[start + i];
      start += n;
      const state = tracker.push(chunk);
      samples.push({ t: start / 48000, state, phaseError: phaseError(state.beats, truePhase(track.beats, start / 48000)) });
    }
    return samples;
  }
  for (const { samples: chunk, end } of chunks(track.mono, frames)) {
    const state = tracker.push(chunk);
    samples.push({ t: end, state, phaseError: phaseError(state.beats, truePhase(track.beats, end)) });
  }
  return samples;
}

const between = (samples: Sample[], from: number, to = Infinity) => samples.filter((s) => s.t >= from && s.t < to);
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.floor(q * (values.length - 1))];

/** Every sampled tempo within ±1 bpm, and beats within a few percent of the true phase. */
function expectLocked(samples: Sample[], bpm: number) {
  const bpms = samples.map((s) => s.state.bpm);
  expect(Math.min(...bpms)).toBeGreaterThan(bpm - 1);
  expect(Math.max(...bpms)).toBeLessThan(bpm + 1);
  const errors = samples.map((s) => s.phaseError);
  expect(quantile(errors, 0.5)).toBeLessThan(0.03);
  expect(quantile(errors, 0.95)).toBeLessThan(0.06);
}

describe("TempoTracker", () => {
  const tracks: [string, TrackOptions][] = [
    ["a 90 bpm click", { bpm: 90, seconds: 20, click: true }],
    ["a 120 bpm kick over a pad", { bpm: 120, seconds: 20, kick: "every", pad: true }],
    ["a 128 bpm kick and hats with ±20 ms jitter", { bpm: 128, seconds: 20, kick: "every", hats: true, pad: true, jitter: 0.02 }],
    ["140 bpm with kicks on 1 and 3, snare on 2 and 4", { bpm: 140, seconds: 20, kick: "half", snare: true, hats: true }],
    ["a 174 bpm click", { bpm: 174, seconds: 20, click: true }],
    ["174 bpm drum and bass", { bpm: 174, seconds: 20, kick: "half", snare: true, hats: true, jitter: 0.005 }],
    ["90 bpm with swung hats", { bpm: 90, seconds: 20, kick: "half", snare: true, hats: true, swing: 1 / 6, jitter: 0.01 }],
  ];
  for (const [name, options] of tracks) {
    it(`locks to ${name} within ±1 bpm, in phase`, () => {
      const samples = run(options);
      expectLocked(between(samples, 8), options.bpm);
      // Locks within about five seconds.
      expect(Math.abs(between(samples, 5.5)[0].state.bpm - options.bpm)).toBeLessThan(1);
      expect(between(samples, 10).every((s) => s.state.confidence > 0.3)).toBe(true);
    });
  }

  it("resolves half and double tempo toward the pulse the kicks carry", () => {
    // Eighth-note hats double the onsets, but the beat stays at 87 and 72.
    expectLocked(between(run({ bpm: 87, seconds: 16, kick: "every", hats: true }), 8), 87);
    expectLocked(between(run({ bpm: 72, seconds: 16, kick: "every", snare: true, hats: true }), 8), 72);
    // Kicks on every other beat don't halve 140 to 70.
    expectLocked(between(run({ bpm: 140, seconds: 16, kick: "half", snare: true }), 8), 140);
    // Equal clicks at 174 stay at 174 rather than folding to 87.
    expectLocked(between(run({ bpm: 174, seconds: 16, click: true }), 8), 174);
  });

  it("keeps one of two equal alignments instead of flipping between them", () => {
    // Straight hats alone: on-beat and off-beat look the same.
    const samples = between(run({ bpm: 120, seconds: 20, hats: true }), 10);
    expect(samples.every((s) => Math.abs(s.state.bpm - 120) < 1)).toBe(true);
    const beats = samples.map((s) => s.state.beats - (s.t - 10) * 2);
    expect(Math.max(...beats) - Math.min(...beats)).toBeLessThan(0.1);
  });

  it("follows a tempo change within a few seconds", () => {
    const samples = run({ bpm: 120, seconds: 30, kick: "every", hats: true, change: { at: 12, bpm: 128 } });
    expectLocked(between(samples, 8, 12), 120);
    expectLocked(between(samples, 17), 128);
    // No detour through other tempos on the way.
    expect(between(samples, 12, 17).every((s) => Math.abs(s.state.bpm - 120) < 1 || Math.abs(s.state.bpm - 128) < 1)).toBe(true);
  });

  it("holds the tempo through silence with fading confidence, then relocks", () => {
    const samples = run({ bpm: 124, seconds: 30, kick: "every", pad: true, silence: [[10, 18]] });
    const before = between(samples, 9.9, 10)[0].state.confidence;
    const late = between(samples, 17.9, 18)[0].state.confidence;
    expect(before).toBeGreaterThan(0.8);
    expect(late).toBeLessThan(0.6 * before);
    expect(late).toBeGreaterThan(0.1);
    // The clock keeps running at the held tempo, so the beat is still in
    // phase when the music comes back.
    expectLocked(between(samples, 8), 124);
    expect(between(samples, 24).every((s) => s.state.confidence > 0.8)).toBe(true);
  });

  it("holds through a breakdown where only the pad plays", () => {
    const samples = run({ bpm: 124, seconds: 30, kick: "every", hats: true, pad: true, drop: [[10, 18]] });
    expectLocked(between(samples, 8), 124);
    expect(between(samples, 17.9, 18)[0].state.confidence).toBeLessThan(0.6);
  });

  it("finds no tempo in a pad without hits", () => {
    const samples = run({ bpm: 120, seconds: 16, pad: true });
    expect(samples.every((s) => s.state.bpm === DEFAULT_BPM && s.state.confidence < 0.05)).toBe(true);
  });

  it("advances phase smoothly between and across detections", () => {
    const samples = between(run({ bpm: 128, seconds: 16, kick: "every", hats: true, jitter: 0.01 }), 3);
    for (let i = 1; i < samples.length; i++) {
      const step = samples[i].state.beats - samples[i - 1].state.beats;
      const expected = (0.02 * samples[i].state.bpm) / 60;
      // Never backwards, never a jump: at most 50% faster or slower than the tempo.
      expect(step).toBeGreaterThan(0.5 * expected);
      expect(step).toBeLessThan(1.5 * expected);
    }
  });

  it("gives the same result for irregular chunk sizes", () => {
    let seed = 7;
    const size = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return 64 + (seed % 4000); };
    expectLocked(between(run({ bpm: 128, seconds: 16, kick: "every", hats: true }, size), 8), 128);
  });
});
