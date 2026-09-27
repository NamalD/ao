import { describe, expect, it } from "vitest";
import { evaluateUniform, formatShaderLog, MAX_BUFFERS, PRELUDE_LINES, sceneSources } from "../src/renderer/scenes";

describe("formatShaderLog", () => {
  it("reports errors at the scene's own line numbers", () => {
    const log = `ERROR: 0:${PRELUDE_LINES + 3}: 'foo' : undeclared identifier\nERROR: 0:${PRELUDE_LINES + 7}: syntax error`;
    expect(formatShaderLog(log)).toBe("ERROR: 0:3: 'foo' : undeclared identifier\nERROR: 0:7: syntax error");
  });
});

describe("evaluateUniform", () => {
  it("passes numbers and matching vectors through", () => {
    expect(evaluateUniform("a", 0.5, 1)).toEqual({ value: [0.5] });
    expect(evaluateUniform("a", () => [1, 2, 3], 3)).toEqual({ value: [1, 2, 3] });
    expect(evaluateUniform("a", () => 2, 2)).toEqual({ value: [2, 2] });
  });

  // Regression: a throwing uniform function used to stop the frame loop for good.
  it("falls back to zero and reports when the function throws", () => {
    const result = evaluateUniform("swirl", () => { throw new ReferenceError("mids is not defined"); }, 1);
    expect(result).toEqual({ value: [0], error: "uniform swirl: mids is not defined" });
  });

  it("falls back to zero for values that aren't finite numbers", () => {
    const bad = [undefined, "0.5", NaN, Infinity, { x: 1 }, [1, "2"]];
    for (const value of bad) {
      const result = evaluateUniform("u", (() => value) as () => number, 2);
      expect(result.value).toEqual([0, 0]);
      expect(result.error).toMatch(/^uniform u is .*, expected a number or 2 numbers$/);
    }
  });

  it("pads or truncates vectors of the wrong length and reports it", () => {
    expect(evaluateUniform("v", [1, 2], 3)).toEqual({ value: [1, 2, 0], error: "uniform v has 2 values, expected 3" });
    expect(evaluateUniform("v", () => [1, 2, 3, 4], 1)).toEqual({ value: [1], error: "uniform v has 4 values, expected 1" });
  });
});

describe("sceneSources", () => {
  it("runs the buffers in order before the image", () => {
    expect(sceneSources("image", { buffers: ["velocity", "dye"] })).toEqual(["velocity", "dye", "image"]);
    expect(sceneSources("image")).toEqual(["image"]);
  });

  it("rejects buffers it can't run when the line runs", () => {
    expect(() => sceneSources("image", { buffers: "velocity" as unknown as string[] }))
      .toThrow("initScene buffers: expected an array of GLSL strings, such as [velocity, dye]");
    expect(() => sceneSources("image", { buffers: new Array<string>(MAX_BUFFERS + 1).fill("b") }))
      .toThrow(`initScene buffers: at most ${MAX_BUFFERS}, got ${MAX_BUFFERS + 1}`);
    expect(() => sceneSources("image", { buffers: ["a", undefined as unknown as string] }))
      .toThrow("initScene buffers[1]: expected GLSL source, got undefined");
  });
});
