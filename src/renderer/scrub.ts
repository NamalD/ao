/**
 * Scrubbable numbers: Alt+scroll or Alt+drag over a numeric literal, or
 * Alt+Up/Down at the cursor, nudges it and re-runs the surrounding code.
 * Shift makes each step ten times coarser. A whole gesture undoes as one step.
 */
import { isolateHistory } from "@codemirror/commands";
import { Annotation, type EditorState, Prec, type Text, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { literalAt, nudgeLiteral, type NumberSpan, runRangeAt, separated } from "./numbers";

/** Marks scrub transactions after a gesture's first: they join its history event. */
const scrubContinues = Annotation.define<boolean>();

/** For history's joinToEvent: continue the current gesture's undo step. */
export function joinsScrub(tr: Transaction): boolean {
  return tr.annotation(scrubContinues) === true;
}

/** Steps per unit of input: Shift is ten times coarser, so integers stay integers. */
export const stepMultiplier = (coarse: boolean) => (coarse ? 10 : 1);

/**
 * One scroll or drag on one literal. It turns a running total of steps into
 * transactions that replace the literal, and groups them into one undo event:
 * the first isolates itself from earlier edits, the rest join it (see
 * joinsScrub) under the gesture's start time, and `end` closes the event.
 */
export class ScrubGesture {
  /** Total steps moved from the literal's original value. */
  steps = 0;
  private to: number;
  private started = false;
  private doc: Text;
  private readonly before: string;

  constructor(state: EditorState, readonly span: NumberSpan, private readonly time = Date.now()) {
    this.to = span.to;
    this.doc = state.doc;
    this.before = state.sliceDoc(span.from - 1, span.from);
  }

  get from(): number { return this.span.from; }

  /** Whether the document is still as this gesture left it; any other edit ends the gesture. */
  current(state: EditorState): boolean {
    return state.doc === this.doc;
  }

  /** Moves the literal by `steps` more steps. Returns null when nothing changes. */
  move(state: EditorState, steps: number): TransactionSpec | null {
    if (!steps || !this.current(state)) return null;
    const text = nudgeLiteral(this.span.text, this.steps + steps);
    if (text === null) return null;
    this.steps += steps;
    const insert = separated(this.before, text);
    if (insert === state.sliceDoc(this.from, this.to)) return null;
    const spec: TransactionSpec = {
      changes: { from: this.from, to: this.to, insert },
      annotations: this.started
        ? [scrubContinues.of(true), Transaction.time.of(this.time)]
        : [isolateHistory.of("before"), Transaction.time.of(this.time)],
    };
    this.started = true;
    this.to = this.from + insert.length;
    return spec;
  }

  /** Records the state after dispatching `move`'s transaction. */
  applied(state: EditorState): void {
    this.doc = state.doc;
  }

  /** Closes the undo event, so the next edit starts a new one. */
  end(): TransactionSpec | null {
    return this.started ? { annotations: isolateHistory.of("after") } : null;
  }
}

/** Calls `fn` at most once per `ms`, always delivering the latest call. */
function throttle(fn: () => void, ms: number): () => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    const wait = last + ms - performance.now();
    if (wait <= 0) {
      clearTimeout(timer);
      timer = undefined;
      last = performance.now();
      fn();
    } else if (!timer) {
      timer = setTimeout(() => { timer = undefined; last = performance.now(); fn(); }, wait);
    }
  };
}

const WHEEL_NOTCH = 40; // pixels of touchpad travel per step
const DRAG_STEP = 6; // pixels of horizontal drag per step
const WHEEL_IDLE = 400; // a scroll gesture ends after this long without wheel events

/**
 * The scrub interaction. `run` receives the code to re-run, throttled so a
 * fast drag re-evaluates at most every 60 ms and always ends on the final value.
 */
export function scrubbing(run: (code: string) => void): ReturnType<typeof Prec.highest> {
  let gesture: ScrubGesture | null = null;
  let view: EditorView | null = null;
  let wheelTotal = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  let keyboardGesture = false;

  const rerun = throttle(() => {
    if (!view || !gesture) return;
    const range = runRangeAt(view.state, gesture.from);
    if (range) run(view.state.sliceDoc(range.from, range.to));
  }, 60);

  const begin = (target: EditorView, x: number, y: number): boolean => {
    finish();
    const pos = target.posAtCoords({ x, y });
    const span = pos === null ? null : literalAt(target.state, pos);
    if (!span) return false;
    view = target;
    gesture = new ScrubGesture(target.state, span);
    target.dom.classList.add("cm-scrubbing");
    return true;
  };

  const beginAtCursor = (target: EditorView): boolean => {
    finish();
    const span = literalAt(target.state, target.state.selection.main.head);
    if (!span) return false;
    view = target;
    gesture = new ScrubGesture(target.state, span);
    keyboardGesture = true;
    target.dom.classList.add("cm-scrubbing");
    return true;
  };

  const move = (steps: number) => {
    if (!view || !gesture) return;
    const spec = gesture.move(view.state, steps);
    if (!spec) return;
    view.dispatch(spec);
    gesture.applied(view.state);
    rerun();
  };

  function finish() {
    clearTimeout(wheelTimer);
    keyboardGesture = false;
    wheelTotal = 0;
    if (view && gesture) {
      const spec = gesture.end();
      if (spec) view.dispatch(spec);
      view.dom.classList.remove("cm-scrubbing");
    }
    gesture = null;
    view = null;
  }

  const onDragMove = (e: MouseEvent) => {
    e.preventDefault();
    drag.remainder += e.movementX;
    const steps = Math.trunc(drag.remainder / DRAG_STEP);
    if (!steps) return;
    drag.remainder -= steps * DRAG_STEP;
    move(steps * stepMultiplier(e.shiftKey));
  };
  const onDragEnd = () => {
    removeEventListener("mousemove", onDragMove, true);
    removeEventListener("mouseup", onDragEnd, true);
    finish();
  };
  const drag = { remainder: 0 };

  return Prec.highest(EditorView.domEventHandlers({
    keydown(e, target) {
      const arrow = e.key === "ArrowUp" || e.key === "ArrowDown";
      if (!arrow || !e.altKey || e.ctrlKey || e.metaKey) {
        if (keyboardGesture) finish();
        return false;
      }
      if (!keyboardGesture || !gesture?.current(target.state) || view !== target) {
        if (!beginAtCursor(target)) return false;
      }
      e.preventDefault();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(finish, WHEEL_IDLE);
      move((e.key === "ArrowUp" ? 1 : -1) * stepMultiplier(e.shiftKey));
      return true;
    },
    wheel(e, target) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return false;
      // Keep scrubbing the same literal while the wheel keeps turning.
      const same = gesture && view === target && gesture.current(target.state);
      if (!same && !begin(target, e.clientX, e.clientY)) return false;
      e.preventDefault();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(finish, WHEEL_IDLE);
      // Shift+wheel scrolls horizontally in Chromium, so read both axes.
      const delta = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      // A mouse wheel's notch is one step whatever its size; touchpads'
      // small deltas add up to a step. Scrolling up raises the value.
      wheelTotal = Math.abs(delta) >= WHEEL_NOTCH ? -Math.sign(delta) * WHEEL_NOTCH : wheelTotal - delta;
      const notches = Math.trunc(wheelTotal / WHEEL_NOTCH);
      if (notches) {
        wheelTotal -= notches * WHEEL_NOTCH;
        move(notches * stepMultiplier(e.shiftKey));
      }
      return true;
    },
    mousedown(e, target) {
      if (keyboardGesture) finish();
      if (!e.altKey || e.button !== 0 || e.ctrlKey || e.metaKey) return false;
      if (!begin(target, e.clientX, e.clientY)) return false;
      // Claim the press: no selection, no vim visual mode, no text drag.
      e.preventDefault();
      drag.remainder = 0;
      addEventListener("mousemove", onDragMove, true);
      addEventListener("mouseup", onDragEnd, true);
      return true;
    },
  }));
}
