// A micro-benchmark, skipped in the default run. Run it with:
//   AO_BENCH=1 npx vitest run tests/tempo.perf.test.ts
import { describe, expect, it } from "vitest";
import { Engine } from "../src/main/listen";
import { chunks, renderTrack } from "./tempo-signals";

describe.skipIf(!process.env.AO_BENCH)("tempo benchmark", () => {
  it("stays under 40 µs per 960-frame push, boundary included", () => {
    const data = [...chunks(renderTrack({ bpm: 128, seconds: 30, kick: "every", hats: true, pad: true }).mono)].map((c) => c.samples);
    const engine = new Engine(48000);
    const rounds: number[] = [];
    for (let r = 0; r < 5; r++) {
      const start = performance.now();
      for (const samples of data) engine.push(samples);
      rounds.push(((performance.now() - start) * 1000) / data.length);
    }
    const median = rounds.sort((a, b) => a - b)[2];
    const each: number[] = [];
    for (const samples of data) {
      const start = performance.now();
      engine.push(samples);
      each.push((performance.now() - start) * 1000);
    }
    each.sort((a, b) => a - b);
    const worst = each[Math.floor(each.length * 0.99)];
    const cpu = (us: number) => `${((us * 50) / 1e4).toFixed(3)}% of a core at 50 chunks/s`;
    console.log(`Engine.push: ${median.toFixed(1)} µs median of rounds (${cpu(median)}), 99th percentile chunk ${worst.toFixed(0)} µs`);
    expect(median).toBeLessThanOrEqual(40);
  }, 120_000);
});
