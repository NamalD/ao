/**
 * Numeric literals in sketch code: finding them, stepping them for scrubbing,
 * and jittering them for remix. Everything here is pure: it reads an
 * EditorState (for the JavaScript syntax tree) or plain strings, never the DOM.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { blockAt } from "./blocks";

// --- Literal text ------------------------------------------------------------

/** How a decimal literal is written, so a new value can be written the same way. */
export interface LiteralShape {
  /** Digits after the decimal point. */
  decimals: number;
  /** Written with a decimal point, e.g. `1.5`, `.5` or `1.`. GLSL needs this to stay a float. */
  point: boolean;
  /** Written without a leading zero, as in `.5`. */
  bare: boolean;
}

export interface ParsedLiteral extends LiteralShape { value: number }

const DECIMAL = /^(-?)(\d*)(\.?)(\d*)$/;

/**
 * Parses a plain decimal literal with an optional leading `-`: `10`, `0.05`,
 * `.5`, `-2.25`, `1.`. Exponents, hex, separators and bigints return null, so
 * they are left alone.
 */
export function parseLiteral(text: string): ParsedLiteral | null {
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const [, sign, whole, point, fraction] = match;
  if (!whole && !fraction) return null;
  if (!point && fraction) return null;
  const value = Number(`${sign}${whole || "0"}.${fraction || "0"}`);
  return { value, decimals: fraction.length, point: point === ".", bare: !whole };
}

/** Writes `value` in `shape`: same decimal places, same `.5` or `1.` style. */
export function formatLiteral(value: number, shape: LiteralShape): string {
  let text = Math.abs(value).toFixed(shape.decimals);
  const zero = Number(text) === 0;
  if (shape.bare && text.startsWith("0.")) text = text.slice(1);
  if (shape.point && shape.decimals === 0) text += ".";
  return value < 0 && !zero ? `-${text}` : text;
}

/** The literal's smallest step: 0.05 steps by 0.01, 10 by 1. */
export function literalStep(shape: LiteralShape): number {
  return 10 ** -shape.decimals;
}

/**
 * `text` moved by `steps` of its smallest step, keeping its formatting. The
 * sign may cross zero. Returns null for text that isn't a plain decimal.
 */
export function nudgeLiteral(text: string, steps: number): string | null {
  const literal = parseLiteral(text);
  if (!literal) return null;
  // Count in whole steps so repeated nudges never accumulate float error.
  const scale = 10 ** literal.decimals;
  const units = Math.round(literal.value * scale) + Math.round(steps);
  return formatLiteral(units / scale, literal);
}

/**
 * Text to insert in place of a literal that follows `before`, the character
 * just ahead of it. A value turning negative after a `-`, as in `a-5` going
 * to `a--1`, would read as a decrement, so it gets a separating space.
 */
export function separated(before: string, text: string): string {
  return before === "-" && text.startsWith("-") ? ` ${text}` : text;
}

/**
 * A random relative change of `text`, for remix: the magnitude moves by 10 to
 * 40 percent either way and keeps its sign and decimal places. Integers stay
 * integers (they are often counts), and a nonzero value never rounds to zero.
 * Zero, and text that isn't a plain decimal, returns null: nothing to change.
 * `random` returns values in [0, 1) like Math.random.
 */
export function jitterLiteral(text: string, random: () => number = Math.random): string | null {
  const literal = parseLiteral(text);
  if (!literal || literal.value === 0) return null;
  const amount = 0.1 + 0.3 * random();
  const factor = random() < 0.5 ? 1 - amount : 1 + amount;
  const scale = 10 ** literal.decimals;
  let units = Math.round(Math.abs(literal.value) * factor * scale);
  if (units === 0) units = 1;
  return formatLiteral((Math.sign(literal.value) * units) / scale, literal);
}

// --- Finding literals ----------------------------------------------------------

/** A numeric literal in the document. `glsl` marks one inside shader source. */
export interface NumberSpan { from: number; to: number; text: string; glsl: boolean }

function fullTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
}

/**
 * Whether a string node holds GLSL: the first argument of `initScene`, or a
 * `glsl:` property as passed to `setFunction`. Other strings are left alone,
 * so URLs, labels and plain template strings never change.
 */
export function isShaderString(state: EditorState, node: SyntaxNode): boolean {
  if (node.name !== "TemplateString" && node.name !== "String") return false;
  const parent = node.parent;
  if (parent?.name === "Property") {
    const key = parent.getChild("PropertyDefinition");
    return !!key && state.sliceDoc(key.from, key.to) === "glsl";
  }
  if (parent?.name === "ArgList" && parent.parent?.name === "CallExpression") {
    // Only the first argument: the options object after it is JavaScript.
    let first = parent.firstChild?.nextSibling;
    while (first && (first.name === "LineComment" || first.name === "BlockComment")) first = first.nextSibling;
    if (!first || first.from !== node.from) return false;
    const callee = parent.parent.firstChild;
    return !!callee && /(^|\.)\s*initScene$/.test(state.sliceDoc(callee.from, callee.to));
  }
  return false;
}

// Plain decimals not touching identifier characters or dots: skips `vec3`,
// swizzles, exponents like `1e-3` and suffixes like `1.0f` or `2u`.
const GLSL_NUMBER = /(?<![\w.])(?:\d+\.\d*|\.\d+|\d+)(?![\w.])/g;

/** Numbers in a shader string between `from` and `to`, skipping comments and preprocessor lines. */
function shaderNumbers(state: EditorState, node: SyntaxNode, from: number, to: number): NumberSpan[] {
  // The string's own text, with `${…}` interpolations blanked out: those are JavaScript.
  let text = state.sliceDoc(node.from, node.to);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "Interpolation") {
      text = text.slice(0, child.from - node.from) + " ".repeat(child.to - child.from) + text.slice(child.to - node.from);
    }
  }
  // Blank out quotes, comments and `#` lines, keeping every offset.
  text = text.replace(/^.|.$/g, " ")
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|^[ \t]*#[^\n]*/gm, (m) => m.replace(/[^\n]/g, " "));
  const spans: NumberSpan[] = [];
  for (const match of text.matchAll(GLSL_NUMBER)) {
    const start = node.from + match.index;
    const end = start + match[0].length;
    if (start >= from && end <= to) spans.push({ from: start, to: end, text: match[0], glsl: true });
  }
  return spans;
}

/**
 * The plain decimal literals between `from` and `to`, in document order:
 * JavaScript numbers (never inside strings or comments) and numbers in
 * shader strings (see isShaderString). A unary minus isn't included.
 */
export function numbersIn(state: EditorState, from: number, to: number): NumberSpan[] {
  const spans: NumberSpan[] = [];
  fullTree(state).iterate({
    from, to,
    enter: (ref) => {
      if (ref.name === "Number") {
        const text = state.sliceDoc(ref.from, ref.to);
        if (ref.from >= from && ref.to <= to && parseLiteral(text)) spans.push({ from: ref.from, to: ref.to, text, glsl: false });
        return false;
      }
      if (ref.name === "TemplateString" || ref.name === "String") {
        if (isShaderString(state, ref.node)) spans.push(...shaderNumbers(state, ref.node, from, to));
        // Template interpolations are JavaScript: keep walking into them.
        return ref.name === "TemplateString";
      }
      return undefined;
    },
  });
  return spans.sort((a, b) => a.from - b.from);
}

/**
 * The literal at `pos`, for scrubbing: `pos` may sit anywhere on it, or just
 * after it. A directly attached unary minus is part of the literal, so `-0.5`
 * scrubs through zero to `0.5` and back.
 */
export function literalAt(state: EditorState, pos: number): NumberSpan | null {
  const line = state.doc.lineAt(pos);
  const span = numbersIn(state, line.from, line.to).find((s) => s.from <= pos && pos <= s.to);
  if (!span) return null;
  if (state.sliceDoc(span.from - 1, span.from) !== "-") return span;
  let unary: boolean;
  if (span.glsl) {
    // No syntax tree for GLSL: a minus after an operator, bracket or line start is unary.
    const before = state.sliceDoc(line.from, span.from - 1).trimEnd();
    unary = before === "" || /[-+*/%=<>!&|^?:,([{]$/.test(before);
  } else {
    const node = fullTree(state).resolveInner(span.from, 1);
    unary = node.parent?.name === "UnaryExpression" && node.parent.from === span.from - 1;
  }
  return unary ? { ...span, from: span.from - 1, text: `-${span.text}` } : span;
}

// --- What to run ------------------------------------------------------------------

/**
 * The code to run for a change at `pos`: the block around it, widened to whole
 * top-level statements. A shader with blank lines inside it is one statement
 * spanning several blocks, so scrubbing a number in it re-runs the whole
 * `initScene` call rather than a fragment that can't parse.
 */
export function runRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const text = state.doc.toString();
  const block = blockAt(text, pos);
  if (!block) return null;
  const top = fullTree(state).topNode;
  let { from, to } = block;
  for (;;) {
    let wideFrom = from, wideTo = to;
    for (let node = top.firstChild; node; node = node.nextSibling) {
      if (node.to > from && node.from < to) {
        wideFrom = Math.min(wideFrom, node.from);
        wideTo = Math.max(wideTo, node.to);
      }
    }
    const first = blockAt(text, wideFrom) ?? { from: wideFrom, to: wideFrom };
    const last = blockAt(text, wideTo) ?? { from: wideTo, to: wideTo };
    wideFrom = Math.min(wideFrom, first.from);
    wideTo = Math.max(wideTo, last.to);
    if (wideFrom === from && wideTo === to) return { from, to };
    from = wideFrom;
    to = wideTo;
  }
}

// --- Remix ---------------------------------------------------------------------------

/**
 * Replacement text for each literal a remix changes between `from` and `to`.
 * JavaScript numbers all take part; in shaders only floats written with a
 * decimal point do, since GLSL integers are loop bounds, indices and sizes
 * where a change can break compilation. Floats stay floats.
 */
export function remixChanges(state: EditorState, from: number, to: number, random: () => number = Math.random): { from: number; to: number; insert: string }[] {
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const span of numbersIn(state, from, to)) {
    if (span.glsl && !span.text.includes(".")) continue;
    const insert = jitterLiteral(span.text, random);
    if (insert !== null && insert !== span.text) changes.push({ from: span.from, to: span.to, insert });
  }
  return changes;
}
