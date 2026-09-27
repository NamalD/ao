// A micro-benchmark, skipped in the default run. Run it with:
//   AO_BENCH=1 npx vitest run tests/tempo.perf.test.ts
import { describe, it } from "vitest";
import { Analyser } from "../src/shared/analysis";
import { TempoTracker } from "../src/shared/tempo";
import { chunks, renderTrack } from "./tempo-signals";

describe.skipIf(!process.env.AO_BENCH)("tempo benchmark", () => {
  it("reports µs per 960-frame chunk, averaged over inductions", () => {
    const data = [...chunks(renderTrack({ bpm: 128, seconds: 30, kick: "every", hats: true, pad: true }).mono)].map((c) => c.samples);
    const time = (run: (samples: Float32Array) => void) => {
      const rounds: number[] = [];
      for (let r = 0; r < 5; r++) {
        const start = performance.now();
        for (const samples of data) run(samples);
        rounds.push(((performance.now() - start) * 1000) / data.length);
      }
      return rounds.sort((a, b) => a - b)[2];
    };
    let tracker = new TempoTracker(48000);
    const tempo = time((s) => tracker.push(s));
    // Worst single chunk: one that runs an induction.
    tracker = new TempoTracker(48000);
    const each: number[] = [];
    for (const samples of data) {
      const start = performance.now();
      tracker.push(samples);
      each.push((performance.now() - start) * 1000);
    }
    each.sort((a, b) => a - b);
    const worst = each[Math.floor(each.length * 0.99)];
    const analyser = new Analyser(48000);
    const analysis = time((s) => analyser.push(s, 0));
    const cpu = (us: number) => `${((us * 50) / 1e4).toFixed(3)}% of a core at 50 chunks/s`;
    console.log(`TempoTracker.push: ${tempo.toFixed(1)} µs mean (${cpu(tempo)}), 99th percentile chunk ${worst.toFixed(0)} µs (an induction)`);
    console.log(`Analyser.push for comparison: ${analysis.toFixed(1)} µs (${cpu(analysis)})`);
  }, 120_000);
});
