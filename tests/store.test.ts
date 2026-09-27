import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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

  it("rotates ao.log to ao.log.1 once it passes the size limit", () => {
    const root = mkdtempSync(join(tmpdir(), "ao-store-"));
    mkdirSync(join(root, "state"));
    // An existing log counts towards the limit.
    writeFileSync(join(root, "state", "ao.log"), "x".repeat(150));
    writeFileSync(join(root, "state", "ao.log.1"), "older");
    const store = new Store(root, { logLimit: 200 });
    const log = join(store.stateDir, "ao.log");
    const line = "m".repeat(20); // 47 bytes with the timestamp and newline

    store.log(line);
    expect(statSync(log).size).toBe(197);
    expect(existsSync(`${log}.1`) && readFileSync(`${log}.1`, "utf8")).toBe("older");

    store.log(line);
    expect(readFileSync(`${log}.1`, "utf8")).toMatch(/^x{150}.*m{20}\n$/s);
    expect(readFileSync(log, "utf8")).toMatch(/^\S+  m{20}\n$/);

    for (let i = 0; i < 10; i++) store.log(line);
    expect(statSync(log).size).toBeLessThanOrEqual(200);
    expect(statSync(`${log}.1`).size).toBeLessThanOrEqual(200);
  });
});

describe("Store.renameSketch", () => {
  const fresh = () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "ao-store-")));
    store.writeSketch("waves", "old");
    return store;
  };

  it("saves the new text under the new name and removes the old file", () => {
    const store = fresh();
    expect(store.renameSketch("waves", "tides", "new")).toBe("tides");
    expect(store.listSketches()).toEqual(["tides"]);
    expect(store.readSketch("tides")).toBe("new");
    expect(readdirSync(store.sketchDir)).toEqual(["tides.js"]);
  });

  it("accepts a .js name, since sketches are always .js", () => {
    const store = fresh();
    expect(store.renameSketch("waves", "tides.js", "new")).toBe("tides");
    expect(store.listSketches()).toEqual(["tides"]);
  });

  it("validates the name like sketchPath", () => {
    const store = fresh();
    for (const bad of ["../escape", "a b", "a.txt", ".js", ""]) {
      expect(() => store.renameSketch("waves", bad, "new")).toThrow(/invalid sketch name/);
    }
    expect(store.listSketches()).toEqual(["waves"]);
    expect(readdirSync(store.sketchDir)).toEqual(["waves.js"]);
  });

  it("refuses to overwrite an existing sketch unless asked", () => {
    const store = fresh();
    store.writeSketch("tides", "keep me");
    expect(() => store.renameSketch("waves", "tides", "new")).toThrow(/tides already exists/);
    expect(store.readSketch("tides")).toBe("keep me");
    expect(store.readSketch("waves")).toBe("old");
    expect(readdirSync(store.sketchDir).sort()).toEqual(["tides.js", "waves.js"]);

    store.renameSketch("waves", "tides", "new", true);
    expect(store.listSketches()).toEqual(["tides"]);
    expect(store.readSketch("tides")).toBe("new");
  });

  it("saves in place when the name doesn't change, and renames a sketch already gone", () => {
    const store = fresh();
    expect(store.renameSketch("waves", "waves.js", "new")).toBe("waves");
    expect(store.readSketch("waves")).toBe("new");
    unlinkSync(join(store.sketchDir, "waves.js"));
    store.renameSketch("waves", "tides", "back");
    expect(store.listSketches()).toEqual(["tides"]);
  });
});
