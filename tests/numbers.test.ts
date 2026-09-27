import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  formatLiteral, jitterLiteral, literalAt, literalStep, numbersIn, nudgeLiteral, parseLiteral, remixChanges, runRangeAt, separated,
} from "../src/renderer/numbers";

const state = (doc: string) => EditorState.create({ doc, extensions: javascript() });
const texts = (doc: string) => numbersIn(state(doc), 0, doc.length).map((s) => s.text);
/** A deterministic stand-in for Math.random. */
const sequence = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe("parsing and formatting literals", () => {
  it("reads plain decimals and their shape", () => {
    expect(parseLiteral("0.05")).toEqual({ value: 0.05, decimals: 2, point: true, bare: false });
    expect(parseLiteral("10")).toEqual({ value: 10, decimals: 0, point: false, bare: false });
    expect(parseLiteral(".5")).toEqual({ value: 0.5, decimals: 1, point: true, bare: true });
    expect(parseLiteral("-2.25")?.value).toBe(-2.25);
    expect(parseLiteral("1.")).toEqual({ value: 1, decimals: 0, point: true, bare: false });
  });

  it("leaves exponents, hex, separators and bigints alone", () => {
    for (const text of ["1e3", "0x1f", "1_000", "10n", "", ".", "-", "1.2.3"]) expect(parseLiteral(text)).toBeNull();
  });

  it("writes values back in the same shape", () => {
    expect(formatLiteral(0.3, parseLiteral(".5")!)).toBe(".3");
    expect(formatLiteral(-0.3, parseLiteral(".5")!)).toBe("-.3");
    expect(formatLiteral(2, parseLiteral("1.")!)).toBe("2.");
    expect(formatLiteral(-0.001, parseLiteral("0.05")!)).toBe("0.00");
  });
});

describe("nudging", () => {
  it("steps by the literal's precision", () => {
    expect(literalStep(parseLiteral("0.05")!)).toBe(0.01);
    expect(literalStep(parseLiteral("10")!)).toBe(1);
    expect(nudgeLiteral("0.05", 1)).toBe("0.06");
    expect(nudgeLiteral("10", -3)).toBe("7");
    expect(nudgeLiteral("1.50", 10)).toBe("1.60");
  });

  it("never accumulates float error", () => {
    expect(nudgeLiteral("0.1", 2)).toBe("0.3");
    expect(nudgeLiteral("0.07", 1)).toBe("0.08");
  });

  it("crosses zero in both directions, keeping the style", () => {
    expect(nudgeLiteral("0.02", -5)).toBe("-0.03");
    expect(nudgeLiteral("-0.03", 5)).toBe("0.02");
    expect(nudgeLiteral(".2", -3)).toBe("-.1");
    expect(nudgeLiteral("1", -1)).toBe("0");
    expect(nudgeLiteral("0", -1)).toBe("-1");
  });

  it("returns null for anything else", () => {
    expect(nudgeLiteral("1e3", 1)).toBeNull();
  });

  it("separates a new minus from a preceding one", () => {
    expect(separated("-", "-1")).toBe(" -1");
    expect(separated("-", "1")).toBe("1");
    expect(separated("(", "-1")).toBe("-1");
  });
});

describe("jitter", () => {
  it("moves the magnitude by 10 to 40 percent either way", () => {
    expect(jitterLiteral("1.00", sequence(0, 0.9))).toBe("1.10");
    expect(jitterLiteral("1.00", sequence(0.999999, 0.1))).toBe("0.60");
    expect(jitterLiteral("20", sequence(0.5, 0.9))).toBe("25");
  });

  it("keeps the sign, precision and style", () => {
    expect(jitterLiteral("-0.5", sequence(0, 0.9))).toBe("-0.6");
    expect(jitterLiteral(".50", sequence(0, 0.1))).toBe(".45");
  });

  it("keeps integers whole and never rounds a nonzero value to zero", () => {
    for (let i = 0; i < 50; i++) {
      const random = sequence(i / 50, (i * 7 % 50) / 50);
      expect(jitterLiteral("3", random)).toMatch(/^[1-9]\d*$/);
      expect(jitterLiteral("0.01", random)).toMatch(/^0\.0[1-9]$/);
    }
  });

  it("leaves zero and non-decimals alone", () => {
    expect(jitterLiteral("0", Math.random)).toBeNull();
    expect(jitterLiteral("0.0", Math.random)).toBeNull();
    expect(jitterLiteral("0x10", Math.random)).toBeNull();
  });
});

describe("finding literals", () => {
  it("finds numbers in code, not in strings or comments", () => {
    expect(texts(`osc(20, 0.05) // 3 comments\n/* 4 */ src("o1.5", '2').out(6)`)).toEqual(["20", "0.05", "6"]);
  });

  it("reads GLSL in initScene and glsl: strings, skipping comments, # lines and identifiers", () => {
    const doc = [
      "s0.initScene(`#version 300 es",
      "vec3 c = vec3(1.0, .5, 2); // 9.0",
      "/* 8.0",
      "   7.0 */ float e = 1e-3 + c.x2;`, { scale: 0.75 })",
      "setFunction({ name: 'a', glsl: `return vec4(0.25);` })",
    ].join("\n");
    const spans = numbersIn(state(doc), 0, doc.length);
    expect(spans.map((s) => `${s.text}${s.glsl ? "g" : ""}`)).toEqual(["1.0g", ".5g", "2g", "3g", "0.75", "0.25g"]);
  });

  it("reads GLSL in initScene buffers but not in other arrays", () => {
    const doc = "s0.initScene(`float a = 1.0;`, { buffers: [`float b = 2.0;`, `float c = 3.0;`], scale: 0.5 })\nlog([`4.0`])";
    const spans = numbersIn(state(doc), 0, doc.length);
    expect(spans.map((s) => `${s.text}${s.glsl ? "g" : ""}`)).toEqual(["1.0g", "2.0g", "3.0g", "0.5"]);
  });

  it("leaves other template strings alone but reads their interpolations", () => {
    expect(texts("log(`frame 12 ${3 * 2}`)")).toEqual(["3", "2"]);
    expect(texts("s1.initImage(`https://x.io/1.5.jpg`)")).toEqual([]);
  });

  it("finds the literal at a position, with its unary minus", () => {
    const doc = "osc(-0.5, a-3, 10)";
    const s = state(doc);
    expect(literalAt(s, 6)).toMatchObject({ from: 4, to: 8, text: "-0.5" });
    expect(literalAt(s, 13)).toMatchObject({ text: "3" }); // binary minus stays outside
    expect(literalAt(s, 17)).toMatchObject({ text: "10" }); // just after the literal
    expect(literalAt(s, 1)).toBeNull();
  });

  it("finds a unary minus in GLSL by its context", () => {
    const doc = "s0.initScene(`float a = -1.5, b = c -2.0;`)";
    const s = state(doc);
    expect(literalAt(s, doc.indexOf("1.5"))?.text).toBe("-1.5");
    expect(literalAt(s, doc.indexOf("2.0"))?.text).toBe("2.0");
  });
});

describe("run range", () => {
  it("is the block for ordinary code", () => {
    const doc = "osc(1).out()\n\nnoise(2)\n  .out()";
    expect(runRangeAt(state(doc), doc.indexOf("2"))).toEqual({ from: 14, to: doc.length });
    expect(runRangeAt(state(doc), 13)).toBeNull();
  });

  it("widens to the whole statement when a shader has blank lines", () => {
    const doc = "a = 1\n\ns0.initScene(`\nfloat x = 1.0;\n\nfloat y = 2.0;\n`)\nsrc(s0).out()\n\nb = 2";
    const range = runRangeAt(state(doc), doc.indexOf("2.0"))!;
    expect(doc.slice(range.from, range.to)).toBe("s0.initScene(`\nfloat x = 1.0;\n\nfloat y = 2.0;\n`)\nsrc(s0).out()");
  });
});

describe("remix changes", () => {
  it("changes JS numbers and GLSL floats, not GLSL integers", () => {
    const doc = "s0.initScene(`for (int i = 0; i < 64; i++) x += 0.5;`, { scale: 0.75 })\nosc(20)";
    const changes = remixChanges(state(doc), 0, doc.length, sequence(0.5, 0.9));
    expect(changes.map((c) => doc.slice(c.from, c.to))).toEqual(["0.5", "0.75", "20"]);
    expect(changes.map((c) => c.insert)).toEqual(["0.6", "0.94", "25"]);
  });
});
