/**
 * The code explorer (F2, or K on a word in the editor): a panel on the left
 * listing `ao`, Hydra's functions and globals, source methods and recipes,
 * each with its docs and an example that plays on the visuals as you browse.
 * Closing it puts your sketch back; `i` inserts the example into it.
 */
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { highlightCode } from "@lezer/highlight";
import { ao } from "../audio";
import { highlight } from "../editor";
import { buildEntries, type Entry, filterEntries, findEntry, sections, wordAt } from "./entries";

export interface ExplorerHost {
  /** Run an example on the visuals, replacing whatever is showing. */
  play(code: string): void;
  /** Put the sketch's visuals back after examples have played. */
  restore(): void;
  /** Insert an example into the sketch as a new block and run the sketch. */
  insert(code: string): void;
  /** Called when the panel closes, to give the keyboard back. */
  closed(): void;
}

const AUTOPLAY_DELAY = 150;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const kbd = (key: string) => el("kbd", { textContent: key });

/** Text with `code` spans. */
function inline(text: string): (Node | string)[] {
  return text.split(/(`[^`]+`)/).map((part) => part.startsWith("`") && part.endsWith("`") ? el("code", { textContent: part.slice(1, -1) }) : part);
}

/** Paragraphs, with "- " lines as a list. */
function prose(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n");
    const items = lines.filter((line) => line.startsWith("- "));
    const intro = lines.filter((line) => !line.startsWith("- ")).join(" ");
    if (intro) out.push(el("p", {}, ...inline(intro)));
    if (items.length) out.push(el("ul", {}, ...items.map((item) => el("li", {}, ...inline(item.slice(2))))));
  }
  return out;
}

/** An example, coloured like the editor. */
function highlighted(code: string): HTMLElement {
  const pre = el("pre", { className: "explorer-code" });
  highlightCode(code, javascriptLanguage.parser.parse(code), highlight,
    (text, classes) => pre.append(classes ? el("span", { className: classes, textContent: text }) : text),
    () => pre.append("\n"));
  return pre;
}

/** A button that doesn't take focus, so keys keep flowing to the explorer. */
function button(action: () => void, ...children: (Node | string)[]): HTMLButtonElement {
  const b = el("button", { type: "button", tabIndex: -1 }, ...children);
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", action);
  return b;
}

export class CodeExplorer {
  private readonly entries = buildEntries();
  private readonly panel = el("section", { id: "explorer", hidden: true });
  private readonly search = document.createElement("input");
  private readonly list = el("nav", { className: "explorer-list" });
  private readonly detail = el("article", { className: "explorer-detail" });
  private readonly items = new Map<string, HTMLElement>();
  private matches: Entry[] = this.entries;
  private selected: Entry = this.entries[0];
  private played = false;
  private autoplayTimer: ReturnType<typeof setTimeout> | undefined;
  private live: { update(): void } | null = null;
  private frame = 0;

  constructor(private readonly host: ExplorerHost) {
    const hints = el("footer", { className: "explorer-hints" },
      kbd("j"), "/", kbd("k"), " move  ", kbd("Tab"), " section  ", kbd("/"), " search  ",
      kbd("Enter"), " play  ", kbd("i"), " insert  ", kbd("Esc"), " close");
    Object.assign(this.search, { className: "explorer-search", placeholder: "/ search", spellcheck: false });
    const body = document.createElement("div");
    body.className = "explorer-body";
    body.append(this.list, this.detail);
    this.panel.append(this.search, body, hints);
    document.body.append(this.panel);
    this.search.addEventListener("input", () => this.filter(this.search.value));
    this.renderList();
  }

  get open(): boolean { return !this.panel.hidden; }

  /** Opens on the last entry shown, or with a search. */
  show(query?: string): void {
    if (query !== undefined) {
      this.search.value = query;
      this.filter(query);
    }
    if (this.open) return;
    this.panel.hidden = false;
    document.body.classList.add("exploring");
    this.select(this.selected);
    const tick = () => { this.live?.update(); this.frame = requestAnimationFrame(tick); };
    this.frame = requestAnimationFrame(tick);
  }

  /** K on a word: opens its entry, or searches for it. */
  lookUp(line: string, column: number): void {
    const word = wordAt(line, column);
    const entry = word && findEntry(this.entries, word);
    if (entry) {
      this.search.value = "";
      this.filter("");
      this.selected = entry;
      if (this.open) this.select(entry);
      else this.show();
    } else {
      this.show(word?.name ?? "");
    }
  }

  close(): void {
    if (!this.open) return;
    this.panel.hidden = true;
    document.body.classList.remove("exploring");
    this.search.blur();
    clearTimeout(this.autoplayTimer);
    cancelAnimationFrame(this.frame);
    if (this.played) this.host.restore();
    this.played = false;
    this.host.closed();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  /** Handles a key while the explorer is open; true if it was the explorer's. */
  onKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    // App-wide shortcuts (fullscreen, recording, quit, …) still work.
    if ((ctrl && e.key !== "Enter") || e.altKey || (/^F\d+$/.test(e.key) && e.key !== "F2")) return false;
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === "F2") { take(); this.close(); return true; }
    if (document.activeElement === this.search) {
      if (e.key === "Escape" || e.key === "Enter") { take(); this.search.blur(); }
      else if (e.key === "ArrowDown") { take(); this.move(1); }
      else if (e.key === "ArrowUp") { take(); this.move(-1); }
      // Anything else types into the search box, but no further.
      else e.stopPropagation();
      return true;
    }
    take();
    switch (e.key) {
      case "Escape": this.close(); break;
      case "j": case "ArrowDown": this.move(1); break;
      case "k": case "ArrowUp": this.move(-1); break;
      case "g": case "Home": this.selectAt(0); break;
      case "G": case "End": this.selectAt(this.matches.length - 1); break;
      case "Tab": this.jumpSection(e.shiftKey ? -1 : 1); break;
      case "/": this.search.focus(); this.search.select(); break;
      case "Enter": this.play(); break;
      case "i": this.insert(); break;
    }
    return true;
  }

  private filter(query: string): void {
    const { matches, best } = filterEntries(this.entries, query);
    this.matches = matches;
    this.renderList();
    if (best && (!matches.includes(this.selected) || query.trim())) this.select(best);
    else if (!best) this.renderDetail(null);
    else this.highlightSelected();
  }

  private renderList(): void {
    this.items.clear();
    const children: HTMLElement[] = [];
    for (const section of sections) {
      const entries = this.matches.filter((e) => e.section === section.id);
      if (!entries.length) continue;
      children.push(el("h2", { textContent: section.title }));
      for (const entry of entries) {
        const item = el("a", { textContent: entry.name, className: entry.autoplay ? "" : "manual" });
        item.addEventListener("click", () => this.select(entry));
        this.items.set(entry.id, item);
        children.push(item);
      }
    }
    if (!children.length) children.push(el("p", { className: "explorer-empty", textContent: "No matches" }));
    this.list.replaceChildren(...children);
    this.highlightSelected();
  }

  private highlightSelected(): void {
    for (const [id, item] of this.items) item.classList.toggle("selected", id === this.selected.id);
    this.items.get(this.selected.id)?.scrollIntoView({ block: "nearest" });
  }

  private move(offset: number): void {
    const index = this.matches.indexOf(this.selected);
    this.selectAt(index < 0 ? 0 : Math.max(0, Math.min(this.matches.length - 1, index + offset)));
  }

  private selectAt(index: number): void {
    const entry = this.matches[index];
    if (entry) this.select(entry);
  }

  private jumpSection(direction: 1 | -1): void {
    const present = sections.filter((s) => this.matches.some((e) => e.section === s.id));
    const at = present.findIndex((s) => s.id === this.selected.section);
    const next = present[(at + direction + present.length) % present.length];
    const entry = next && this.matches.find((e) => e.section === next.id);
    if (entry) this.select(entry);
  }

  private select(entry: Entry): void {
    this.selected = entry;
    this.highlightSelected();
    this.renderDetail(entry);
    clearTimeout(this.autoplayTimer);
    // A short delay, so holding j doesn't run every example on the way.
    if (entry.autoplay) this.autoplayTimer = setTimeout(() => this.play(), AUTOPLAY_DELAY);
  }

  private play(): void {
    clearTimeout(this.autoplayTimer);
    if (!this.open || !this.selected.example) return;
    this.played = true;
    this.host.play(this.selected.example);
  }

  private insert(): void {
    const { example } = this.selected;
    if (!example) return;
    // Inserting runs the whole sketch, so there's nothing left to restore.
    this.played = false;
    this.host.insert(example);
    this.close();
  }

  private renderDetail(entry: Entry | null): void {
    this.live = null;
    if (!entry) {
      this.detail.replaceChildren();
      return;
    }
    const children: HTMLElement[] = [el("h1", { textContent: entry.name })];
    if (entry.signature && entry.signature !== entry.name) children.push(el("div", { className: "explorer-signature", textContent: entry.signature }));
    if (entry.live) children.push(this.liveValue(entry.live));
    children.push(...prose(entry.description));
    const params = entry.params.filter((p) => p.description);
    if (params.length) {
      children.push(el("dl", {}, ...params.flatMap((p) => [
        el("dt", { textContent: p.default == null ? p.name : `${p.name} = ${p.default}` }),
        el("dd", { textContent: p.description! }),
      ])));
    }
    if (entry.example) {
      children.push(el("h3", { textContent: entry.autoplay ? "Example, playing" : "Example: Enter to run" }));
      children.push(highlighted(entry.example));
      children.push(el("div", { className: "explorer-actions" },
        button(() => this.play(), kbd("Enter"), " play"),
        button(() => this.insert(), kbd("i"), " insert into sketch")));
    }
    this.detail.replaceChildren(...children);
    this.detail.scrollTop = 0;
  }

  /** A live reading of an `ao` property: a bar and its value, or a bar per value for arrays such as ao.fft. */
  private liveValue(name: string): HTMLElement {
    const read = () => (ao as unknown as Record<string, number | ArrayLike<number>>)[name];
    const box = el("div", { className: "explorer-live" });
    const first = read();
    if (typeof first !== "number") {
      // ao.wave has 512 samples; every eighth is plenty for a glance.
      const step = Math.ceil(first.length / 64);
      const bars = Array.from({ length: Math.ceil(first.length / step) }, () => el("i"));
      box.classList.add("spectrum");
      box.append(...bars);
      this.live = {
        update: () => {
          const values = read() as ArrayLike<number>;
          bars.forEach((bar, i) => { bar.style.height = `${Math.round(Math.min(1, Math.abs(values[i * step] ?? 0)) * 100)}%`; });
        },
      };
    } else {
      const fill = el("i"), value = el("span");
      box.append(el("b", {}, fill), value);
      this.live = {
        update: () => {
          const v = read() as number;
          fill.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
          value.textContent = v.toFixed(2);
        },
      };
    }
    this.live.update();
    return box;
  }
}
