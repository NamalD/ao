/**
 * Challenge mode: a card that draws a prompt, a time-boxed sketch to answer
 * it, a countdown in the status bar, and a snapshot plus record at the end.
 * The drawing, naming and record logic is pure, in src/shared/challenges.ts.
 */
import {
  type ChallengeItem, type ChallengeRecord, type ChallengeResult, challengeHeader, challengeResult,
  challengeSketchName, DEFAULT_TIME_BOX, formatRemaining, generateChallenge, TIME_BOXES,
} from "../../shared/challenges";

export interface ChallengeHost {
  listSketches(): Promise<string[]>;
  writeSketch(name: string, code: string): Promise<void>;
  /** Opens (and runs) a sketch, saving the current one first. */
  open(name: string): Promise<void>;
  /** Saves the editor's sketch if it has unsaved edits. */
  save(): Promise<void>;
  /** Captures the visuals and appends the record, in the main process. */
  finishChallenge(result: ChallengeResult): Promise<ChallengeRecord>;
  notify(message: string, error?: boolean): void;
  /** Gives the keyboard back to the editor, if it is shown. */
  focus(): void;
}

interface Running {
  items: ChallengeItem[];
  sketch: string;
  minutes: number;
  startedAt: Date;
  endsAt: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const kbd = (key: string) => el("kbd", { textContent: key });
/** A card button that doesn't take focus, so keys keep flowing to the app's handler. */
function cardButton(className: string, action: () => void, ...children: (Node | string)[]): HTMLButtonElement {
  const b = el("button", { type: "button", className, tabIndex: -1 }, ...children);
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", action);
  return b;
}
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export class ChallengeMode {
  private readonly card = el("section", { id: "challenge", hidden: true });
  private readonly countdown = el("span", { id: "challenge-countdown", hidden: true });
  private draw: ChallengeItem[] = [];
  private minutes: number = DEFAULT_TIME_BOX;
  private hints = false;
  private running: Running | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  constructor(private readonly host: ChallengeHost, private readonly rng: () => number = Math.random) {
    document.body.append(this.card);
    const fps = document.getElementById("fps");
    if (fps) fps.before(this.countdown);
    else document.getElementById("bar")?.append(this.countdown);
    this.countdown.addEventListener("click", () => this.toggle());
  }

  get isOpen(): boolean { return !this.card.hidden; }
  get isRunning(): boolean { return this.running !== null; }

  /** Ctrl+Shift+C and ambient `c`: opens the card (a fresh draw, or the running challenge), or closes it. */
  toggle(): void {
    if (this.isOpen) return this.close();
    if (!this.running) {
      this.draw = generateChallenge(this.rng);
      this.hints = false;
    }
    this.render();
    this.card.hidden = false;
  }

  /**
   * Handles challenge keys, first thing in the app's keydown handler. Returns
   * true when the key was consumed; while the card is open it also swallows
   * other plain keys so they don't reach the editor behind it.
   */
  onKey(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    const consume = () => { e.preventDefault(); e.stopPropagation(); return true; };
    if (ctrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") { this.toggle(); return consume(); }
    if (!this.isOpen || ctrl || e.altKey || /^F\d+$/.test(e.key)) return false;
    const key = e.key.toLowerCase();
    if (key === "escape") this.close();
    else if (key === "h") this.toggleHints();
    else if (this.running) {
      if (key === "enter" || key === "f") void this.finish(true);
    } else if (key === "enter") void this.start();
    else if (key === "r") this.reroll();
    else if (key === "1" || key === "2" || key === "3") this.setMinutes(TIME_BOXES[Number(key) - 1]);
    else if (key === "arrowleft" || key === "arrowright") {
      const i = TIME_BOXES.indexOf(this.minutes as (typeof TIME_BOXES)[number]);
      this.setMinutes(TIME_BOXES[Math.max(0, Math.min(TIME_BOXES.length - 1, i + (key === "arrowleft" ? -1 : 1)))]);
    }
    return consume();
  }

  close(): void {
    this.card.hidden = true;
    this.host.focus();
  }

  private reroll(): void {
    this.draw = generateChallenge(this.rng);
    this.hints = false;
    this.render();
  }

  private toggleHints(): void {
    this.hints = !this.hints;
    this.render();
  }

  private setMinutes(minutes: number): void {
    this.minutes = minutes;
    this.render();
  }

  async start(): Promise<void> {
    if (this.running || this.busy || !this.draw.length) return;
    this.busy = true;
    try {
      const now = new Date();
      const sketch = challengeSketchName(this.draw, now, await this.host.listSketches());
      await this.host.writeSketch(sketch, challengeHeader(this.draw, this.minutes, now));
      this.running = { items: this.draw, sketch, minutes: this.minutes, startedAt: now, endsAt: now.getTime() + this.minutes * 60_000 };
      this.close();
      await this.host.open(sketch);
      this.timer = setInterval(() => this.tick(), 250);
      this.tick();
      this.host.notify(`Challenge started: ${this.minutes} min. Ctrl+Shift+C to finish early.`);
    } catch (error) {
      this.host.notify(`Challenge failed to start: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      this.busy = false;
    }
  }

  private tick(): void {
    if (!this.running) return;
    const left = this.running.endsAt - Date.now();
    this.countdown.textContent = `challenge ${formatRemaining(left)}`;
    this.countdown.title = this.running.items.map((i) => i.text).join(" + ");
    this.countdown.hidden = false;
    if (this.isOpen) this.card.querySelector(".challenge-left")!.textContent = formatRemaining(left);
    if (left <= 0) void this.finish(false);
  }

  /** Ends the running challenge: saves the sketch, snapshots the visuals, records it. */
  async finish(early: boolean): Promise<void> {
    const run = this.running;
    if (!run || this.busy) return;
    this.busy = true;
    clearInterval(this.timer);
    this.running = null;
    this.countdown.hidden = true;
    this.card.hidden = true;
    try {
      await this.host.save();
      const result = challengeResult(run.items, run.sketch, run.minutes, run.startedAt, new Date(), early);
      // Snapshot the visuals alone: hide the editor, bar and cards for a couple of frames.
      document.body.classList.add("challenge-capture");
      await nextFrame();
      await nextFrame();
      let record: ChallengeRecord;
      try {
        record = await this.host.finishChallenge(result);
      } finally {
        document.body.classList.remove("challenge-capture");
      }
      this.host.notify(record.snapshot
        ? `Challenge saved: ${record.snapshot}`
        : "Challenge recorded, but the snapshot failed (see ao.log)", !record.snapshot);
    } catch (error) {
      this.host.notify(`Challenge save failed: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      this.busy = false;
      this.host.focus();
    }
  }

  private render(): void {
    const run = this.running;
    const items = run ? run.items : this.draw;
    const hasHints = items.some((i) => i.hint);
    const list = el("ol", { className: "challenge-items" }, ...items.map((item) => el("li", {},
      el("span", { className: "challenge-bucket", textContent: item.bucket }),
      el("span", { className: "challenge-text", textContent: item.text }),
      ...(this.hints && item.hint ? [el("span", { className: "challenge-hint", textContent: item.hint })] : []))));
    const button = (label: string, key: string, action: () => void, className = "") =>
      cardButton(className, action, `${label} `, kbd(key));
    const hintButton = hasHints ? [button(this.hints ? "Hide hints" : "Hints", "H", () => this.toggleHints())] : [];

    if (run) {
      this.card.replaceChildren(
        el("h1", {}, "Challenge ", el("span", { className: "challenge-left", textContent: formatRemaining(run.endsAt - Date.now()) }), " left"),
        list,
        el("p", { className: "challenge-sketch", textContent: run.sketch }),
        el("div", { className: "challenge-actions" },
          button("Finish", "Enter", () => void this.finish(true), "primary"),
          ...hintButton,
          button("Keep going", "Esc", () => this.close())));
      return;
    }
    const times = el("div", { className: "challenge-times" }, "Time ",
      ...TIME_BOXES.map((m) => cardButton(m === this.minutes ? "selected" : "", () => this.setMinutes(m), `${m}`)),
      " min ", kbd("1"), "/", kbd("2"), "/", kbd("3"));
    this.card.replaceChildren(
      el("h1", { textContent: items.length > 1 ? `Challenge: ${items.length} parts` : "Challenge" }),
      list,
      times,
      el("div", { className: "challenge-actions" },
        button("Start", "Enter", () => void this.start(), "primary"),
        button("Re-roll", "R", () => this.reroll()),
        ...hintButton,
        button("Dismiss", "Esc", () => this.close())));
  }
}
