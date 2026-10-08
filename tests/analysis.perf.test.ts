// A micro-benchmark, skipped in the default run. Run it with:
//   AO_BENCH=1 npx vitest run tests/analysis.perf.test.ts
import { describe, expect, it } from "vitest";
import { Engine } from "../src/main/listen";

const RATE = 48000;
/** parec's default: 20 ms of interleaved stereo at 48 kHz. */
const FRAMES = 960;

function chunks(): Float32Array[] {
  return Array.from({ length: 50 }, (_, c) => {
    const samples = new Float32Array(FRAMES * 2);
    for (let i = 0; i < FRAMES; i++) {
      const t = (c * FRAMES + i) / RATE, phase = t % 0.5;
      const kick = Math.exp(-phase * 18) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-phase * 30)) * phase);
      const pad = 0.12 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t));
      samples[2 * i] = samples[2 * i + 1] = 0.6 * kick + pad + 0.02 * (Math.random() * 2 - 1);
    }
    return samples;
  });
}

/** Median microseconds per call over several rounds, after a warm-up. */
function measure(run: (i: number) => void, calls = 2000, rounds = 7): number {
  for (let i = 0; i < calls; i++) run(i);
  const times: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const start = performance.now();
    for (let i = 0; i < calls; i++) run(i);
    times.push(((performance.now() - start) * 1000) / calls);
  }
  return times.sort((a, b) => a - b)[rounds >> 1];
}

describe.skipIf(!process.env.AO_BENCH)("analysis benchmark", () => {
  it("stays under 40 µs per push, boundary included", () => {
    const data = chunks(), engine = new Engine(RATE);
    const push = measure((i) => engine.push(data[i % data.length]));
    const cpu = (us: number) => `${((us * 50) / 1e4).toFixed(3)}% of a core at 50 chunks/s`;
    console.log(`Engine.push: ${push.toFixed(1)} µs (${cpu(push)})`);
    expect(push).toBeLessThanOrEqual(40);
  }, 60_000);
});
