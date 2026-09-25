import { describe, expect, it } from "vitest";
import { blockAt } from "../src/renderer/blocks";

const text = "osc().out()\n\nnoise()\n  .out()\n\n\nshape()";

describe("blockAt", () => {
  it("selects the run of non-blank lines around the cursor", () => {
    const at = text.indexOf(".out()\n\n\n");
    const block = blockAt(text, at)!;
    expect(text.slice(block.from, block.to)).toBe("noise()\n  .out()");
  });

  it("handles the first and last blocks", () => {
    const first = blockAt(text, 0)!;
    expect(text.slice(first.from, first.to)).toBe("osc().out()");
    const last = blockAt(text, text.length)!;
    expect(text.slice(last.from, last.to)).toBe("shape()");
  });

  it("returns null on a blank line", () => {
    expect(blockAt(text, text.indexOf("\n\n") + 1)).toBeNull();
  });
});
