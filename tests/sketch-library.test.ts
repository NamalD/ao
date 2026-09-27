import { describe, expect, it } from "vitest";
import {
  coverRect, fuzzyFilter, fuzzyMatch, isBlankFrame, isSketchName, moveSelection, noteRecent, placeholderHues,
  planThumbnails, renameRecent, sortSketches, visibleSketches,
} from "../src/shared/sketch-library";

describe("isSketchName", () => {
  it("accepts file stems and refuses anything that walks a path", () => {
    for (const ok of ["dunes", "challenge-2026-09-27-lava-lamp", "a_b", "X1"]) expect(isSketchName(ok)).toBe(true);
    for (const bad of ["", "../state", "a/b", "a.png", "a b", ".", "..", "a\\b", 3, null, undefined]) expect(isSketchName(bad)).toBe(false);
  });
});

describe("fuzzyMatch", () => {
  it("matches subsequences case-insensitively and reports the matched indices", () => {
    expect(fuzzyMatch("dns", "dunes")?.indices).toEqual([0, 2, 4]);
    expect(fuzzyMatch("DUN", "dunes")?.indices).toEqual([0, 1, 2]);
    expect(fuzzyMatch("xyz", "dunes")).toBeNull();
    expect(fuzzyMatch("dunesdunes", "dunes")).toBeNull();
    expect(fuzzyMatch("", "dunes")).toEqual({ score: 0, indices: [] });
  });

  it("prefers word starts over the first occurrence", () => {
    expect(fuzzyMatch("lamp", "challenge-lava-lamp")?.indices).toEqual([15, 16, 17, 18]);
    expect(fuzzyMatch("ll", "challenge-lava-lamp")?.indices).toEqual([10, 15]);
  });

  it("ignores spaces in the query", () => {
    expect(fuzzyMatch("ch lava", "challenge-2026-lava")).not.toBeNull();
  });

  it("scores prefixes above word starts above scattered letters, and shorter names first", () => {
    const score = (q: string, n: string) => fuzzyMatch(q, n)!.score;
    expect(score("ha", "halo")).toBeGreaterThan(score("ha", "big-halo"));
    expect(score("ha", "big-halo")).toBeGreaterThan(score("ha", "chain"));
    expect(score("ink", "ink")).toBeGreaterThan(score("ink", "inky-depths"));
  });
});

describe("fuzzyFilter", () => {
  const names = ["aurora", "dunes", "halo", "ink", "prism", "rothko"];

  it("keeps the given order for an empty query", () => {
    expect(fuzzyFilter("  ", names).map((r) => r.name)).toEqual(names);
  });

  it("drops non-matches and ranks the best match first, ties in display order", () => {
    expect(fuzzyFilter("o", names).map((r) => r.name)).toEqual(["rothko", "halo", "aurora"]);
    expect(fuzzyFilter("r", ["rothko", "aurora", "prism"]).map((r) => r.name)).toEqual(["rothko", "prism", "aurora"]);
    expect(fuzzyFilter("ro", names).map((r) => r.name)).toEqual(["rothko", "aurora"]);
    expect(fuzzyFilter("zz", names)).toEqual([]);
  });
});

describe("sortSketches", () => {
  const names = ["prism", "dunes", "sketch-10", "sketch-9", "Aurora"];

  it("sorts by name, case-insensitively with numbers in order", () => {
    expect(sortSketches(names, ["dunes"], "name")).toEqual(["Aurora", "dunes", "prism", "sketch-9", "sketch-10"]);
  });

  it("puts recently opened sketches first, most recent first, skipping gone and repeated names", () => {
    expect(sortSketches(names, ["prism", "gone", "sketch-10", "prism"], "recent"))
      .toEqual(["prism", "sketch-10", "Aurora", "dunes", "sketch-9"]);
    expect(sortSketches(names, [], "recent")).toEqual(sortSketches(names, [], "name"));
  });
});

describe("visibleSketches", () => {
  const names = ["dunes", "challenge-2026-09-27-a", "halo", "challenge-2026-09-28-b"];

  it("hides challenge attempts unless asked, but never the open sketch", () => {
    expect(visibleSketches(names, false)).toEqual(["dunes", "halo"]);
    expect(visibleSketches(names, false, "challenge-2026-09-28-b")).toEqual(["dunes", "halo", "challenge-2026-09-28-b"]);
    expect(visibleSketches(names, true)).toEqual(names);
  });
});

describe("recent list", () => {
  it("moves an opened sketch to the front, without duplicates, capped", () => {
    expect(noteRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(noteRecent(["a", "b"], "z", 2)).toEqual(["z", "a"]);
  });

  it("gives a renamed sketch the old name's place", () => {
    expect(renameRecent(["a", "b", "c"], "b", "x")).toEqual(["a", "x", "c"]);
    // Replacing an existing sketch: the target's old place goes.
    expect(renameRecent(["c", "a", "b"], "b", "c")).toEqual(["a", "c"]);
    expect(renameRecent(["a"], "a", "a")).toEqual(["a"]);
  });
});

describe("moveSelection", () => {
  // 10 cards in 4 columns:  0 1 2 3 / 4 5 6 7 / 8 9
  const move = (i: number, m: Parameters<typeof moveSelection>[3], rows?: number) => moveSelection(i, 10, 4, m, rows);

  it("steps left and right through the list, across rows, stopping at the ends", () => {
    expect(move(3, "right")).toBe(4);
    expect(move(4, "left")).toBe(3);
    expect(move(0, "left")).toBe(0);
    expect(move(9, "right")).toBe(9);
  });

  it("moves up and down by a row, dropping to the last card of a shorter last row", () => {
    expect(move(1, "down")).toBe(5);
    expect(move(5, "down")).toBe(9);
    expect(move(6, "down")).toBe(9);
    expect(move(9, "down")).toBe(9);
    expect(move(5, "up")).toBe(1);
    expect(move(2, "up")).toBe(2);
    expect(moveSelection(2, 3, 4, "down")).toBe(2);
  });

  it("pages by rows and jumps to the ends", () => {
    expect(move(1, "pagedown", 2)).toBe(9);
    expect(move(1, "pagedown", 1)).toBe(5);
    expect(move(9, "pageup", 2)).toBe(1);
    expect(move(6, "pageup", 5)).toBe(2);
    expect(move(5, "home")).toBe(0);
    expect(move(5, "end")).toBe(9);
  });

  it("copes with an empty grid, one column and an out-of-range index", () => {
    expect(moveSelection(0, 0, 4, "down")).toBe(-1);
    expect(moveSelection(0, 3, 1, "down")).toBe(1);
    expect(moveSelection(-1, 3, 0, "right")).toBe(1);
    expect(moveSelection(7, 3, 4, "left")).toBe(1);
  });
});

describe("coverRect", () => {
  it("crops a frame to 16:9, centred", () => {
    expect(coverRect(1280, 720)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(coverRect(1000, 1000)).toEqual({ x: 0, y: 218, width: 1000, height: 563 });
    expect(coverRect(2000, 720)).toEqual({ x: 360, y: 0, width: 1280, height: 720 });
  });
});

describe("isBlankFrame", () => {
  it("is true only when every sampled pixel is black or transparent", () => {
    const frame = new Uint8Array(4 * 100);
    expect(isBlankFrame(frame, 1)).toBe(true);
    for (let p = 0; p < frame.length; p += 4) frame[p + 3] = 255; // opaque black
    expect(isBlankFrame(frame, 1)).toBe(true);
    for (let p = 0; p < frame.length; p += 4) frame.set([2, 2, 8], p); // Ao's page background
    expect(isBlankFrame(frame, 1)).toBe(true);
    frame[40] = 200; // one lit pixel
    expect(isBlankFrame(frame, 1)).toBe(false);
    frame[43] = 0; // …but transparent
    expect(isBlankFrame(frame, 1)).toBe(true);
  });
});

describe("placeholderHues", () => {
  it("is stable per name and differs between names", () => {
    expect(placeholderHues("dunes")).toEqual(placeholderHues("dunes"));
    expect(placeholderHues("dunes")).not.toEqual(placeholderHues("halo"));
    for (const h of placeholderHues("prism")) expect(h >= 0 && h < 360).toBe(true);
  });
});

describe("planThumbnails", () => {
  const sketches = ["aurora", "dunes", "halo"];

  it("renders only missing thumbnails and prunes those of deleted sketches", () => {
    expect(planThumbnails(sketches, ["dunes", "gone"])).toEqual({ render: ["aurora", "halo"], skip: ["dunes"], prune: ["gone"] });
  });

  it("renders everything when forced", () => {
    expect(planThumbnails(sketches, ["dunes"], true)).toEqual({ render: sketches, skip: [], prune: [] });
  });

  it("limits the run to named sketches, ignoring unknown names", () => {
    expect(planThumbnails(sketches, ["dunes"], false, ["dunes", "halo", "nope"])).toEqual({ render: ["halo"], skip: ["dunes"], prune: [] });
    expect(planThumbnails(sketches, ["dunes"], true, ["dunes"]).render).toEqual(["dunes"]);
  });
});
