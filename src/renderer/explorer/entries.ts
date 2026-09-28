/**
 * The code explorer's model: every entry with its docs and example, search,
 * and looking up the word under the cursor. Pure, so it's testable; the
 * panel itself is in explorer.ts.
 */
import hydraFunctions from "hydra-synth/src/glsl/glsl-functions.js";
import { functionDoc, publicAoMembers, type Receiver, sourceMembers } from "../editor";
import { extensionApi, extensionDocs, extensionGroups } from "../extension-api";
import { CATALOG } from "../extensions";
import { aoExamples, type Example, extensionExamples, globalEntries, hydraExamples, recipes, sourceExamples, synonyms } from "./content";

/** Built-in sections, and one or more per vendored extension (`ext:noise`, `ext:arithmetics-maths`, …). */
export type SectionId = "ao" | "src" | "coord" | "color" | "combine" | "combineCoord" | "globals" | "sources" | "recipes" | `ext:${string}`;

export const sections: { id: SectionId; title: string }[] = [
  { id: "ao", title: "ao audio" },
  { id: "src", title: "Hydra sources" },
  { id: "coord", title: "Geometry" },
  { id: "color", title: "Colour" },
  { id: "combine", title: "Blend" },
  { id: "combineCoord", title: "Modulate" },
  { id: "globals", title: "Hydra globals" },
  { id: "sources", title: "s0–s3 methods" },
  ...extensionGroups.map(({ id, title }) => ({ id: id as SectionId, title })),
  { id: "recipes", title: "Recipes" },
];

export interface EntryParam { name: string; default?: number | string | null; description?: string }

export interface Entry {
  /** Unique: "ao:bass", "hydra:osc", "source:initScene", "global:render", "ext:noise" (an extension's intro), "ext:noise:warp", "recipe:chains". */
  id: string;
  section: SectionId;
  name: string;
  signature?: string;
  description: string;
  params: EntryParam[];
  example: string;
  /** Plays when selected; false for examples that need hardware, the network, or blank the screen. */
  autoplay: boolean;
  /** Words that lead here besides the name, for K and search. */
  aliases: string[];
  /** For `ao` properties: the member whose live value the entry shows. */
  live?: string;
}

const unpack = (example: Example) =>
  typeof example === "string" ? { example, autoplay: true } : { example: example.code, autoplay: false };

function fromDoc(id: string, section: SectionId, name: string, doc: ReturnType<typeof functionDoc>, example: Example | undefined): Entry {
  return {
    id, section, name,
    signature: doc?.signature,
    description: doc?.description ?? "",
    params: doc?.params ?? [],
    ...unpack(example ?? ""),
    aliases: [],
  };
}

/** Every explorer entry, in section order. */
export function buildEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const { name, method } of publicAoMembers()) {
    const entry = fromDoc(`ao:${name}`, "ao", `ao.${name}`, functionDoc(name, "ao"), aoExamples[name]);
    if (!method && name !== "time") entry.live = name;
    entries.push(entry);
  }
  const byType = new Map<string, Entry[]>();
  for (const fn of hydraFunctions()) {
    const list = byType.get(fn.type) ?? [];
    list.push(fromDoc(`hydra:${fn.name}`, fn.type as SectionId, fn.name, functionDoc(fn.name), hydraExamples[fn.name]));
    byType.set(fn.type, list);
  }
  for (const type of ["src", "coord", "color", "combine", "combineCoord"]) entries.push(...(byType.get(type) ?? []));
  for (const g of globalEntries) {
    entries.push({
      id: `global:${g.name}`, section: "globals", name: g.name, signature: g.signature,
      description: g.description, params: [], ...unpack(g.example), aliases: g.aliases ?? [],
    });
  }
  for (const name of sourceMembers) {
    entries.push(fromDoc(`source:${name}`, "sources", `s0.${name}`, functionDoc(name, "s0"), sourceExamples[name]));
  }
  entries.push(...extensionEntries());
  for (const r of recipes) {
    entries.push({ id: `recipe:${r.name}`, section: "recipes", name: r.name, description: r.description, params: [], ...unpack(r.example), aliases: [] });
  }
  return entries;
}

/**
 * The vendored extensions' entries: for each, an intro (`use("noise")`)
 * opening its first section, then everything it adds, section by section.
 * Output methods read `o0.setLinear`, as source methods read `s0.initScene`.
 * Names broken upstream say so and don't auto-play.
 */
function extensionEntries(): Entry[] {
  const entries: Entry[] = [];
  const api = extensionApi();
  for (const ext of CATALOG) {
    const docs = extensionDocs[ext.name];
    const examples = extensionExamples[ext.name] ?? {};
    entries.push({
      id: `ext:${ext.name}`, section: docs.groups[0] as SectionId, name: `use("${ext.name}")`,
      description: `${docs.intro}\n\nBy ${docs.author}, ${docs.licence}. \`await use("${ext.name}")\` loads it on the deck running the sketch; it stays loaded there until Ao restarts.`,
      params: [], ...unpack(examples.use ?? ""), aliases: [ext.name, ext.file.replace(/\.js$/, "")],
    });
    for (const group of docs.groups) {
      for (const fn of api.filter((f) => f.extension === ext.name && f.group === group)) {
        const example = unpack(examples[fn.name] ?? "");
        entries.push({
          id: `ext:${ext.name}:${fn.name}`, section: group as SectionId,
          name: fn.kind === "output" ? `o0.${fn.name}` : fn.name,
          signature: fn.signature,
          description: [fn.description, ...(fn.broken ? [`Broken upstream: ${fn.broken}`] : []), `Needs \`await use("${ext.name}")\`.`].join("\n\n"),
          params: fn.params,
          ...example,
          autoplay: example.autoplay && !fn.broken,
          aliases: [],
        });
      }
    }
  }
  return entries;
}

/** The identifier at `column` in `line`, with the object it's a member of: `ao.hz` → { name: "hz", owner: "ao" }. */
export function wordAt(line: string, column: number): { name: string; owner?: string } | null {
  const isWord = (c: string | undefined) => c !== undefined && /[\w$]/.test(c);
  let from = column, to = column;
  // With the cursor just past a word, as at the end of a line, use that word.
  if (!isWord(line[column]) && isWord(line[column - 1])) from = to = column - 1;
  if (!isWord(line[from])) return null;
  while (isWord(line[from - 1])) from--;
  while (isWord(line[to])) to++;
  const name = line.slice(from, to);
  const owner = line.slice(0, from).match(/([\w$]+)\s*\.\s*$/)?.[1];
  return owner ? { name, owner } : { name };
}

/** A word in the code: its name, the object it's a member of, and what that object holds, from the editor's syntax tree. */
export interface Word { name: string; owner?: string; receiver?: Receiver }

/** Where a word is written, from its receiver or failing that its owner's name; undefined on its own or when unknown. */
function contextOf({ owner, receiver }: Word): Receiver | undefined {
  if (receiver) return receiver;
  if (owner === "ao") return "ao";
  if (owner && /^s[0-3]$/.test(owner)) return "source";
  if (owner && /^(o[0-3]|oS)$/.test(owner)) return "output";
  return undefined;
}

/** Entry ids that `word` is a synonym for, written in `context`, best first; any context's when `context` is "any". */
function synonymTargets(word: string, context: Receiver | undefined | "any"): string[] {
  const w = word.toLowerCase();
  return [...new Set(synonyms
    .filter((s) => (context === "any" || s.on === context) && s.words.includes(w))
    .flatMap((s) => s.to))];
}

/**
 * The entry for a word in the code, if there is one. A word that isn't a
 * name falls back to a synonym written in the same place, so `ao.smooth`
 * finds glide but `[0, 1].smooth` finds arrays.
 */
export function findEntry(entries: Entry[], word: Word): Entry | undefined {
  const { name, owner } = word;
  const synonym = () => {
    const [first] = synonymTargets(name, contextOf(word));
    return first ? entries.find((e) => e.id === first) : undefined;
  };
  const byId = (id: string) => entries.find((e) => e.id === id);
  if (owner === "ao") return byId(`ao:${name}`) ?? synonym();
  if (owner && /^s[0-3]$/.test(owner)) return byId(`source:${name}`) ?? synonym();
  if (owner && /^(o[0-3]|oS)$/.test(owner)) return byId(`ext:outputs:${name}`) ?? synonym();
  if (name === "ao") return byId("ao:map");
  return byId(`hydra:${name}`) ?? byId(`global:${name}`)
    ?? entries.find((e) => e.id.startsWith("ext:") && e.name === name) ?? synonym() ?? entries.find((e) => e.aliases.includes(name));
}

/** True if the letters of `query` appear in `text` in order. */
function subsequence(query: string, text: string): boolean {
  let i = 0;
  for (const c of text) if (c === query[i]) i++;
  return i === query.length;
}

/** A search's context from its prefix: `ao.smooth` is written after ao, `.move` on a Hydra chain. */
function queryContext(query: string): { q: string; context?: Receiver } {
  const prefix = query.match(/^(ao|s[0-3]|o[0-3]|oS)?\./);
  const q = query.slice(prefix?.[0].length ?? 0).toLowerCase();
  if (!prefix) return { q };
  return { q, context: prefix[1] ? contextOf({ name: q, owner: prefix[1] }) : "hydra" };
}

/**
 * Entries matching `query`, in section order, and the best match to select.
 * Names and aliases match by substring, or failing that by letters in order;
 * descriptions by substring; synonyms by the whole word. A synonym leads
 * only where it's written: after a prefix such as `ao.` or `.`, or in
 * `context`, it outranks every name; with neither, any context's counts,
 * below an exact name but above the rest.
 */
export function filterEntries(entries: Entry[], query: string, context?: Receiver): { matches: Entry[]; best?: Entry } {
  const parsed = queryContext(query.trim());
  const { q } = parsed;
  const where = parsed.context ?? context;
  if (!q) return { matches: entries, best: entries[0] };
  const targets = synonymTargets(q, where ?? "any");
  const score = (entry: Entry): number => {
    const names = [entry.name, ...entry.aliases].map((n) => n.toLowerCase().replace(/^(ao|s0|o0)\./, ""));
    // Earlier targets score a little higher, so the first is the best match.
    const target = targets.indexOf(entry.id);
    if (target >= 0) return (where ? 6 : 4.5) - target / 100;
    if (names.some((n) => n === q)) return 5;
    if (names.some((n) => n.startsWith(q))) return 4;
    if (names.some((n) => n.includes(q))) return 3;
    if (entry.description.toLowerCase().includes(q) || entry.signature?.toLowerCase().includes(q)) return 2;
    if (names.some((n) => subsequence(q, n))) return 1;
    return 0;
  };
  const scored = entries.map((entry) => ({ entry, score: score(entry) })).filter((s) => s.score > 0);
  let best: (typeof scored)[number] | undefined;
  // Among equal scores, the shortest name is the closest match.
  for (const s of scored) {
    if (!best || s.score > best.score || (s.score === best.score && s.entry.name.length < best.entry.name.length)) best = s;
  }
  return { matches: scored.map((s) => s.entry), best: best?.entry };
}
