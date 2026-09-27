import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { describe, expect, it, vi } from "vitest";
import { createEditorState, helpCommand, insertBlock, publicAoMembers, sourceMembers } from "../src/renderer/editor";
import { extensionApi, extensionDocs } from "../src/renderer/extension-api";
import { CATALOG } from "../src/renderer/extensions";
import { aoExamples, extensionExamples, globalEntries, hydraExamples, sourceExamples } from "../src/renderer/explorer/content";
import { buildEntries, filterEntries, findEntry, sections, wordAt } from "../src/renderer/explorer/entries";

const entries = buildEntries();
const names = (list: { name: string }[]) => list.map((e) => e.name);

describe("explorer content", () => {
  it("has an example for every Hydra function, ao member and source method, and no strays", () => {
    expect(Object.keys(hydraExamples).sort()).toEqual(hydraFunctions().map((fn) => fn.name).sort());
    expect(Object.keys(aoExamples).sort()).toEqual(publicAoMembers().map((m) => m.name).sort());
    expect(Object.keys(sourceExamples).sort()).toEqual([...sourceMembers].sort());
  });

  it("has an example for every name each extension adds, plus its intro, and no strays", () => {
    expect(Object.keys(extensionExamples).sort()).toEqual(CATALOG.map((ext) => ext.name).sort());
    for (const ext of CATALOG) {
      const names = extensionApi().filter((fn) => fn.extension === ext.name).map((fn) => fn.name);
      expect(Object.keys(extensionExamples[ext.name]).sort(), ext.name).toEqual(["use", ...names].sort());
    }
  });

  it("has an entry for every extension name, in its extension's sections, with an intro first", () => {
    for (const fn of extensionApi()) {
      expect(entries.find((e) => e.id === `ext:${fn.extension}:${fn.name}`)?.section, fn.name).toBe(fn.group);
    }
    for (const ext of CATALOG) {
      const own = entries.filter((e) => e.id === `ext:${ext.name}` || e.id.startsWith(`ext:${ext.name}:`));
      expect(own[0].id, ext.name).toBe(`ext:${ext.name}`);
      expect(own[0].description).toContain(extensionDocs[ext.name].author);
      expect(own[0].description).toContain(extensionDocs[ext.name].licence);
      // Every section this extension has holds entries.
      for (const group of extensionDocs[ext.name].groups) expect(own.some((e) => e.section === group), group).toBe(true);
    }
  });

  it("starts every extension example with the use line it needs, and uses the name it shows", () => {
    for (const entry of entries.filter((e) => e.id.startsWith("ext:"))) {
      const ext = entry.id.split(":")[1];
      expect(entry.example.startsWith(`await use("${ext}")\n`), entry.id).toBe(true);
      const name = entry.id.split(":")[2];
      if (name) expect(entry.example, entry.id).toMatch(new RegExp(`\\b${name}\\b`));
      if (name) expect(entry.description, entry.id).toContain(`use("${ext}")`);
    }
  });

  it("has a section for every extension, between the s0–s3 methods and the recipes", () => {
    const ids = sections.map((s) => s.id);
    const extensionSections = ids.filter((id) => id.startsWith("ext:"));
    expect(ids.indexOf("sources")).toBe(ids.indexOf(extensionSections[0]) - 1);
    expect(ids.at(-1)).toBe("recipes");
    for (const ext of CATALOG) expect(sections.some((s) => s.title.startsWith(`${ext.name} · `)), ext.name).toBe(true);
    expect(extensionSections.filter((id) => id.startsWith("ext:arithmetics")).length).toBeGreaterThan(1);
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

  it("doesn't auto-play examples that need a camera, the screen, the network, blank everything, or are broken upstream", () => {
    const manual = entries.filter((e) => !e.autoplay).map((e) => e.id).sort();
    expect(manual).toEqual([
      "ext:arithmetics:distance", "ext:arithmetics:distanceCenter", "ext:arithmetics:length",
      "ext:outputs:setBufferCount", "ext:outputs:setMirror", "ext:outputs:setRepeat",
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

  it("finds what extensions add, output methods by their output, and extensions by name", () => {
    expect(id("blinking")).toBe("ext:softpattern:blinking");
    expect(id("lookupX")).toBe("ext:gradientmap:lookupX");
    expect(id("setLinear", "o1")).toBe("ext:outputs:setLinear");
    expect(id("clear", "oS")).toBe("ext:outputs:clear");
    expect(id("clear", "s0")).toBe("source:clear");
    expect(id("softpattern")).toBe("ext:softpattern");
    expect(id("hydra-fractals")).toBe("ext:fractals");
    // Hydra's own add, not arithmetics' wrapper.
    expect(id("add")).toBe("hydra:add");
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

  it("prefers an exact name, ignoring the ao. and o0. prefixes", () => {
    expect(filterEntries(entries, "bass").best?.id).toBe("ao:bass");
    expect(filterEntries(entries, "setlinear").best?.id).toBe("ext:outputs:setLinear");
    expect(filterEntries(entries, "smoothsun").best?.id).toBe("ext:softpattern:smoothsun");
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
