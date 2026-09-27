import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
