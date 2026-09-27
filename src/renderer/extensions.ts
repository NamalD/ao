/**
 * Vendored Hydra extensions, loaded per deck: `await use("fractals", "noise")`.
 *
 * The files in vendor/hydra/ are upstream's, byte for byte (see
 * vendor/hydra/SOURCES.md), bundled as text, so the allowlist is exactly the
 * bundled set and nothing is fetched at run time. They were written for a
 * single global Hydra: hyper-hydra's find it through `window.hydraSynth` and
 * friends and park it in `window._hydra`, Jourdan's call a global
 * `setFunction`. Ao runs two Hydra instances (decks, see deck.ts), so the
 * loader evaluates each file against one deck instead:
 *
 * - inside that deck's sketch scope, so `setFunction`, `o0` and the other
 *   Hydra names are the deck's;
 * - with `window`, `_hydra` and `_hydraScope` bound to stand-ins: `window`
 *   reads the deck's Hydra (`hydraSynth`, `_hydra`) and synth names first and
 *   everything else from the real window, and writes (`createGradient`) land
 *   on the deck's synth, where the scope and `window`'s accessors see them;
 * - with prototypes the decks share (hydra-synth's Output, HydraSource and
 *   GlslSource classes are module-level) restored afterwards, the patches
 *   moved onto this deck's own objects instead. hydra-outputs patches
 *   `Output.prototype` with closures over one deck's WebGL context, so
 *   without this the second deck to load it would break the first one's.
 *
 * Extensions can't be unloaded: what they add stays on the deck until Ao
 * restarts. Loading one twice on a deck is a no-op.
 */

const bundled = import.meta.glob("./vendor/hydra/*.js", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface ExtensionInfo {
  /** The short name `use` takes. */
  readonly name: string;
  /** The vendored file, also accepted by `use` with or without `.js`. */
  readonly file: string;
  /** One line for the docs and the editor. */
  readonly purpose: string;
}

/** The catalog, in the order the docs list it; every entry must be bundled. */
export const CATALOG: readonly ExtensionInfo[] = [
  { name: "noise", file: "lib-noise.js", purpose: "noise generators: whitenoise, colornoise, unoise, turb, uturb, warp, cwarp, ncontour" },
  { name: "softpattern", file: "lib-softpattern.js", purpose: "soft animated patterns: blinking, blobs, concentric, phasenoise, sdfmove, smoothsun" },
  { name: "fractals", file: "hydra-fractals.js", purpose: "mirroring and inversion for fractal feedback: mirrorX/Y, mirrorX2/Y2, mirrorWrap, inversion" },
  { name: "outputs", file: "hydra-outputs.js", purpose: "output framebuffer settings: o0.setLinear(), setNearest(), clear(), setRepeat/Mirror/Clamp(), setFbos(), and oS for all four" },
  { name: "gradientmap", file: "hydra-gradientmap.js", purpose: "gradient maps: createGradient(...colors), createLinearGradient(angle, ...), .lookupX(tex) and .lookupY(tex)" },
  { name: "arithmetics", file: "hydra-arithmetics.js", purpose: "maths on colours: .sin() .pow() .mod() .range() .clamp()…, add/sub/mult/div by numbers, x() y() length() generators" },
];

export interface Extension extends ExtensionInfo {
  readonly source: string;
}

const EXTENSIONS: readonly Extension[] = CATALOG.map((info) => {
  const source = bundled[`./vendor/hydra/${info.file}`];
  if (source === undefined) throw new Error(`extension ${info.name}: vendor/hydra/${info.file} is not bundled`);
  return { ...info, source };
});

/** The files bundled from vendor/hydra/, for tests. */
export const bundledFiles = (): string[] => Object.keys(bundled).map((path) => path.slice(path.lastIndexOf("/") + 1));

/** Every extension, in catalog order. */
export const extensions = (): readonly Extension[] => EXTENSIONS;

/**
 * The extension called `name`: its short name, or its file name with or
 * without `.js` ("fractals", "hydra-fractals", "hydra-fractals.js").
 */
export function resolveExtension(name: unknown): Extension {
  const key = typeof name === "string" ? name.trim().replace(/\.js$/, "") : "";
  const found = EXTENSIONS.find((ext) => ext.name === key || ext.file === `${key}.js`);
  if (!found) {
    throw new Error(`use: unknown extension ${JSON.stringify(name)}; available: ${EXTENSIONS.map((ext) => ext.name).join(", ")}`);
  }
  return found;
}

type Bag = Record<PropertyKey, unknown>;

/** A prototype several decks share, and where this deck's patches to it go instead. */
export interface SharedPrototype {
  readonly proto: object;
  readonly targets: () => object[];
}

/** What the loader needs of a deck. */
export interface ExtensionHost {
  /** The Hydra instance, which hyper-hydra's files find as `window.hydraSynth`. */
  readonly hydra: object;
  /** Its synth: Hydra's names (`osc`, `o0`, `setFunction`, ...). */
  readonly synth: Bag;
  /** The deck's sketch scope (scope.ts), for `setFunction`, `o0` and friends. */
  readonly scope: object;
  /** Shared prototypes to keep clean; see `sharedPrototypes`. */
  readonly shared?: readonly SharedPrototype[];
}

/**
 * hydra-synth's module-level classes, which both decks' objects inherit from:
 * Output (o0–o3), HydraSource (s0–s3) and GlslSource, whose per-instance
 * subclass (`osc().constructor`) is where a deck's own chain methods live.
 */
export function sharedPrototypes(hydra: { o: object[]; s: object[] }, synth: Bag): SharedPrototype[] {
  const shared: SharedPrototype[] = [];
  const first = (list: object[]) => list[0] && Object.getPrototypeOf(list[0]) as object;
  if (hydra.o.length) shared.push({ proto: first(hydra.o), targets: () => hydra.o });
  if (hydra.s.length) shared.push({ proto: first(hydra.s), targets: () => hydra.s });
  if (typeof synth.osc === "function") {
    const own = Object.getPrototypeOf((synth.osc as () => object)()) as object;
    const base = Object.getPrototypeOf(own) as object | null;
    if (base && base !== Object.prototype) shared.push({ proto: base, targets: () => [own] });
  }
  return shared;
}

type Descriptors = Map<PropertyKey, PropertyDescriptor>;

const snapshot = (proto: object): Descriptors =>
  new Map(Reflect.ownKeys(proto).map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)!]));

const sameDescriptor = (a: PropertyDescriptor, b: PropertyDescriptor) =>
  a.value === b.value && a.get === b.get && a.set === b.set && a.writable === b.writable
  && a.enumerable === b.enumerable && a.configurable === b.configurable;

/** Puts `proto` back as it was, defining what changed on `targets` instead. Returns the changed keys. */
function isolate(proto: object, before: Descriptors, targets: object[]): PropertyKey[] {
  const changed: PropertyKey[] = [];
  for (const key of Reflect.ownKeys(proto)) {
    const now = Object.getOwnPropertyDescriptor(proto, key)!;
    const was = before.get(key);
    if (was && sameDescriptor(was, now)) continue;
    changed.push(key);
    for (const target of targets) Object.defineProperty(target, key, { ...now, configurable: true });
    if (was) Object.defineProperty(proto, key, was);
    else delete (proto as Bag)[key];
  }
  for (const [key, was] of before) {
    if (!Object.hasOwn(proto, key)) Object.defineProperty(proto, key, was);
  }
  return changed;
}

/**
 * A `window` for one deck's extension code: Hydra lookups (`hydraSynth`,
 * `_hydra`, synth names) find the deck, other reads reach the real window,
 * and writes go to the deck's synth.
 */
function deckWindow(host: ExtensionHost, locals: Bag): object {
  const real = globalThis as unknown as Bag;
  return new Proxy(real, {
    get: (_, key) => {
      if (Object.hasOwn(locals, key)) return locals[key];
      if (Object.hasOwn(host.synth, key)) return host.synth[key];
      const value = real[key];
      // Methods of the real window need it as `this`; classes stay constructible when bound.
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    },
    set: (_, key, value) => {
      if (Object.hasOwn(locals, key)) locals[key] = value;
      else host.synth[key] = value;
      return true;
    },
    has: (_, key) => Object.hasOwn(locals, key) || Object.hasOwn(host.synth, key) || key in real,
  });
}

/**
 * Runs one extension's source against `host`. `window`, `_hydra` and
 * `_hydraScope` are parameters, so hyper-hydra's `window._hydra = ...` and
 * its later bare `_hydra` reads (also from functions it leaves behind, like
 * `createGradient`) stay on this deck, and `global` (only reached inside
 * Atom) is the stand-in window too. The code runs inside the deck's scope,
 * so bare `setFunction(...)` and `o0` are the deck's.
 */
export function evaluateExtension(source: string, host: ExtensionHost): void {
  const locals: Bag = { hydraSynth: host.hydra, _hydra: host.hydra, _hydraScope: host.synth };
  const win = deckWindow(host, locals);
  const shared = (host.shared ?? []).map((entry) => ({ entry, before: snapshot(entry.proto) }));
  try {
    // Sloppy mode, which `with` and the upstream code need.
    new Function("__aoScope", "window", "global", "_hydra", "_hydraScope",
      `with (__aoScope) { (function () {\n${source}\n}).call(undefined); }`,
    )(host.scope, win, win, host.hydra, host.synth);
  } finally {
    for (const { entry, before } of shared) isolate(entry.proto, before, entry.targets());
  }
}

type Output = Bag & { resetBuffers?: () => void };
type Texture = { destroy?: () => void };

/**
 * Per-extension fix-ups after loading, and what `reset` undoes between
 * sketches. Keep these small; each is documented in vendor/hydra/SOURCES.md.
 */
interface Hooks {
  loaded?(host: ExtensionHost, state: DeckState): void;
  reset?(host: ExtensionHost, state: DeckState): void;
}

interface DeckState {
  /** Gradient sources made by createLinearGradient/createGradient since the last reset. */
  gradients: Set<{ tex?: Texture }>;
}

const HOOKS: Record<string, Hooks> = {
  outputs: {
    // Settings such as o0.setLinear() or setBufferCount(3) would otherwise
    // carry over to the next sketch on this deck: put Hydra's defaults back.
    reset: (host) => {
      for (const output of (host.hydra as { o?: Output[] }).o ?? []) output.resetBuffers?.();
    },
  },
  gradientmap: {
    // Each call makes a new texture that nothing frees; free them between sketches.
    loaded: (host, state) => {
      const make = host.synth.createLinearGradient as (...args: unknown[]) => { tex?: Texture };
      host.synth.createLinearGradient = (...args: unknown[]) => {
        const source = make(...args);
        state.gradients.add(source);
        return source;
      };
    },
    reset: (_, state) => {
      for (const source of state.gradients) source.tex?.destroy?.();
      state.gradients.clear();
    },
  },
};

/** One deck's extensions: what `use` has loaded there, and resetting them between sketches. */
export class ExtensionLoader {
  private readonly loaded = new Set<string>();
  private readonly state: DeckState = { gradients: new Set() };

  constructor(private readonly host: ExtensionHost) {}

  /** Short names of the extensions loaded on this deck, in load order. */
  get names(): string[] {
    return [...this.loaded];
  }

  /**
   * Loads extensions into this deck; ones already loaded are skipped. Loads
   * synchronously, so functions exist as soon as it returns, and returns a
   * promise so sketches can `await use(...)`. Unknown names throw before
   * anything loads.
   */
  use = (...names: unknown[]): Promise<void> => {
    const wanted = names.map(resolveExtension);
    for (const ext of wanted) {
      if (this.loaded.has(ext.name)) continue;
      try {
        evaluateExtension(ext.source, this.host);
      } catch (e) {
        throw new Error(`use("${ext.name}"): ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
      this.loaded.add(ext.name);
      HOOKS[ext.name]?.loaded?.(this.host, this.state);
    }
    return Promise.resolve();
  };

  /** Between sketches: undoes per-sketch state the loaded extensions leave (their functions stay). */
  reset(): void {
    for (const name of this.loaded) HOOKS[name]?.reset?.(this.host, this.state);
  }
}
