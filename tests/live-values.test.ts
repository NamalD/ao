import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ao, updateAudio } from "../src/renderer/audio";
import { createEditorState, documentState } from "../src/renderer/editor";
import {
  aoMemberKinds, compileLive, findLiveExpressions, formatLive, type LiveSpan, SampleRing, SlotTable,
} from "../src/renderer/live-expressions";
import { liveValuesOn, setLive } from "../src/renderer/live-values";
import { silentFeatures, SPECTRUM_BANDS } from "../src/shared/features";

const kinds = aoMemberKinds(ao);
const stateOf = (doc: string) => EditorState.create({ doc, extensions: [javascript()] });
function find(doc: string, limit?: number): string[] {
  const state = stateOf(doc);
  return findLiveExpressions(state, 0, doc.length, kinds, limit).map((s) => state.sliceDoc(s.from, s.to));
}
function spanOf(doc: string, index = 0): LiveSpan {
  return findLiveExpressions(stateOf(doc), 0, doc.length, kinds)[index];
}
const valueOf = (doc: string, target: object = ao) => compileLive(spanOf(doc).expr, target as Record<string, unknown>)();

afterEach(() => updateAudio(silentFeatures()));

describe("finding ao expressions", () => {
  it("finds member reads and calls with literal arguments", () => {
    expect(find("a = ao.bass + ao.hz(40, 100) * ao.fftAt(0.2)")).toEqual(["ao.bass", "ao.hz(40, 100)", "ao.fftAt(0.2)"]);
    expect(find("ao.hz(-40, +100)")).toEqual(["ao.hz(-40, +100)"]);
  });

  it("skips strings and comments, but searches template interpolations", () => {
    expect(find(`// ao.bass\n/* ao.mid */ x = "ao.high" + 'ao.beat'`)).toEqual([]);
    expect(find("setFunction({ glsl: `float k = 1.; // ao.bass` })")).toEqual([]);
    expect(find("x = `level ${ao.loudness}`")).toEqual(["ao.loudness"]);
  });

  it("finds the arrow Hydra re-reads in a nested chain, as one value", () => {
    expect(find("osc(10, 0.1, () => ao.bass).rotate(() => 4 * ao.hz(6000, 12000) + 0.1).out()"))
      .toEqual(["() => ao.bass", "() => 4 * ao.hz(6000, 12000) + 0.1"]);
    expect(find("shape(6, ao.map(() => ao.hz(40, 100), 0.1, 0.35))")).toEqual(["ao.map(() => ao.hz(40, 100), 0.1, 0.35)"]);
    expect(find(`scale(ao.map("bass", 0, 2))`)).toEqual([`ao.map("bass", 0, 2)`]);
  });

  it("falls back to the ao reads inside anything it can't read", () => {
    expect(find("rotate(() => spin + ao.bass)")).toEqual(["ao.bass"]);
    expect(find("rotate((t) => ao.bass)")).toEqual(["ao.bass"]);
    expect(find("rotate(() => { return ao.mid })")).toEqual(["ao.mid"]);
    expect(find("spin += dt * (0.1 + 2 * ao.hz(300, 2000))")).toEqual(["ao.hz(300, 2000)"]);
    expect(find("ao.map(() => time, 0, 1)")).toEqual([]);
    expect(find("ao.hz(lo, 100); ao.hz(...range); f(ao.map)")).toEqual([]);
  });

  it("ignores unknown members, methods used as values, and arrows without ao", () => {
    expect(find("ao.bogus; ao.features; ao.hz; x.bass; ao?.bass; ao['bass']; () => 2")).toEqual([]);
    expect(find("ao.bass.toFixed(2)")).toEqual(["ao.bass"]);
  });

  it("reads literal indexes and a few Math functions", () => {
    expect(find("a = ao.fft[3]; b = ao.fft; () => Math.max(ao.bass, 0.2)")).toEqual(["ao.fft[3]", "ao.fft", "() => Math.max(ao.bass, 0.2)"]);
    expect(find("() => Math.random() * ao.bass; () => foo.max(ao.mid)")).toEqual(["ao.bass", "ao.mid"]);
  });

  it("keys identical expressions alike whatever their spacing, and honours the range and limit", () => {
    const doc = "ao.hz(40,100)\nao.hz( 40, 100 )\nao.bass";
    const spans = findLiveExpressions(stateOf(doc), 0, doc.length, kinds);
    expect(spans[0].key).toBe(spans[1].key);
    expect(find(doc, 2)).toHaveLength(2);
    expect(findLiveExpressions(stateOf(doc), doc.indexOf("ao.bass"), doc.length, kinds)).toHaveLength(1);
  });

  it("discovers members from the ao object, so ones added later just work", () => {
    const extended = Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(ao),
      bpm: { get: () => 124, enumerable: true },
      pulse: { value: (div: number) => div / 2, enumerable: true },
    });
    const state = stateOf("() => ao.bpm / 60; ao.pulse(4)");
    const spans = findLiveExpressions(state, 0, state.doc.length, aoMemberKinds(extended));
    expect(spans.map((s) => compileLive(s.expr, extended as Record<string, unknown>)())).toEqual([124 / 60, 2]);
  });
});

describe("reading live values", () => {
  const spectrum = Array.from({ length: SPECTRUM_BANDS }, (_, i) => i / SPECTRUM_BANDS);

  it("reads getters, methods and mapped values from ao", () => {
    updateAudio({ ...silentFeatures(1), bass: 0.5, spectrum });
    expect(valueOf("ao.bass")).toBe(0.5);
    expect(valueOf(`ao.map("bass", 0, 2)`)).toBe(1);
    expect(valueOf("ao.map(() => ao.bass * 2, 1, 3)")).toBe(3);
    expect(valueOf(`ao.fit("bass", 0, 1, 0, 4)`)).toBe(2);
    expect(valueOf("() => -(ao.bass ** 2) % 1 - +0.5 / 2")).toBeCloseTo(-0.5);
    expect(valueOf("ao.fftAt(0.5)")).toBeCloseTo(ao.fftAt(0.5));
    expect(valueOf("ao.fft[3]")).toBe(spectrum[3]);
    expect(valueOf("ao.fft")).toBe(ao.fft);
  });

  it("never runs user code: it calls only ao's own members, with the literal arguments", () => {
    const hz = vi.fn((lo: number, hi: number) => lo + hi);
    const fake = { hz, get bass() { return 0.25; } };
    const span = findLiveExpressions(stateOf("ao.hz(40, 100)"), 0, 14, aoMemberKinds(fake))[0];
    expect(compileLive(span.expr, fake)()).toBe(140);
    expect(hz).toHaveBeenCalledWith(40, 100);
  });

  it("reads NaN for results that aren't numbers, and for methods that throw", () => {
    const fake = { hz: () => { throw new Error("no"); }, label: () => "text" };
    const state = stateOf("ao.hz(1); ao.label()");
    const [a, b] = findLiveExpressions(state, 0, state.doc.length, aoMemberKinds(fake));
    expect(compileLive(a.expr, fake)()).toBeNaN();
    expect(compileLive(b.expr, fake)()).toBeNaN();
  });
});

describe("sample history", () => {
  it("keeps the newest samples in order", () => {
    const ring = new SampleRing(3);
    expect(ring.last()).toBeNaN();
    [1, 2, 3, 4, 5].forEach((v) => ring.push(v));
    expect(ring.length).toBe(3);
    expect([ring.at(0), ring.at(1), ring.at(2)]).toEqual([3, 4, 5]);
    expect(ring.last()).toBe(5);
    ring.clear();
    expect(ring.length).toBe(0);
  });

  it("draws over the samples' extent, at least minSpan wide, inside 0..1 for levels", () => {
    const ring = new SampleRing(8);
    expect(ring.range()).toEqual({ lo: 0, hi: 1 });
    [0.2, 0.6, NaN].forEach((v) => ring.push(v));
    expect(ring.range()).toEqual({ lo: 0.2, hi: 0.6 });
    const quiet = new SampleRing(4);
    quiet.push(0.01);
    quiet.push(0.02);
    expect(quiet.range(0.2)).toEqual({ lo: 0, hi: 0.2 });
    const loud = new SampleRing(4);
    loud.push(0.99);
    expect(loud.range(0.2)).toEqual({ lo: 0.8, hi: 1 });
    const tempo = new SampleRing(4);
    tempo.push(120);
    expect(tempo.range(0.2).lo).toBeCloseTo(119.9);
    expect(tempo.range(0.2).hi).toBeCloseTo(120.1);
  });

  it("formats values in at most five characters", () => {
    const cases: [number, string][] = [[0.4213, "0.42"], [-0.4213, "-0.42"], [-0.001, "0.00"], [0.0042, "0.004"], [0.09, "0.090"], [0.1, "0.10"], [12.34, "12.3"],
      [128, "128"], [-99.9, "-99.9"], [12345, "12k"], [1e9, "1e9"], [NaN, "–"], [Infinity, "–"]];
    for (const [value, text] of cases) {
      expect(formatLive(value)).toBe(text);
      expect(formatLive(value).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("following expressions across edits", () => {
  interface Slot { key: string; end: number; seen: number; id: number }
  let ids = 0;
  const slot = (key: string): Slot => ({ key, end: 0, seen: 0, id: ids++ });

  it("keeps a slot by its text, and follows an expression whose text an edit changed", () => {
    const table = new SlotTable<Slot>();
    let state = stateOf("x(ao.hz(40,100), ao.bass)");
    const round = (now: number) => {
      const used = new Set<Slot>();
      return findLiveExpressions(state, 0, state.doc.length, kinds).map((s) => {
        const taken = table.take(s.key, s.to, now, used, () => slot(s.key));
        taken.key = s.key;
        return taken;
      });
    };
    const [hz, bass] = round(1);
    // Scrubbing 100 to 101 changes the text; the edit carries the end along.
    const tr = state.update({ changes: { from: 11, to: 14, insert: "101" } });
    table.map(tr.changes);
    state = tr.state;
    const [hz2, bass2] = round(2);
    expect(hz2).toBe(hz);
    expect(hz2.key).toBe("ao.hz(40,101)");
    expect(bass2).toBe(bass);
    expect([...table.slots.keys()].sort()).toEqual(["ao.bass", "ao.hz(40,101)"]);
    table.prune(10_000, 5_000);
    expect(table.slots.size).toBe(0);
  });
});

describe("the editor's live values setting", () => {
  it("is on in a new editor and carries over when another sketch opens", () => {
    const actions = { run: vi.fn(), save: vi.fn(), changed: vi.fn() };
    const state = createEditorState("ao.bass", actions);
    expect(state.field(liveValuesOn)).toBe(true);
    const off = state.update({ effects: setLive.of(false) }).state;
    expect(off.field(liveValuesOn)).toBe(false);
    expect(documentState(off, "x").field(liveValuesOn)).toBe(false);
    expect(documentState(documentState(off, "y").update({ effects: setLive.of(true) }).state, "z").field(liveValuesOn)).toBe(true);
  });
});

describe("live value finding stays cheap", () => {
  it("finds a busy sketch's expressions quickly after each edit", () => {
    const line = "osc(10, () => ao.bass * 2).rotate(ao.map(() => ao.hz(40, 100), 0, 1)).color(ao.mid, () => ao.fftAt(0.3)).out()\n";
    let state = stateOf(line.repeat(60));
    findLiveExpressions(state, 0, state.doc.length, kinds);
    const start = performance.now();
    const edits = 200;
    for (let i = 0; i < edits; i++) {
      state = state.update({ changes: i % 2 ? { from: 4, to: 5 } : { from: 4, insert: "1" } }).state;
      // The editor searches only the visible lines: about 30 of them.
      findLiveExpressions(state, 0, line.length * 30, kinds, 40);
    }
    const perEdit = (performance.now() - start) / edits;
    // Generous for CI; locally this is well under a millisecond.
    expect(perEdit).toBeLessThan(5);
  });
});
