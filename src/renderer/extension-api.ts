/**
 * What each vendored Hydra extension adds, for completion, signature help
 * and the code explorer: one list, derived from the vendored files where it
 * can be and filled in from the hand-written docs in extension-docs.ts.
 *
 * The files are run exactly as `use` runs them (extensions.ts's
 * evaluateExtension), but against a stand-in Hydra that records instead of
 * compiling: every `setFunction({ name, type, inputs })` call, and every name
 * a file adds to the synth (`createGradient`, `oS`), to the chain prototype
 * (arithmetics' `sin`, `pow`, `amp`, …) or to the Output prototype
 * (hydra-outputs' `setLinear`, …). That catches names generated in loops,
 * such as arithmetics', without a parser, and the stand-in shares nothing
 * with the real decks. Names starting with `_` are internal and skipped.
 *
 * Tests check that every name found has docs and every doc names something
 * found (tests/extension-api.test.ts).
 */
import { extensionDocs, type ExtensionFunctionDoc, extensionGroups, type ExtensionParamDoc } from "./extension-docs";
import { CATALOG, evaluateExtension, extensions } from "./extensions";

export { extensionDocs, extensionGroups };

/** One `setFunction` definition as the file passes it. */
export interface RecordedFunction {
  name: string;
  type: string;
  inputs: { name: string; type: string; default?: unknown }[];
}

/** Everything one file adds, as recorded against the stand-in Hydra. */
export interface RecordedExtension {
  /** Every setFunction call, internal ones (`_add`) included. */
  functions: RecordedFunction[];
  /** Names added to the chain prototype, with the setFunction definition each one is, if it is one. */
  chain: Map<string, RecordedFunction | undefined>;
  /** Names added to Output.prototype (o0–o3 methods). */
  outputs: string[];
  /** Names added to the synth other than setFunction generators. */
  globals: string[];
}

type Bag = Record<string, unknown>;

/** Runs one extension's source against a recording stand-in Hydra. */
export function recordExtension(source: string): RecordedExtension {
  const functions: RecordedFunction[] = [];
  const definitionOf = new Map<unknown, RecordedFunction>();
  class Chain {}
  class Output { fbos: unknown[] = []; }
  class Source {}
  const chainProto = Chain.prototype as unknown as Bag;
  const outputs = [0, 1, 2, 3].map(() => new Output());
  const labels = new Map<unknown, string>(outputs.map((o, i) => [o, `o${i}`]));
  const synth: Bag = {
    setFunction(definition: RecordedFunction) {
      const recorded: RecordedFunction = {
        name: definition.name,
        type: definition.type,
        // A default that is an output (gradientmap's lookupX) reads as its name.
        inputs: (definition.inputs ?? []).map((input) => ({ ...input, default: labels.get(input.default) ?? input.default })),
      };
      functions.push(recorded);
      // Like Hydra: generators go on the synth, the rest become chain methods.
      if (definition.type !== "src") {
        const method = function () {};
        definitionOf.set(method, recorded);
        chainProto[definition.name] = method;
      }
    },
    osc: () => new Chain(),
  };
  outputs.forEach((output, i) => { synth[`o${i}`] = output; });
  const sources = [0, 1, 2, 3].map(() => new Source());
  sources.forEach((source, i) => { synth[`s${i}`] = source; });
  const hydra = { regl: { _gl: {} }, sandbox: { makeGlobal: false }, synth, o: outputs, s: sources };
  const before = new Set(Object.keys(synth));
  evaluateExtension(source, { hydra, synth, scope: synth });
  const generators = new Set(functions.filter((fn) => fn.type === "src").map((fn) => fn.name));
  const chain = new Map<string, RecordedFunction | undefined>();
  for (const name of Object.getOwnPropertyNames(chainProto)) {
    if (name !== "constructor") chain.set(name, definitionOf.get(chainProto[name]));
  }
  return {
    functions,
    chain,
    outputs: Object.getOwnPropertyNames(Output.prototype).filter((name) => name !== "constructor"),
    globals: Object.keys(synth).filter((name) => !before.has(name) && !generators.has(name)),
  };
}

const recordings = new Map<string, RecordedExtension>();

/** What the extension called `name` adds; recorded once. */
export function recorded(name: string): RecordedExtension {
  let found = recordings.get(name);
  if (!found) {
    const ext = extensions().find((e) => e.name === name);
    if (!ext) throw new Error(`unknown extension ${name}`);
    found = recordExtension(ext.source);
    recordings.set(name, found);
  }
  return found;
}

/**
 * How a name is reached: a generator starts a chain (`blinking()`), a method
 * continues one (`.mirrorX()`), an output method follows `o0.` to `o3.` and a
 * global is a plain name (`createGradient`, `oS`).
 */
export type ExtensionKind = "generator" | "method" | "output" | "global";

export interface ExtensionParam extends ExtensionParamDoc {
  type?: string;
}

/** One documented function, method or name an extension adds. */
export interface ExtensionFunction {
  name: string;
  /** The extension's short name, as `use` takes it. */
  extension: string;
  kind: ExtensionKind;
  /** Its setFunction type (src, coord, color, combine), if it is one or an alias of one. */
  type?: string;
  /** The explorer group, from extensionGroups. */
  group: string;
  signature: string;
  params: ExtensionParam[];
  description: string;
  /** Why it doesn't work in Ao, if it doesn't. */
  broken?: string;
}

/** Public names, the way they're reached, in the order each file adds them. */
function publicNames(rec: RecordedExtension): { name: string; kind: ExtensionKind; definition?: RecordedFunction }[] {
  const out: { name: string; kind: ExtensionKind; definition?: RecordedFunction }[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: ExtensionKind, definition?: RecordedFunction) => {
    if (name.startsWith("_") || seen.has(name)) return;
    seen.add(name);
    out.push({ name, kind, definition });
  };
  for (const fn of rec.functions) add(fn.name, fn.type === "src" ? "generator" : "method", fn);
  for (const [name, definition] of rec.chain) add(name, "method", definition);
  for (const name of rec.outputs) add(name, "output");
  for (const name of rec.globals) add(name, "global");
  return out;
}

/** A parameter's name as shown: `_min` reads as `min`. Hydra passes arguments by position, so names are only labels. */
const shown = (name: string) => name.replace(/^_+/, "");

function build(): ExtensionFunction[] {
  const list: ExtensionFunction[] = [];
  for (const ext of CATALOG) {
    const docs = extensionDocs[ext.name];
    for (const { name, kind, definition } of publicNames(recorded(ext.name))) {
      const doc: ExtensionFunctionDoc | undefined = docs?.functions[name];
      if (!doc) continue; // tests/extension-api.test.ts fails on undocumented names
      const params: ExtensionParam[] = doc.args
        ?? (definition?.inputs ?? []).map((input) => ({
          name: shown(input.name),
          type: input.type,
          default: typeof input.default === "number" || typeof input.default === "string" ? input.default : null,
          description: doc.params?.[shown(input.name)],
        }));
      const args = params.map((p) => `${p.name}${p.default == null ? "" : ` = ${p.default}`}`).join(", ");
      list.push({
        name,
        extension: ext.name,
        kind,
        type: definition?.type,
        group: doc.group ?? docs.groups[0],
        signature: doc.signature ?? (kind === "global" && !doc.args ? name : `${name}(${args})`),
        params,
        description: doc.description,
        broken: doc.broken,
      });
    }
  }
  return list;
}

let api: ExtensionFunction[] | undefined;

/** Every documented name the vendored extensions add, in catalog order. */
export function extensionApi(): ExtensionFunction[] {
  api ??= build();
  return api;
}

/** Documented names an extension adds that aren't found in its file, and found names without docs; both empty when in sync. */
export function docsDrift(name: string, rec: RecordedExtension = recorded(name)): { undocumented: string[]; unknown: string[] } {
  const found = publicNames(rec).map((n) => n.name);
  const documented = Object.keys(extensionDocs[name]?.functions ?? {});
  return {
    undocumented: found.filter((n) => !documented.includes(n)),
    unknown: documented.filter((n) => !found.includes(n)),
  };
}

/**
 * The extensions a sketch loads: the names in its `use(...)` calls, short or
 * file names, resolved to short names. Unknown names are left out.
 */
export function usedExtensions(code: string): Set<string> {
  const used = new Set<string>();
  for (const call of code.matchAll(/\buse\s*\(([^)]*)\)/g)) {
    for (const arg of call[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
      const key = arg[1].trim().replace(/\.js$/, "");
      const ext = CATALOG.find((e) => e.name === key || e.file === `${key}.js`);
      if (ext) used.add(ext.name);
    }
  }
  return used;
}

/**
 * The edit that makes a sketch load `name`: adds it to the sketch's first
 * `use(...)` call, or puts `await use("name")` as a block of its own after
 * the sketch's opening comments. Null if the sketch already loads it.
 */
export function addUse(code: string, name: string): { from: number; insert: string } | null {
  if (usedExtensions(code).has(name)) return null;
  const call = /\buse\s*\(([^)]*)\)/.exec(code);
  if (call) {
    const close = call.index + call[0].length - 1;
    return { from: close, insert: call[1].trim() ? `, "${name}"` : `"${name}"` };
  }
  // After the leading comment lines and blank lines, where sketches put theirs.
  let from = 0;
  for (const line of code.split("\n")) {
    const text = line.trim();
    if (text && !text.startsWith("//")) break;
    from += line.length + 1;
  }
  if (from > code.length) return { from: code.length, insert: `${code.endsWith("\n") || !code ? "" : "\n"}await use("${name}")\n` };
  // Keep a blank line between the comments and the use line.
  const lead = from > 0 && code.slice(0, from).trim() && !/\n\s*\n$/.test(code.slice(0, from)) ? "\n" : "";
  return { from, insert: `${lead}await use("${name}")\n\n` };
}
