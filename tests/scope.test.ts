import { afterEach, describe, expect, it } from "vitest";
import { evaluateInScope, sketchScope } from "../src/renderer/scope";

/** A stand-in for a Hydra synth: its own outputs, time and update. */
function fakeSynth(label: string) {
  const synth: Record<string, unknown> = {
    time: 0, speed: 1, update: () => {},
    o0: { label: `${label}.o0` },
    osc: (freq: number) => ({ out: (output?: { label: string }) => `${label}: osc(${freq}) -> ${(output ?? synth.o0 as { label: string }).label}` }),
  };
  return synth;
}

const g = globalThis as Record<string, unknown>;
afterEach(() => { delete g.shared; delete g.leaked; });

describe("sketchScope", () => {
  it("gives each sketch its own Hydra names", async () => {
    const a = fakeSynth("a"), b = fakeSynth("b");
    expect(await evaluateInScope("return osc(10).out()", sketchScope(a))).toBe("a: osc(10) -> a.o0");
    expect(await evaluateInScope("return osc(20).out(o0)", sketchScope(b))).toBe("b: osc(20) -> b.o0");
  });

  it("resolves names in closures when they run, not when they were made", async () => {
    const a = fakeSynth("a"), b = fakeSynth("b");
    const readA = await evaluateInScope("return () => time", sketchScope(a)) as () => number;
    const readB = await evaluateInScope("return () => time", sketchScope(b)) as () => number;
    a.time = 5;
    b.time = 7;
    expect([readA(), readB()]).toEqual([5, 7]);
  });

  it("lands assignments such as update and speed on its own synth", async () => {
    const a = fakeSynth("a"), b = fakeSynth("b");
    await evaluateInScope("update = (dt) => { speed = dt }", sketchScope(a));
    (a.update as (dt: number) => void)(3);
    expect(a.speed).toBe(3);
    expect(b.speed).toBe(1);
    expect(g.update).toBeUndefined();
  });

  it("lets other names reach the real globals, including shared state between blocks", async () => {
    const a = fakeSynth("a");
    await evaluateInScope("globalThis.shared ??= 1; leaked = Math.max(2, shared)", sketchScope(a));
    expect(g.shared).toBe(1);
    expect(g.leaked).toBe(2);
    expect(await evaluateInScope("return typeof notDefinedAnywhere", sketchScope(a))).toBe("undefined");
    // Object.prototype's names are not the synth's.
    expect(await evaluateInScope("return toString === globalThis.toString", sketchScope(a))).toBe(true);
  });

  it("sees names the synth gains later, as setFunction adds them", async () => {
    const a = fakeSynth("a");
    const scope = sketchScope(a);
    a.fresh = () => "new";
    expect(await evaluateInScope("return fresh()", scope)).toBe("new");
  });

  it("prefers extras, which a sketch can't overwrite", async () => {
    const a = fakeSynth("a");
    const mine = () => "deck timer";
    const scope = sketchScope(a, { setTimeout: mine });
    expect(await evaluateInScope("return setTimeout()", scope)).toBe("deck timer");
    await evaluateInScope("setTimeout = 1", scope);
    expect(await evaluateInScope("return setTimeout()", scope)).toBe("deck timer");
  });

  it("keeps const blocks re-runnable and reports errors", async () => {
    const scope = sketchScope(fakeSynth("a"));
    await evaluateInScope("const x = 1", scope);
    await evaluateInScope("const x = 2", scope);
    await expect(evaluateInScope("throw new Error('nope')", scope)).rejects.toThrow("nope");
    await expect(evaluateInScope("osc(", scope)).rejects.toThrow(SyntaxError);
  });
});
