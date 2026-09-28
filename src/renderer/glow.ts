/**
 * Ao's own chain methods, on every deck: `.glow()` and `.diffuse()`.
 *
 * Hydra compiles a chain into one fragment shader that runs once per pixel,
 * so no single GLSL function can look at its neighbours. Both methods are
 * built from Hydra's own transforms instead:
 *
 * - `.glow()` adds copies of the chain so far, each scrolled a little way
 *   around a ring, so bright colours spill onto their neighbours. Every copy
 *   runs the whole chain again, so it costs about 13 times the chain's work.
 * - `.diffuse()` blends the chain with the previous frame of the output it's
 *   drawn to, zoomed slightly and nudged by noise, so colours bleed outwards
 *   over time. The output is only known at `.out()`, so `diffuse` leaves a
 *   placeholder that the deck's `out` swaps for that blend.
 *
 * Order matters: `.glow().diffuse()` settles, since a blend adds no light,
 * but `.diffuse().glow()` adds glow to a frame that already has last frame's
 * glow in it, and brightens until it's white.
 */

/** A Hydra argument: a number, or a function Hydra calls every frame. */
export type Value = number | ((props: object) => number);

/** One step of a chain, as hydra-synth's GlslSource stores it. */
interface Transform {
  name: string;
  transform: { type: string };
  userArgs: unknown[];
  synth: Factory;
}

/** hydra-synth's GeneratorFactory: the generators and GLSL transforms of one deck. */
interface Factory {
  generators: Record<string, (...args: unknown[]) => Chain>;
  glslTransforms: Record<string, { type: string }>;
}

/** A hydra-synth GlslSource. */
interface Chain {
  transforms: Transform[];
  synth: Factory;
  defaultOutput?: unknown;
  add(texture: Chain, amount: Value): Chain;
  scroll(x: Value, y: Value): Chain;
  scale(amount: Value): Chain;
  modulate(texture: Chain, amount: Value): Chain;
  out(output?: unknown): void;
}

/** The size of the deck's canvas, which glow's ring is kept round against. */
export type Size = () => { width: number; height: number };

const DIFFUSE = "ao-diffuse";

/** Where glow samples, in units of its radius: a tight cross and a wide ring of eight. */
const RING: readonly (readonly [number, number])[] = [
  ...[0, 1, 2, 3].map((i) => [Math.cos(i * Math.PI / 2) / 3, Math.sin(i * Math.PI / 2) / 3] as const),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)] as const),
];

const valueOf = (value: Value, props: object) => typeof value === "function" ? value(props) : value;

/** `value` times `factor()`, as a function so Hydra re-reads both every frame. */
const scaled = (value: Value, factor: () => number) => (props: object) => valueOf(value, props) * factor();

const isChain = (value: unknown): value is Chain =>
  typeof value === "object" && value !== null && Array.isArray((value as Chain).transforms);

/** A chain like `chain` with other transforms; `chain` itself is left alone. */
function withTransforms(chain: Chain, transforms: Transform[]): Chain {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(chain) as object) as Chain, chain);
  copy.transforms = transforms;
  return copy;
}

/**
 * `chain` with every diffuse placeholder, its own or in chains it takes as
 * arguments, replaced by a blend with the previous frame of `output`.
 * Returns `chain` itself when there are none.
 */
export function resolveDiffuse(chain: Chain, output: unknown): Chain {
  let changed = false;
  const transforms = chain.transforms.map((step) => {
    if (step.transform.type === DIFFUSE) {
      changed = true;
      return feedback(step, output);
    }
    const args = step.userArgs.map((arg) => isChain(arg) ? resolveDiffuse(arg, output) : arg);
    if (args.every((arg, i) => arg === step.userArgs[i])) return step;
    changed = true;
    return { ...step, userArgs: args };
  });
  return changed ? withTransforms(chain, transforms) : chain;
}

/** The blend a diffuse placeholder stands for, reading the last frame of `output`. */
function feedback(step: Transform, output: unknown): Transform {
  const [amount, spread, wobble] = step.userArgs as Value[];
  const { generators, glslTransforms } = step.synth;
  const previous = generators.src(output)
    .scale(typeof spread === "function" ? (props: object) => 1 + spread(props) : 1 + spread)
    .modulate(generators.noise(3, 0.1), wobble);
  return { name: "blend", transform: glslTransforms.blend, userArgs: [previous, amount], synth: step.synth };
}

/** Adds `glow`, `diffuse` and a diffuse-aware `out` to a deck's chain prototype (`osc().constructor.prototype`). */
export function installChainExtras(proto: object, size: Size): void {
  const base = (Object.getPrototypeOf(proto) as { out?: (this: Chain, output?: unknown) => void } | null)?.out;
  if (typeof base !== "function") return;
  // Scroll is in fractions of the width and height; this keeps the ring round.
  const aspect = () => {
    const { width, height } = size();
    return width > 0 ? height / width : 1;
  };
  Object.defineProperties(proto, {
    glow: {
      configurable: true, writable: true,
      value: function glow(this: Chain, amount: Value = 1, radius: Value = 0.03): Chain {
        const before = this.transforms.slice();
        const share = scaled(amount, () => 1 / RING.length);
        for (const [x, y] of RING) {
          const copy = withTransforms(this, before.slice());
          this.add(copy.scroll(scaled(radius, () => x * aspect()), scaled(radius, () => y)), share);
        }
        return this;
      },
    },
    diffuse: {
      configurable: true, writable: true,
      value: function diffuse(this: Chain, amount: Value = 0.85, spread: Value = 0.01, wobble: Value = 0.004): Chain {
        this.transforms.push({ name: DIFFUSE, transform: { type: DIFFUSE }, userArgs: [amount, spread, wobble], synth: this.synth });
        return this;
      },
    },
    out: {
      configurable: true, writable: true,
      value: function out(this: Chain, output?: unknown): void {
        base.call(resolveDiffuse(this, output ?? this.defaultOutput), output);
      },
    },
  });
}

/** Help for the editor and the code explorer. */
export const chainExtraDocs = {
  glow: {
    description: "Makes colours glow: adds a soft, blurred copy of the chain so far on top of it, so bright areas spill light onto their neighbours (Ao). It reruns the chain 12 more times, so put it after cheap chains or on src(o1).",
    params: [
      { name: "amount", default: 1, description: "Strength of the glow; 0 is off, above 1 blows out." },
      { name: "radius", default: 0.03, description: "How far the light spreads, as a fraction of the screen height." },
    ],
  },
  diffuse: {
    description: "Makes colours bleed: blends the chain with the previous frame of its output, zoomed slightly and nudged by noise, so colours creep outwards and leave soft trails (Ao). Put it after .glow(): .diffuse().glow() feeds the glow back into itself until the screen turns white.",
    params: [
      { name: "amount", default: 0.85, description: "How much of the last frame stays, 0..1; higher gives longer trails, 1 freezes." },
      { name: "spread", default: 0.01, description: "How far colour creeps outwards each frame, as a zoom; negative pulls it inwards." },
      { name: "wobble", default: 0.004, description: "How much noise warps the trails; 0 keeps them clean." },
    ],
  },
} as const;
