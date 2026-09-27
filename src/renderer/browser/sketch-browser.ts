/**
 * The sketch browser: a grid of thumbnail cards over the visuals (Ctrl+O, or
 * `o` with the editor hidden). Type to fuzzy-filter, move with the arrows,
 * Tab or Ctrl+H/J/K/L, Enter or a click opens. Filtering, ordering and grid
 * moves are pure, in src/shared/sketch-library.ts.
 */
import {
  fuzzyFilter, isChallengeSketch, type Move, moveSelection, placeholderHues, type SortMode, sortSketches, visibleSketches,
} from "../../shared/sketch-library";

export interface SketchBrowserHost {
  listSketches(): Promise<string[]>;
  recentSketches(): Promise<string[]>;
  thumbnail(name: string): Promise<Uint8Array | null>;
  /** The sketch on screen now. */
  current(): string;
  /** Opens (and runs) a sketch, the same way as switching sketches does. */
  open(name: string): Promise<void>;
  /** Called as the browser opens, e.g. to close another card. */
  opening?(): void;
  /** Gives the keyboard back to the editor, if it is shown. */
  focus(): void;
}

interface Card {
  el: HTMLButtonElement;
  thumb: HTMLDivElement;
  img: HTMLImageElement;
  label: HTMLSpanElement;
}

interface Cached { bytes: Uint8Array; url: string }

const SORT_KEY = "ao.browser.sort";
const CHALLENGES_KEY = "ao.browser.challenges";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const kbd = (key: string) => el("kbd", { textContent: key });
/** A per-viewer convenience; storage may be unavailable, and that's fine. */
function remembered(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* not remembered */ }
}
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export class SketchBrowser {
  private readonly root = el("section", { id: "browser", hidden: true });
  private readonly panel = el("div", { className: "browser-panel" });
  private readonly query = el("span", { className: "browser-query" });
  private readonly count = el("span", { className: "browser-count" });
  private readonly grid = el("div", { className: "browser-grid" });
  private readonly empty = el("p", { className: "browser-empty", hidden: true });
  private readonly sortButton = el("button", { type: "button", tabIndex: -1 });
  private readonly challengeButton = el("button", { type: "button", tabIndex: -1 });
  private readonly cards = new Map<string, Card>();
  private readonly cache = new Map<string, Cached>();
  /** Thumbnails already fetched since the browser opened. */
  private readonly fresh = new Set<string>();
  private readonly observer: IntersectionObserver;
  private names: string[] = [];
  private recent: string[] = [];
  private results: { name: string; indices: number[] }[] = [];
  private text = "";
  private selected = 0;
  private sort: SortMode = remembered(SORT_KEY) === "name" ? "name" : "recent";
  private showChallenges = remembered(CHALLENGES_KEY) === "1";
  private loaded = false;

  constructor(private readonly host: SketchBrowserHost) {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.observer.unobserve(entry.target);
        void this.loadThumbnail((entry.target as HTMLElement).dataset.name!);
      }
    }, { root: this.grid, rootMargin: "240px 0px" });

    const bar = (...children: (Node | string)[]) => el("div", { className: "browser-bar" }, ...children);
    for (const b of [this.sortButton, this.challengeButton]) b.addEventListener("mousedown", (e) => e.preventDefault());
    this.sortButton.addEventListener("click", () => this.toggleSort());
    this.challengeButton.addEventListener("click", () => this.toggleChallenges());
    this.panel.append(
      bar(el("h1", { textContent: "Sketches" }), el("span", { className: "browser-search" }, "/ ", this.query), this.count),
      this.grid,
      this.empty,
      bar(el("span", { className: "browser-hints" },
        "type to filter · ", kbd("←↑↓→"), " ", kbd("Ctrl+HJKL"), " move · ", kbd("Enter"), " open · ", kbd("Esc"), " close"),
      this.sortButton, this.challengeButton));
    this.root.append(this.panel);
    // A click on the dimmed backdrop, outside the panel, closes the browser.
    this.root.addEventListener("mousedown", (e) => { if (e.target === this.root) { e.preventDefault(); this.close(); } });
    document.body.append(this.root);
  }

  get isOpen(): boolean { return !this.root.hidden; }

  /** Ctrl+O and ambient `o`. */
  toggle(): void {
    if (this.isOpen) this.close();
    else void this.open();
  }

  /**
   * Shows the grid at once, from the last listing, so keys typed right after
   * Ctrl+O are already the browser's; the fresh listing follows.
   */
  async open(): Promise<void> {
    if (this.isOpen) return;
    this.host.opening?.();
    this.text = "";
    this.fresh.clear();
    this.root.hidden = false;
    this.render(this.host.current());
    const [names, recent] = await Promise.all([this.host.listSketches(), this.host.recentSketches().catch(() => [])]);
    if (!this.isOpen) return;
    this.names = names;
    this.recent = recent;
    this.loaded = true;
    for (const name of [...this.cache.keys()]) if (!names.includes(name)) this.drop(name);
    for (const name of [...this.cards.keys()]) if (!names.includes(name)) this.cards.delete(name);
    const keep = this.results[this.selected]?.name;
    this.render(this.text || keep !== undefined ? keep : this.host.current());
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.grid.replaceChildren();
    for (const card of this.cards.values()) this.observer.unobserve(card.el);
    this.host.focus();
  }

  /** A live capture replaced `name`'s thumbnail. */
  thumbnailSaved(name: string): void {
    this.fresh.delete(name);
    if (this.isOpen && this.cards.get(name)?.el.isConnected) void this.loadThumbnail(name);
  }

  /**
   * Handles browser keys, first in the app's keydown handler after challenge
   * mode. Returns true when the key was consumed. While open it swallows
   * every key but the F keys and Ctrl+Q, so nothing reaches the editor or the
   * ambient keys behind it.
   */
  onKey(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const consume = () => { e.preventDefault(); e.stopPropagation(); return true; };
    if (ctrl && !e.shiftKey && !e.altKey && key.toLowerCase() === "o") { this.toggle(); return consume(); }
    if (!this.isOpen) return false;
    if (/^F\d+$/.test(key) || (ctrl && key.toLowerCase() === "q") || e.isComposing) return false;
    const moves: Record<string, Move> = {
      ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
      Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown",
    };
    const ctrlMoves: Record<string, Move> = { h: "left", l: "right", k: "up", j: "down", p: "left", n: "right" };
    if (key === "Escape") this.close();
    else if (key === "Enter") void this.choose(this.results[this.selected]?.name);
    else if (moves[key] && !e.altKey) this.move(moves[key]);
    else if (key === "Tab") this.move(e.shiftKey ? "left" : "right");
    else if (ctrl && !e.altKey && ctrlMoves[key.toLowerCase()]) this.move(ctrlMoves[key.toLowerCase()]);
    else if (ctrl && key.toLowerCase() === "s") this.toggleSort();
    else if (ctrl && key.toLowerCase() === "a") this.toggleChallenges();
    else if (key === "Backspace") this.setText(ctrl ? "" : this.text.slice(0, -1));
    else if (ctrl && key.toLowerCase() === "u") this.setText("");
    else if (key.length === 1 && !ctrl && !e.altKey) this.setText(this.text + key);
    return consume();
  }

  private setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    // Keep the best match selected as the filter changes.
    this.render(text ? undefined : this.host.current());
  }

  private toggleSort(): void {
    const keep = this.results[this.selected]?.name;
    this.sort = this.sort === "recent" ? "name" : "recent";
    remember(SORT_KEY, this.sort);
    this.render(keep);
  }

  private toggleChallenges(): void {
    const keep = this.results[this.selected]?.name;
    this.showChallenges = !this.showChallenges;
    remember(CHALLENGES_KEY, this.showChallenges ? "1" : "0");
    this.render(keep);
  }

  private columns(): number {
    return Math.max(1, getComputedStyle(this.grid).gridTemplateColumns.split(" ").filter(Boolean).length);
  }

  private move(move: Move): void {
    const first = this.grid.firstElementChild as HTMLElement | null;
    const rows = first ? Math.max(1, Math.floor(this.grid.clientHeight / (first.offsetHeight + 14))) : 3;
    this.select(moveSelection(this.selected, this.results.length, this.columns(), move, rows));
  }

  private select(index: number): void {
    const before = this.results[this.selected] && this.cards.get(this.results[this.selected].name);
    before?.el.classList.remove("selected");
    this.selected = index;
    const card = this.results[index] && this.cards.get(this.results[index].name);
    if (!card) return;
    card.el.classList.add("selected");
    card.el.scrollIntoView({ block: "nearest" });
  }

  private async choose(name: string | undefined): Promise<void> {
    if (!name) return;
    this.close();
    if (name !== this.host.current()) await this.host.open(name);
  }

  /** Rebuilds the grid in order for the current filter, keeping card elements (and their images). */
  private render(select?: string): void {
    const current = this.host.current();
    const shown = visibleSketches(sortSketches(this.names, this.recent, this.sort), this.showChallenges, current);
    this.results = fuzzyFilter(this.text, shown);
    this.grid.replaceChildren(...this.results.map(({ name, indices }) => {
      const card = this.card(name);
      card.label.replaceChildren(...highlight(name, indices));
      card.el.classList.toggle("current", name === current);
      card.el.classList.remove("selected");
      return card.el;
    }));
    const index = select ? this.results.findIndex((r) => r.name === select) : -1;
    this.select(this.results.length ? Math.max(0, index) : -1);

    this.query.textContent = this.text;
    this.query.classList.toggle("placeholder", !this.text);
    if (!this.text) this.query.textContent = "type to filter";
    const hidden = this.showChallenges ? 0 : this.names.filter((n) => isChallengeSketch(n) && n !== current).length;
    this.count.textContent = this.text ? `${this.results.length} of ${shown.length}` : `${shown.length} sketch${shown.length === 1 ? "" : "es"}`;
    this.empty.hidden = this.results.length > 0;
    this.empty.textContent = !this.loaded ? "" : this.names.length ? `No sketch matches “${this.text}”.` : "No sketches yet: Ctrl+N makes one.";
    if (hidden && this.text && !this.results.length) this.empty.textContent += " Challenge attempts are hidden: Ctrl+A shows them.";
    this.sortButton.replaceChildren(this.sort === "recent" ? "recent first " : "a–z ", kbd("Ctrl+S"));
    this.challengeButton.replaceChildren(
      this.showChallenges ? "challenges shown " : `${hidden} challenge${hidden === 1 ? "" : "s"} hidden `, kbd("Ctrl+A"));
    this.challengeButton.classList.toggle("selected", this.showChallenges);
    this.challengeButton.hidden = !this.names.some(isChallengeSketch);
    for (const { name } of this.results) this.observer.observe(this.cards.get(name)!.el);
  }

  private card(name: string): Card {
    const existing = this.cards.get(name);
    if (existing) return existing;
    const [h1, h2] = placeholderHues(name);
    const img = el("img", { alt: "", draggable: false, decoding: "async" });
    img.addEventListener("load", () => thumb.classList.add("loaded"));
    const thumb = el("div", { className: "browser-thumb" }, el("span", { className: "browser-placeholder", textContent: name }), img);
    thumb.style.setProperty("--h1", `${h1}`);
    thumb.style.setProperty("--h2", `${h2}`);
    const label = el("span", { className: "browser-name" });
    const button = el("button", { type: "button", className: "browser-card", tabIndex: -1, title: name }, thumb, label);
    button.dataset.name = name;
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", () => void this.choose(name));
    // Real pointer movement selects; cards scrolling under a still pointer don't.
    button.addEventListener("mousemove", () => {
      const index = this.results.findIndex((r) => r.name === name);
      if (index >= 0 && index !== this.selected) this.select(index);
    });
    const card = { el: button, thumb, img, label };
    this.cards.set(name, card);
    const cached = this.cache.get(name);
    if (cached) img.src = cached.url;
    return card;
  }

  /** Shows the cached thumbnail at once, then fetches it once per opening and swaps it if it changed. */
  private async loadThumbnail(name: string): Promise<void> {
    if (this.fresh.has(name)) return;
    this.fresh.add(name);
    let bytes: Uint8Array | null = null;
    try {
      bytes = await this.host.thumbnail(name);
    } catch {
      // No thumbnail: the placeholder stays.
    }
    const card = this.cards.get(name);
    const cached = this.cache.get(name);
    if (!bytes) {
      if (cached) this.drop(name);
      card?.img.removeAttribute("src");
      card?.thumb.classList.remove("loaded");
      return;
    }
    if (cached && sameBytes(cached.bytes, bytes)) return;
    if (cached) URL.revokeObjectURL(cached.url);
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }));
    this.cache.set(name, { bytes, url });
    if (card) card.img.src = url;
  }

  private drop(name: string): void {
    const cached = this.cache.get(name);
    if (cached) URL.revokeObjectURL(cached.url);
    this.cache.delete(name);
  }
}

/** The name with matched characters in <b>. */
function highlight(name: string, indices: number[]): (Node | string)[] {
  if (!indices.length) return [name];
  const marks = new Set(indices);
  const out: (Node | string)[] = [];
  let run = "", bold = false;
  const flush = () => { if (run) out.push(bold ? el("b", { textContent: run }) : run); run = ""; };
  for (let i = 0; i < name.length; i++) {
    if (marks.has(i) !== bold) { flush(); bold = !bold; }
    run += name[i];
  }
  flush();
  return out;
}
