/**
 * Live values: finding `ao` expressions in sketch code and reading their
 * values without running the sketch. Everything here is pure: it reads an
 * EditorState's syntax tree and never touches the DOM.
 *
 * Nothing the user wrote is ever evaluated. An expression is parsed into a
 * tiny tree of literals, `ao` reads and arithmetic, and compiled into a
 * closure that only calls `ao`'s own getters and methods with literal
 * arguments. Anything else (variables, other calls, `time`) makes the
 * expression unreadable, and it is skipped.
 */
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { ChangeDesc, EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

// --- Expressions -----------------------------------------------------------------

export type LiveExpr =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  /** `ao.name`: a getter or plain value. */
  | { type: "member"; name: string }
  /** `object[index]` with a literal index, as in `ao.fft[3]`. */
  | { type: "index"; object: LiveExpr; index: number }
  /** `ao.name(args)`: one of `ao`'s own methods, called with readable arguments. */
  | { type: "call"; name: string; args: LiveExpr[] }
  /** `Math.name(args)`, for a few pure functions. */
  | { type: "math"; name: MathName; args: LiveExpr[] }
  | { type: "unary"; op: "-" | "+"; arg: LiveExpr }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "%" | "**"; left: LiveExpr; right: LiveExpr }
  /** `() => body`: Hydra calls it every frame, so its value is the body's. */
  | { type: "arrow"; body: LiveExpr };

const MATH = ["abs", "min", "max", "sin", "cos", "pow", "sqrt", "floor", "ceil", "round", "exp", "log"] as const;
type MathName = (typeof MATH)[number];
const BINARY = new Set(["+", "-", "*", "/", "%", "**"]);

/** How the `ao` object exposes a name: a value to read, a method to call, or neither. */
export type MemberKind = "value" | "method" | undefined;

/**
 * Member kinds from the `ao` object itself, so members added later (bpm,
 * phase, …) are found without touching the editor. `features` is internal.
 */
export function aoMemberKinds(target: object): (name: string) => MemberKind {
  const kinds = new Map<string, MemberKind>();
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(target))) {
    if (name === "features") continue;
    kinds.set(name, typeof d.value === "function" ? "method" : "value");
  }
  return (name) => kinds.get(name);
}

/** A found expression: where it is, a key shared by identical expressions, and how to read it. */
export interface LiveSpan { from: number; to: number; key: string; expr: LiveExpr }

/** The key for an expression's text: whitespace doesn't matter, so `ao.hz(40,100)` = `ao.hz(40, 100)`. */
export const liveKey = (text: string) => text.replace(/\s+/g, "");

const skipComments = (node: SyntaxNode | null): SyntaxNode | null => {
  while (node && (node.name === "LineComment" || node.name === "BlockComment")) node = node.nextSibling;
  return node;
};

/** The argument nodes of an ArgList, without brackets, commas and comments; null for spreads. */
function argNodes(list: SyntaxNode): SyntaxNode[] | null {
  const args: SyntaxNode[] = [];
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name === "Spread") return null;
    if (child.type.isError) return null;
    if (["(", ")", ",", "LineComment", "BlockComment"].includes(child.name)) continue;
    args.push(child);
  }
  return args;
}

class Parser {
  constructor(private readonly state: EditorState, private readonly kinds: (name: string) => MemberKind) {}

  text(node: SyntaxNode): string {
    return this.state.sliceDoc(node.from, node.to);
  }

  /** `ao.<name>` as a plain `.` access: the name, or null. */
  aoProperty(node: SyntaxNode): string | null {
    if (node.name !== "MemberExpression") return null;
    const object = node.firstChild, dot = object?.nextSibling, property = dot?.nextSibling;
    if (!object || object.name !== "VariableName" || this.text(object) !== "ao") return null;
    if (!dot || dot.name !== "." || !property || property.name !== "PropertyName" || property.nextSibling) return null;
    return this.text(property);
  }

  /** The expression at `node`, or null when it can't be read safely. */
  parse(node: SyntaxNode | null): LiveExpr | null {
    if (!node || node.type.isError) return null;
    switch (node.name) {
      case "Number": {
        const value = Number(this.text(node).replace(/_/g, ""));
        return Number.isFinite(value) ? { type: "number", value } : null;
      }
      case "String": {
        const raw = this.text(node);
        // Plain quoted text only: an escape is rare here and not worth decoding.
        return raw.includes("\\") ? null : { type: "string", value: raw.slice(1, -1) };
      }
      case "ParenthesizedExpression": {
        const inner = skipComments(node.firstChild?.nextSibling ?? null);
        return inner && inner.nextSibling?.name === ")" ? this.parse(inner) : null;
      }
      case "UnaryExpression": {
        const op = node.firstChild, arg = op?.nextSibling;
        const text = op ? this.text(op) : "";
        if (!op || op.name !== "ArithOp" || (text !== "-" && text !== "+")) return null;
        const inner = this.parse(arg ?? null);
        return inner && { type: "unary", op: text, arg: inner };
      }
      case "BinaryExpression": {
        const left = node.firstChild, op = left?.nextSibling, right = op?.nextSibling;
        const text = op ? this.text(op) : "";
        if (!left || !op || op.name !== "ArithOp" || !BINARY.has(text) || !right) return null;
        const l = this.parse(left), r = this.parse(right);
        return l && r && { type: "binary", op: text as "+", left: l, right: r };
      }
      case "ArrowFunction": {
        const params = node.firstChild;
        if (!params || params.name !== "ParamList" || params.firstChild?.nextSibling?.name !== ")") return null;
        const arrow = params.nextSibling;
        if (arrow?.name !== "Arrow") return null;
        const body = this.parse(arrow.nextSibling);
        return body && { type: "arrow", body };
      }
      case "MemberExpression": {
        const name = this.aoProperty(node);
        if (name !== null) return this.kinds(name) === "value" ? { type: "member", name } : null;
        // A literal index: `ao.fft[3]`.
        const object = node.firstChild, open = object?.nextSibling, index = open?.nextSibling;
        if (open?.name !== "[" || index?.name !== "Number" || index.nextSibling?.name !== "]") return null;
        const inner = this.parse(object ?? null);
        const i = Number(this.text(index));
        return inner && Number.isInteger(i) ? { type: "index", object: inner, index: i } : null;
      }
      case "CallExpression": {
        const callee = node.firstChild, list = callee?.nextSibling;
        if (!callee || list?.name !== "ArgList") return null;
        const nodes = argNodes(list);
        if (!nodes) return null;
        const args: LiveExpr[] = [];
        for (const arg of nodes) {
          const parsed = this.parse(arg);
          if (!parsed) return null;
          args.push(parsed);
        }
        const name = this.aoProperty(callee);
        if (name !== null) return this.kinds(name) === "method" ? { type: "call", name, args } : null;
        const math = /^Math\.(\w+)$/.exec(this.text(callee).replace(/\s+/g, ""));
        if (math && (MATH as readonly string[]).includes(math[1])) return { type: "math", name: math[1] as MathName, args };
        return null;
      }
      default:
        return null;
    }
  }
}

/** Whether the expression reads `ao` at all: `() => 2` is just a number. */
export function readsAo(expr: LiveExpr): boolean {
  switch (expr.type) {
    case "member": case "call": return true;
    case "number": case "string": return false;
    case "index": return readsAo(expr.object);
    case "unary": return readsAo(expr.arg);
    case "binary": return readsAo(expr.left) || readsAo(expr.right);
    case "arrow": return readsAo(expr.body);
    case "math": return expr.args.some(readsAo);
  }
}

/** Whether a node gets its own live value: an `ao` read, call or index, or an argument-less arrow reading `ao`. */
function displayable(expr: LiveExpr): boolean {
  if (expr.type === "arrow") return readsAo(expr.body);
  if (expr.type === "index") return displayable(expr.object);
  return expr.type === "member" || expr.type === "call";
}

/**
 * The `ao` expressions between `from` and `to`, in document order, at most
 * `limit` of them. Each is the outermost readable one: `() => 4 * ao.hz(6000,
 * 12000)` is one value, the one Hydra reads, and so is `ao.map("bass", 0, 2)`.
 * An `ao` read inside something unreadable, such as `() => spin + ao.bass`,
 * gets its own value. Strings and comments are skipped, template string
 * interpolations are JavaScript and are searched.
 */
export function findLiveExpressions(
  state: EditorState, from: number, to: number,
  kinds: (name: string) => MemberKind, limit = Infinity,
): LiveSpan[] {
  const parser = new Parser(state, kinds);
  const spans: LiveSpan[] = [];
  const tree = ensureSyntaxTree(state, to, 50) ?? syntaxTree(state);
  tree.iterate({
    from, to,
    enter: (ref) => {
      if (spans.length >= limit) return false;
      const name = ref.name;
      if (name === "String" || name === "LineComment" || name === "BlockComment") return false;
      if (name !== "MemberExpression" && name !== "CallExpression" && name !== "ArrowFunction") return undefined;
      // `ao` alone is too short to hold anything; skip the parse.
      if (ref.to - ref.from < 4) return undefined;
      const expr = parser.parse(ref.node);
      if (!expr || !displayable(expr)) return undefined;
      if (ref.from >= from && ref.to <= to) {
        spans.push({ from: ref.from, to: ref.to, key: liveKey(state.sliceDoc(ref.from, ref.to)), expr });
      }
      return false;
    },
  });
  return spans;
}

// --- Reading values ------------------------------------------------------------------

/** A live value: a number, or a list of numbers such as `ao.fft`. */
export type LiveValue = number | readonly number[];

type Reader = () => unknown;

/**
 * A function reading the expression's current value from `target` (the `ao`
 * object), calling only its getters and methods. A method that returns a
 * function, as `ao.map` does for Hydra, has that function called in turn, and
 * an arrow argument is passed as a function of its own compiled body, never as
 * user code. It returns NaN for anything not a number or list of numbers,
 * including when a method throws.
 */
export function compileLive(expr: LiveExpr, target: Record<string, unknown>): () => LiveValue {
  const read = compile(expr, target);
  return () => {
    try {
      let value = read();
      if (typeof value === "function") value = (value as () => unknown)();
      if (typeof value === "number") return value;
      if (Array.isArray(value) || ArrayBuffer.isView(value)) return value as unknown as readonly number[];
      return NaN;
    } catch {
      return NaN;
    }
  };
}

const num = (value: unknown): number => {
  if (typeof value === "function") value = (value as () => unknown)();
  return typeof value === "number" ? value : NaN;
};

function compile(expr: LiveExpr, target: Record<string, unknown>): Reader {
  switch (expr.type) {
    case "number": case "string": {
      const value = expr.value;
      return () => value;
    }
    case "member": {
      const name = expr.name;
      return () => target[name];
    }
    case "index": {
      const object = compile(expr.object, target), index = expr.index;
      return () => {
        const list = object();
        return Array.isArray(list) || ArrayBuffer.isView(list) ? (list as unknown as number[])[index] : NaN;
      };
    }
    case "call": {
      const name = expr.name;
      // Arrows are handed over as functions, as the sketch would; the rest as values.
      const args = expr.args.map((arg) => (arg.type === "arrow" ? liveFunction(arg, target) : compile(arg, target)));
      return () => {
        const method = target[name];
        if (typeof method !== "function") return NaN;
        return method.apply(target, args.map((arg) => arg()));
      };
    }
    case "math": {
      const fn = Math[expr.name] as (...xs: number[]) => number;
      const args = expr.args.map((arg) => compile(arg, target));
      return () => fn(...args.map((arg) => num(arg())));
    }
    case "unary": {
      const arg = compile(expr.arg, target);
      return expr.op === "-" ? () => -num(arg()) : () => num(arg());
    }
    case "binary": {
      const l = compile(expr.left, target), r = compile(expr.right, target);
      switch (expr.op) {
        case "+": return () => num(l()) + num(r());
        case "-": return () => num(l()) - num(r());
        case "*": return () => num(l()) * num(r());
        case "/": return () => num(l()) / num(r());
        case "%": return () => num(l()) % num(r());
        case "**": return () => num(l()) ** num(r());
      }
      return () => NaN;
    }
    case "arrow":
      return compile(expr.body, target);
  }
}

/** An arrow argument as the function a method expects: it returns the body's value. */
function liveFunction(expr: LiveExpr & { type: "arrow" }, target: Record<string, unknown>): Reader {
  const body = compile(expr.body, target);
  const fn = () => num(body());
  return () => fn;
}

// --- Following expressions across edits -------------------------------------------------

/** Slots by key, reused across edits; `map` follows the ones whose text changed. */
export class SlotTable<S extends { key: string; end: number; seen: number }> {
  readonly slots = new Map<string, S>();

  /** Maps every slot's end position through an edit. */
  map(changes: ChangeDesc): void {
    for (const slot of this.slots.values()) slot.end = changes.mapPos(slot.end, 1);
  }

  /**
   * The slot for an expression: the one with the same text, else one left
   * without an expression this round whose end the edit carried to the same
   * place (the expression was edited, as when scrubbing `ao.hz(40, 100)`),
   * else a new one. The caller updates a followed slot's own key.
   */
  take(key: string, end: number, now: number, used: Set<S>, make: () => S): S {
    let slot = this.slots.get(key);
    if (!slot) {
      for (const candidate of this.slots.values()) {
        if (!used.has(candidate) && candidate.end === end) {
          this.slots.delete(candidate.key);
          slot = candidate;
          break;
        }
      }
    }
    slot ??= make();
    slot.seen = now;
    slot.end = end;
    used.add(slot);
    this.slots.set(key, slot);
    return slot;
  }

  /** Drops slots unused for longer than `keepMs`. */
  prune(now: number, keepMs: number): void {
    for (const [key, slot] of this.slots) if (now - slot.seen > keepMs) this.slots.delete(key);
  }
}

// --- History and display ---------------------------------------------------------------

/** A fixed-size ring of recent samples, oldest first. */
export class SampleRing {
  private readonly data: Float64Array;
  private start = 0;
  length = 0;

  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity);
  }

  push(value: number): void {
    if (this.length < this.capacity) {
      this.data[(this.start + this.length++) % this.capacity] = value;
    } else {
      this.data[this.start] = value;
      this.start = (this.start + 1) % this.capacity;
    }
  }

  /** The `i`th sample, 0 being the oldest kept. */
  at(i: number): number {
    return this.data[(this.start + i) % this.capacity];
  }

  last(): number {
    return this.length ? this.at(this.length - 1) : NaN;
  }

  clear(): void {
    this.start = 0;
    this.length = 0;
  }

  /**
   * The range to draw the samples over: their own extent, so small movements
   * show, but never narrower than `minSpan`, so near-silence doesn't turn into
   * a wall of noise. Samples all within 0..1, which is what most of `ao`
   * reads, get a window inside 0..1.
   */
  range(minSpan = 0.2): { lo: number; hi: number } {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.length; i++) {
      const v = this.at(i);
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo > hi) return { lo: 0, hi: 1 };
    const unit = lo >= 0 && hi <= 1;
    if (hi - lo < minSpan) {
      const mid = (lo + hi) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
      if (unit && lo < 0) [lo, hi] = [0, minSpan];
      if (unit && hi > 1) [lo, hi] = [1 - minSpan, 1];
    }
    return { lo, hi };
  }
}

/**
 * A value in at most five characters, so the widget keeps its width:
 * `0.42`, `-0.42`, `12.3`, `128`, `12k`. Small positive values keep a third
 * decimal, `0.004`, as a tiny rotation speed would read zero otherwise. Not
 * a number reads `–`.
 */
export function formatLive(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const a = Math.abs(value);
  let text: string;
  if (value > 0 && value < 0.0995) text = value.toFixed(3);
  else if (a < 9.995) text = value.toFixed(2);
  else if (a < 99.95) text = value.toFixed(1);
  else if (a < 99999.5) text = a < 9999.5 ? value.toFixed(0) : `${Math.round(value / 1000)}k`;
  else text = value.toExponential(0).replace("+", "");
  // -0.00 reads as noise.
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}
