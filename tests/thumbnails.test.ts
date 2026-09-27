import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../src/main/store";
import {
  isPng, listThumbnails, moveThumbnail, readRecent, readThumbnail, recordOpened, thumbnailPath, writeThumbnail,
} from "../src/main/thumbnails";

const tempStore = () => new Store(mkdtempSync(join(tmpdir(), "ao-thumbs-")));
const png = (tag: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag]);

describe("thumbnail files", () => {
  it("maps names to state/thumbnails/<name>.png and refuses path tricks", () => {
    const { stateDir } = tempStore();
    expect(thumbnailPath(stateDir, "dunes")).toBe(join(stateDir, "thumbnails", "dunes.png"));
    for (const bad of ["../ao", "a/b", "", "x.png"]) expect(() => thumbnailPath(stateDir, bad)).toThrow(/invalid sketch name/);
  });

  it("writes, lists and reads PNGs, and reads a missing or invalid name as null", () => {
    const { stateDir } = tempStore();
    expect(listThumbnails(stateDir)).toEqual([]);
    writeThumbnail(stateDir, "halo", png(1));
    writeThumbnail(stateDir, "dunes", new Uint8Array(png(2)).buffer);
    expect(listThumbnails(stateDir)).toEqual(["dunes", "halo"]);
    expect(readThumbnail(stateDir, "halo")).toEqual(png(1));
    expect(readThumbnail(stateDir, "nope")).toBeNull();
    expect(readThumbnail(stateDir, "../settings")).toBeNull();
    expect(readThumbnail(stateDir, 42)).toBeNull();
    // Written whole: no temp files left behind.
    expect(readdirSync(join(stateDir, "thumbnails")).sort()).toEqual(["dunes.png", "halo.png"]);
  });

  it("refuses anything that isn't a PNG, and bad names", () => {
    const { stateDir } = tempStore();
    expect(isPng(png(0))).toBe(true);
    expect(() => writeThumbnail(stateDir, "halo", Buffer.from("<svg/>"))).toThrow(/not a PNG/);
    expect(() => writeThumbnail(stateDir, "halo", "string")).toThrow(/not a PNG/);
    expect(() => writeThumbnail(stateDir, "../../evil", png(0))).toThrow(/invalid sketch name/);
    expect(existsSync(join(stateDir, "thumbnails", "halo.png"))).toBe(false);
  });

  it("moves a thumbnail, and drops the target's stale one when the source has none", () => {
    const { stateDir } = tempStore();
    writeThumbnail(stateDir, "a", png(1));
    writeThumbnail(stateDir, "b", png(2));
    moveThumbnail(stateDir, "a", "b");
    expect(listThumbnails(stateDir)).toEqual(["b"]);
    expect(readThumbnail(stateDir, "b")).toEqual(png(1));
    moveThumbnail(stateDir, "none", "b");
    expect(listThumbnails(stateDir)).toEqual([]);
    moveThumbnail(stateDir, "none", "other"); // nothing to do, no error
  });
});

describe("recent sketches", () => {
  it("records opened sketches most recent first and survives a corrupt file", () => {
    const store = tempStore();
    expect(readRecent(store)).toEqual([]);
    recordOpened(store, "dunes");
    recordOpened(store, "halo");
    recordOpened(store, "dunes");
    recordOpened(store, "../bad");
    expect(readRecent(store)).toEqual(["dunes", "halo"]);
    writeFileSync(join(store.stateDir, "recent.json"), '{"sketches": "no"}');
    expect(readRecent(store)).toEqual([]);
  });
});

describe("Store.renameSketch keeps the browser in step", () => {
  it("moves the thumbnail and the recent-list place with the sketch", () => {
    const store = tempStore();
    store.writeSketch("waves", "old");
    writeThumbnail(store.stateDir, "waves", png(7));
    recordOpened(store, "waves");
    recordOpened(store, "halo");
    store.renameSketch("waves", "tides", "new");
    expect(listThumbnails(store.stateDir)).toEqual(["tides"]);
    expect(readFileSync(thumbnailPath(store.stateDir, "tides"))).toEqual(png(7));
    expect(readRecent(store)).toEqual(["halo", "tides"]);
  });

  it("on :w! replaces the target's thumbnail, and leaves thumbnails alone when a rename is refused", () => {
    const store = tempStore();
    store.writeSketch("waves", "old");
    store.writeSketch("tides", "other");
    writeThumbnail(store.stateDir, "tides", png(1));
    expect(() => store.renameSketch("waves", "tides", "new")).toThrow(/already exists/);
    expect(readThumbnail(store.stateDir, "tides")).toEqual(png(1));
    store.renameSketch("waves", "tides", "new", true);
    // waves had no thumbnail, so tides' picture of the other code goes.
    expect(listThumbnails(store.stateDir)).toEqual([]);
  });
});
