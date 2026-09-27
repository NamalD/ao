import { describe, expect, it } from "vitest";
import { SketchWriter } from "../src/renderer/sketch-writer";

/** A write function whose writes finish only when `flush` releases them. */
function gatedWrites() {
  const writes: string[] = [];
  const releases: (() => void)[] = [];
  const write = (name: string, code: string) => new Promise<void>((resolve) => {
    writes.push(`${name}:${code}`);
    releases.push(resolve);
  });
  const flush = async () => {
    for (let i = 0; i < 20; i++) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { writes, write, flush };
}

describe("SketchWriter", () => {
  it("doesn't write content that was just read from disk", async () => {
    const writes: string[] = [];
    const writer = new SketchWriter(async (name, code) => { writes.push(`${name}:${code}`); });
    writer.known("dunes", "osc().out()");
    await writer.save("dunes", "osc().out()");
    expect(writes).toEqual([]);
    await writer.save("dunes", "noise().out()");
    await writer.save("dunes", "noise().out()");
    expect(writes).toEqual(["dunes:noise().out()"]);
  });

  it("keeps writes in order and skips a save of content already queued", async () => {
    const { writes, write, flush } = gatedWrites();
    const writer = new SketchWriter(write);
    const saves = [writer.save("a", "1"), writer.save("a", "2"), writer.save("a", "2")];
    await flush();
    await Promise.all(saves);
    expect(writes).toEqual(["a:1", "a:2"]);
  });

  it("writes again after reverting to content that an in-flight write replaces", async () => {
    const { writes, write, flush } = gatedWrites();
    const writer = new SketchWriter(write);
    writer.known("a", "old");
    const saves = [writer.save("a", "new"), writer.save("a", "old")];
    await flush();
    await Promise.all(saves);
    expect(writes).toEqual(["a:new", "a:old"]);
  });

  it("writes unchanged content again once told the file is gone", async () => {
    const writes: string[] = [];
    const writer = new SketchWriter(async (_name, code) => { writes.push(code); });
    writer.known("a", "x");
    writer.forget();
    await writer.save("a", "x");
    expect(writes).toEqual(["x"]);
  });

  it("retries content whose write failed", async () => {
    let fail = true;
    const writes: string[] = [];
    const writer = new SketchWriter(async (_name, code) => {
      writes.push(code);
      if (fail) throw new Error("disk full");
    });
    await expect(writer.save("a", "x")).rejects.toThrow("disk full");
    fail = false;
    await writer.save("a", "x");
    expect(writes).toEqual(["x", "x"]);
  });
});
