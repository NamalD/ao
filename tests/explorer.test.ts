import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { describe, expect, it, vi } from "vitest";
import { createEditorState, helpCommand, insertBlock, publicAoMembers, sourceMembers } from "../src/renderer/editor";
import { aoExamples, globalEntries, hydraExamples, sourceExamples } from "../src/renderer/explorer/content";
import { buildEntries, filterEntries, findEntry, wordAt } from "../src/renderer/explorer/entries";

const entries = buildEntries();
const names = (list: { name: string }[]) => list.map((e) => e.name);

describe("explorer content", () => {
  it("has an example for every Hydra function, ao member and source method, and no strays", () => {
    expect(Object.keys(hydraExamples).sort()).toEqual(hydraFunctions().map((fn) => fn.name).sort());
    expect(Object.keys(aoExamples).sort()).toEqual(publicAoMembers().map((m) => m.name).sort());
    expect(Object.keys(sourceExamples).sort()).toEqual([...sourceMembers].sort());
  });

  it("gives every entry a unique id, a description and an example", () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.description, entry.id).toBeTruthy();
      expect(entry.example, entry.id).toBeTruthy();
    }
  });

  it("has examples that parse as sketch code", () => {
    for (const entry of entries) {
      // As run() in main.ts evaluates them; compiling is enough.
      expect(() => new Function(`return (async () => {\n${entry.example}\n})()`), entry.id).not.toThrow();
    }
  });

  it("uses each Hydra function and ao member in its own example", () => {
    for (const fn of hydraFunctions()) {
      if (fn.name === "sum") continue; // sum can't chain; its example says so and shows g().
      expect(hydraExamples[fn.name], fn.name).toMatch(new RegExp(`\\b${fn.name}\\(`));
    }
    for (const [name, example] of Object.entries(aoExamples)) expect(example, name).toContain(`ao.${name}`);
    for (const [name, example] of Object.entries(sourceExamples)) {
      expect(typeof example === "string" ? example : example.code, name).toContain(`.${name}(`);
    }
  });

  it("doesn't auto-play examples that need a camera, the screen, the network, or blank everything", () => {
    const manual = entries.filter((e) => !e.autoplay).map((e) => e.id).sort();
    expect(manual).toEqual([
      "global:hush", "source:clear", "source:initCam", "source:initImage",
      "source:initScreen", "source:initStream", "source:initVideo",
    ]);
  });

  it("shows live values for ao properties but not methods", () => {
    const live = entries.filter((e) => e.live).map((e) => e.live);
    expect(live).toEqual(expect.arrayContaining(["bass", "impulse", "fft", "centroid"]));
    expect(live).not.toContain("hz");
    expect(live).not.toContain("map");
  });

  it("orders sections ao first and recipes last", () => {
    expect(entries[0].section).toBe("ao");
    expect(entries.at(-1)!.section).toBe("recipes");
    expect(names(entries.filter((e) => e.section === "globals"))).toEqual(globalEntries.map((g) => g.name));
  });
});

describe("wordAt", () => {
  it("finds the identifier under or just before the cursor, with its owner", () => {
    expect(wordAt("  .rotate(ao.hz(40, 100))", 4)).toEqual({ name: "rotate" });
    expect(wordAt("  .rotate(ao.hz(40, 100))", 13)).toEqual({ name: "hz", owner: "ao" });
    expect(wordAt("s0.initScene(`", 5)).toEqual({ name: "initScene", owner: "s0" });
    expect(wordAt("osc", 3)).toEqual({ name: "osc" });
    expect(wordAt("osc(10, 0.1)", 3)).toEqual({ name: "osc" });
    expect(wordAt("  ", 1)).toBeNull();
  });
});

describe("findEntry", () => {
  const id = (name: string, owner?: string) => findEntry(entries, { name, owner })?.id;

  it("finds functions, members and globals from the word under the cursor", () => {
    expect(id("osc")).toBe("hydra:osc");
    expect(id("modulateKaleid")).toBe("hydra:modulateKaleid");
    expect(id("hz", "ao")).toBe("ao:hz");
    expect(id("initScene", "s2")).toBe("source:initScene");
    expect(id("render")).toBe("global:render");
    expect(id("setFunction")).toBe("global:setFunction");
    expect(id("out")).toBe("global:out");
  });

  it("follows aliases", () => {
    expect(id("o2")).toBe("global:o0–o3");
    expect(id("s1")).toBe("global:s0–s3");
    expect(id("fast")).toBe("global:arrays");
    expect(id("height")).toBe("global:width, height");
  });

  it("finds nothing for words it doesn't document", () => {
    expect(id("level")).toBeUndefined();
    expect(id("osc", "ao")).toBeUndefined();
  });
});

describe("filterEntries", () => {
  it("matches names by substring and picks the closest", () => {
    const { matches, best } = filterEntries(entries, "kal");
    expect(names(matches)).toEqual(expect.arrayContaining(["kaleid", "modulateKaleid"]));
    expect(best?.name).toBe("kaleid");
  });

  it("prefers an exact name, ignoring the ao. prefix", () => {
    expect(filterEntries(entries, "bass").best?.id).toBe("ao:bass");
    expect(filterEntries(entries, "HUE").best?.id).toBe("hydra:hue");
  });

  it("searches descriptions and falls back to letters in order", () => {
    expect(names(filterEntries(entries, "kaleidoscope").matches)).toContain("kaleid");
    expect(filterEntries(entries, "mdsc").best?.name).toBe("modulateScale");
  });

  it("returns everything for an empty query and nothing for nonsense", () => {
    expect(filterEntries(entries, "  ").matches).toHaveLength(entries.length);
    expect(filterEntries(entries, "zzqqx").matches).toEqual([]);
    expect(filterEntries(entries, "zzqqx").best).toBeUndefined();
  });
});

describe("insertBlock", () => {
  const actions = () => ({ run: vi.fn(), save: vi.fn(), changed: vi.fn(), help: vi.fn() });
  const insert = (doc: string, cursor: number, code = "noise().out()") => {
    let state = createEditorState(doc, actions());
    state = state.update({ selection: EditorSelection.cursor(cursor) }).state;
    const next = state.update(insertBlock(state, code)).state;
    return { text: next.doc.toString(), cursor: next.selection.main.head };
  };

  it("adds the example as its own block after the block under the cursor", () => {
    const doc = "osc()\n  .out()\n\nshape().out(o1)";
    expect(insert(doc, 2)).toEqual({ text: "osc()\n  .out()\n\nnoise().out()\n\nshape().out(o1)", cursor: 16 });
    expect(insert(doc, doc.length).text).toBe(`${doc}\n\nnoise().out()\n`);
  });

  it("uses the blank line under the cursor, and fills an empty sketch", () => {
    expect(insert("a\n\n\n\nb", 3).text).toBe("a\n\nnoise().out()\n\nb");
    expect(insert("", 0)).toEqual({ text: "noise().out()\n", cursor: 0 });
  });
});

describe("K", () => {
  it("hands the cursor's line and column to the explorer", () => {
    const help = vi.fn();
    const state = createEditorState("osc(10)\n  .kaleid(4)", { run: vi.fn(), save: vi.fn(), changed: vi.fn(), help });
    const view = { state: state.update({ selection: EditorSelection.cursor(12) }).state } as unknown as EditorView;
    helpCommand(view);
    expect(help).toHaveBeenCalledWith("  .kaleid(4)", 4);
  });
});
