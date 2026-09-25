import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../src/main/store";

describe("Store", () => {
  it("lists, reads, and writes sketches", () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "ao-store-")));
    store.writeSketch("waves", "osc().out()");
    writeFileSync(join(store.sketchDir, "notes.txt"), "ignored");
    expect(store.listSketches()).toEqual(["waves"]);
    expect(store.readSketch("waves")).toBe("osc().out()");
  });

  it("rejects sketch names that escape the sketch directory", () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "ao-store-")));
    expect(() => store.readSketch("../package")).toThrow(/invalid sketch name/);
  });

  it("falls back to defaults for missing or corrupt state", () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "ao-store-")));
    expect(store.read("window", { width: 1 })).toEqual({ width: 1 });
    writeFileSync(join(store.stateDir, "window.json"), "{");
    expect(store.read("window", { width: 1 })).toEqual({ width: 1 });
    store.write("window", { width: 2 });
    expect(store.read("window", { width: 1 })).toEqual({ width: 2 });
  });
});
