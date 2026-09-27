/**
 * Live values in the code: a small sparkline and number after each `ao`
 * expression, so what the meter shows is where you're writing. Ctrl+Shift+L
 * toggles them.
 *
 * Positions are found from the syntax tree (live-expressions.ts) only when the
 * document or viewport changes. Each frame one loop samples every distinct
 * expression once and redraws the widgets' canvases in place, so updates never
 * move the text. The loop stops while live values are off, the editor is
 * hidden, or there is nothing to show.
 */
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { ao } from "./audio";
import {
  aoMemberKinds, compileLive, findLiveExpressions, formatLive, type LiveSpan, type LiveValue, SampleRing, SlotTable,
} from "./live-expressions";

/** At most this many widgets, all within the visible lines. */
export const MAX_WIDGETS = 40;
const SAMPLE_HZ = 30;
const HISTORY_SECONDS = 2.5;
/** An expression edited away keeps its history this long, in case it comes back (an undo, a typo fixed). */
const KEEP_MS = 10_000;
// Widget layout in CSS pixels; the number sits beside the sparkline.
const SPARK_W = 40, SPARK_H = 12;

// --- On/off ----------------------------------------------------------------------------

/** Turns live values on or off. */
export const setLive = StateEffect.define<boolean>();

/** Whether live values are showing. It survives `documentState` when a sketch opens. */
export const liveValuesOn = StateField.define<boolean>({
  create: () => true,
  update: (on, tr) => tr.effects.reduce((value, e) => (e.is(setLive) ? e.value : value), on),
});

export function setLiveValues(view: EditorView, on: boolean): void {
  if (view.state.field(liveValuesOn, false) !== on) view.dispatch({ effects: setLive.of(on) });
}

/** Toggles live values and returns whether they now show. */
export function toggleLiveValues(view: EditorView): boolean {
  const on = !view.state.field(liveValuesOn, false);
  setLiveValues(view, on);
  return on;
}

/** The field's current value, to carry into a new document's state. */
export function keepLiveValues(state: EditorState): Extension {
  const on = state.field(liveValuesOn, false) ?? true;
  return liveValuesOn.init(() => on);
}

// --- Slots and widgets ---------------------------------------------------------------------

/** One distinct expression: its reader, its history, and the widgets showing it. */
class Slot {
  readonly history = new SampleRing(Math.round(SAMPLE_HZ * HISTORY_SECONDS));
  readonly widgets = new Set<HTMLElement>();
  read: () => LiveValue;
  value: LiveValue = NaN;
  seen = 0;
  /** Where the expression ended, mapped through edits, to follow it when its text changes. */
  end = 0;

  constructor(public key: string, span: LiveSpan) {
    this.read = compileLive(span.expr, ao as unknown as Record<string, unknown>);
    this.end = span.to;
  }

  update(span: LiveSpan): void {
    if (span.key !== this.key) {
      this.key = span.key;
      this.read = compileLive(span.expr, ao as unknown as Record<string, unknown>);
    }
    this.end = span.to;
  }
}

interface WidgetParts { slot: Slot; canvas: HTMLCanvasElement; label: HTMLElement; list: boolean; drawn: string }
const parts = new WeakMap<HTMLElement, WidgetParts>();

class LiveWidget extends WidgetType {
  constructor(readonly slot: Slot, readonly list: boolean) { super(); }

  eq(other: LiveWidget): boolean {
    return other.slot === this.slot && other.list === this.list;
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "cm-live";
    dom.setAttribute("aria-hidden", "true");
    const canvas = document.createElement("canvas");
    const label = document.createElement("span");
    label.className = "cm-live-value";
    dom.append(canvas, label);
    dom.addEventListener("mouseenter", () => {
      const p = parts.get(dom);
      if (p) dom.title = `${p.slot.key} = ${describe(p.slot.value)}`;
    });
    this.bind(dom, canvas, label);
    return dom;
  }

  /** Reuse the element for another slot: an edited expression keeps its place and size. */
  updateDOM(dom: HTMLElement): boolean {
    const p = parts.get(dom);
    if (!p || p.list !== this.list) return false;
    p.slot.widgets.delete(dom);
    this.bind(dom, p.canvas, p.label);
    return true;
  }

  private bind(dom: HTMLElement, canvas: HTMLCanvasElement, label: HTMLElement): void {
    dom.classList.toggle("cm-live-list", this.list);
    parts.set(dom, { slot: this.slot, canvas, label, list: this.list, drawn: "" });
    this.slot.widgets.add(dom);
    sizeCanvas(canvas, this.list);
    draw(dom);
  }

  destroy(dom: HTMLElement): void {
    parts.get(dom)?.slot.widgets.delete(dom);
  }

  // Clicks fall through to the editor, which places the cursor beside the widget.
  ignoreEvent(): boolean { return false; }
}

function describe(value: LiveValue): string {
  if (typeof value === "number") return String(value);
  return `[${Array.from(value, (v) => v.toFixed(3)).join(", ")}]`;
}

function sizeCanvas(canvas: HTMLCanvasElement, list: boolean): void {
  const dpr = devicePixelRatio || 1;
  const w = list ? SPARK_W * 2 : SPARK_W;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${SPARK_H}px`;
  const pw = Math.round(w * dpr), ph = Math.round(SPARK_H * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
}

let accent = "";
function draw(dom: HTMLElement): void {
  const p = parts.get(dom);
  if (!p) return;
  const { slot, canvas, label } = p;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (!accent) accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#8fd8ff";
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  const value = slot.value;
  if (typeof value !== "number") {
    // A list, such as ao.fft: a tiny spectrum.
    const n = value.length || 1, band = w / n;
    for (let i = 0; i < value.length; i++) {
      const bar = h * clamp01(value[i]);
      ctx.fillRect(i * band, h - bar, Math.max(1, band - 0.5), bar);
    }
    return;
  }
  const text = formatLive(value);
  if (text !== p.drawn) {
    label.textContent = text;
    p.drawn = text;
  }
  const history = slot.history, count = history.length;
  if (!count) return;
  const { lo, hi } = history.range();
  const pad = 1.5 * (devicePixelRatio || 1);
  const y = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - 2 * pad);
  const step = w / (history.capacity - 1);
  // Newest sample at the right edge; a short history grows in from the right.
  const x0 = w - (count - 1) * step;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.moveTo(x0, h);
  for (let i = 0; i < count; i++) ctx.lineTo(x0 + i * step, y(finite(history.at(i), lo)));
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = devicePixelRatio || 1;
  ctx.beginPath();
  for (let i = 0; i < count; i++) ctx.lineTo(x0 + i * step, y(finite(history.at(i), lo)));
  ctx.stroke();
}

const clamp01 = (x: number) => (x > 1 ? 1 : x > 0 ? x : 0);
const finite = (x: number, fallback: number) => (Number.isFinite(x) ? x : fallback);

// --- The plugin ---------------------------------------------------------------------------------

class LiveValuesPlugin {
  decorations: DecorationSet = Decoration.none;
  private readonly table = new SlotTable<Slot>();
  private active: Slot[] = [];
  private frame = 0;
  private lastSample = 0;
  private sampled: unknown;
  private visible = true;
  private readonly observer: IntersectionObserver | undefined;

  constructor(private readonly view: EditorView) {
    // The editor is display: none in ambient mode; the loop then sleeps.
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting);
        this.schedule();
      });
      this.observer.observe(view.scrollDOM);
    }
    this.rebuild();
  }

  update(u: ViewUpdate): void {
    const toggled = u.startState.field(liveValuesOn, false) !== u.state.field(liveValuesOn, false);
    if (u.docChanged) this.table.map(u.changes);
    if (u.docChanged || u.viewportChanged || toggled) this.rebuild();
  }

  private rebuild(): void {
    const { view } = this;
    if (!view.state.field(liveValuesOn, false)) {
      this.decorations = Decoration.none;
      this.active = [];
      this.schedule();
      return;
    }
    const now = performance.now();
    const kinds = aoMemberKinds(ao);
    const used = new Set<Slot>();
    const widgets = [];
    for (const { from, to } of view.visibleRanges) {
      for (const span of findLiveExpressions(view.state, from, to, kinds, MAX_WIDGETS - widgets.length)) {
        const slot = this.table.take(span.key, span.to, now, used, () => new Slot(span.key, span));
        slot.update(span);
        slot.value = slot.read();
        const list = typeof slot.value !== "number";
        widgets.push(Decoration.widget({ widget: new LiveWidget(slot, list), side: 1 }).range(span.to));
      }
    }
    this.table.prune(now, KEEP_MS);
    this.active = [...used];
    this.decorations = Decoration.set(widgets, true);
    this.schedule();
  }

  private running(): boolean {
    return this.active.length > 0 && this.visible;
  }

  private schedule(): void {
    if (this.running()) {
      if (!this.frame) this.frame = requestAnimationFrame(this.tick);
    } else if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  private readonly tick = (now: number) => {
    this.frame = 0;
    if (!this.running()) return;
    this.frame = requestAnimationFrame(this.tick);
    // Sample at most SAMPLE_HZ, and only when new audio has arrived.
    if (now - this.lastSample < 1000 / SAMPLE_HZ - 2 || ao.features === this.sampled) return;
    this.lastSample = now;
    this.sampled = ao.features;
    for (const slot of this.active) {
      slot.value = slot.read();
      if (typeof slot.value === "number") slot.history.push(slot.value);
      for (const dom of slot.widgets) draw(dom);
    }
  };

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
  }
}

/** The live values extension: the on/off field and the widgets. */
export function liveValues(): Extension {
  return [liveValuesOn, ViewPlugin.fromClass(LiveValuesPlugin, { decorations: (p) => p.decorations })];
}
