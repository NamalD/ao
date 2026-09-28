import { DRAW_SHADER, type DrawShader, type UniformValue } from "./shader-canvas";

/**
 * Solids: 3D shapes written like Hydra chains and raymarched in a generated shader.
 *
 *   sphere(1).spikes(() => heat).spin(0, 0.3).color(1, 0.3, 0.6).out(s0)
 *
 * Each chain compiles to a distance function. Every argument, numbers
 * included, becomes a uniform, so scrubbing a number or re-running a block
 * with new numbers reuses the compiled shader instead of rebuilding it.
 */

/** A solid argument: a number, or a function Ao reads every frame. */
export type SolidArg = number | (() => number);

export interface SolidParam {
  name: string;
  /** Default value; a string names an earlier parameter whose value it copies. */
  default: number | string;
  description: string;
}

export interface SolidFunction {
  name: string;
  /** shape starts a chain; modify rewrites the point, distance or colour; combine joins two solids. */
  type: "shape" | "modify" | "combine";
  params: SolidParam[];
  description: string;
  /** shape: the distance at point `{p}`. combine: a vec4 from `{a}` and `{b}`. */
  glsl?: string;
  /**
   * shape: the radius of a sphere around the origin the solid fits inside.
   * modify: that radius from the chain's `{bound}`; unchanged if omitted.
   * Rays that miss the sphere skip raymarching.
   */
  bound?: string;
  /** modify: the point the chain before it sees, from `{p}`. */
  point?: string;
  /**
   * modify: the new distance, from the chain's distance `{d}` at point `{p}`.
   * combine: the distance alone, from the distances `{a}` and `{b}`.
   */
  distance?: string;
  /** modify: the new colour, from the chain's colour `{c}`. */
  color?: string;
  /**
   * modify: how far from the chain's `{reach}` the surface may now lie from
   * where the distance says. Far from a solid the raymarcher steps by the
   * distance minus this bound, so surface detail doesn't slow it down there.
   */
  reach?: string;
  /** modify: how much steeper the distance now changes than the chain's `{slope}`; near the surface steps shrink by 1 + slope. */
  slope?: string;
}

const param = (name: string, value: number | string, description: string): SolidParam => ({ name, default: value, description });

/** Every solid function; docs, completions and the compiler all read this table. */
export const solidFunctions: SolidFunction[] = [
  // Shapes
  { name: "sphere", type: "shape", description: "A ball centred on the origin.",
    params: [param("radius", 1, "Radius; the view spans about -2.2..2.2 up and down.")],
    glsl: "length({p}) - {radius}", bound: "abs({radius})" },
  { name: "box", type: "shape", description: "A box centred on the origin.",
    params: [param("width", 1.4, "Size along x."), param("height", "width", "Size along y; defaults to width."), param("depth", "width", "Size along z; defaults to width.")],
    glsl: "aoBox({p}, 0.5 * vec3({width}, {height}, {depth}))", bound: "0.5 * length(vec3({width}, {height}, {depth}))" },
  { name: "torus", type: "shape", description: "A ring lying flat in the x-z plane.",
    params: [param("radius", 1, "Distance from the centre to the middle of the tube."), param("thickness", 0.3, "Radius of the tube.")],
    glsl: "length(vec2(length({p}.xz) - {radius}, {p}.y)) - {thickness}", bound: "abs({radius}) + abs({thickness})" },
  { name: "cylinder", type: "shape", description: "An upright cylinder centred on the origin.",
    params: [param("radius", 0.6, "Radius."), param("height", 1.6, "Height along y.")],
    glsl: "aoCylinder({p}, {radius}, {height})", bound: "length(vec2({radius}, 0.5 * {height}))" },
  { name: "octahedron", type: "shape", description: "An eight-sided diamond.",
    params: [param("size", 1.2, "Distance from the centre to each point.")],
    glsl: "(dot(abs({p}), vec3(1.0)) - {size}) * 0.57735", bound: "abs({size})" },
  { name: "plane", type: "shape", description: "An endless floor; pair it with repeat for fields of shapes.",
    params: [param("height", -1, "Height of the floor; below 0 is under the centre.")],
    glsl: "{p}.y - {height}", bound: "1e6" },
  // Placement
  { name: "move", type: "modify", description: "Moves the solid.",
    params: [param("x", 0, "Right."), param("y", 0, "Up."), param("z", 0, "Towards the camera.")],
    point: "{p} - vec3({x}, {y}, {z})", bound: "{bound} + length(vec3({x}, {y}, {z}))" },
  { name: "rotate", type: "modify", description: "Turns the solid by fixed angles, in radians.",
    params: [param("x", 0, "Tilt around the x axis."), param("y", 0, "Turn around the upright y axis."), param("z", 0, "Roll around the z axis, facing the camera.")],
    point: "aoRotate({p}, vec3({x}, {y}, {z}))" },
  { name: "spin", type: "modify", description: "Keeps the solid turning, in radians per second.",
    params: [param("x", 0, "Speed around the x axis."), param("y", 0.5, "Speed around the upright y axis."), param("z", 0, "Speed around the z axis.")],
    point: "aoRotate({p}, vec3({x}, {y}, {z}) * iTime)" },
  { name: "scale", type: "modify", description: "Grows or shrinks the solid.",
    params: [param("amount", 1, "Size factor: above 1 grows, below 1 shrinks.")],
    point: "{p} / {amount}", distance: "{d} * {amount}", reach: "{reach} * abs({amount})", bound: "{bound} * abs({amount})" },
  { name: "repeat", type: "modify", description: "Repeats the solid along each axis, endlessly or a set number of times.",
    params: [param("x", 3, "Spacing along x; 0 doesn't repeat."), param("y", 0, "Spacing along y; 0 doesn't repeat."), param("z", 3, "Spacing along z; 0 doesn't repeat."), param("count", 0, "Copies along each repeating axis, centred; 0 repeats endlessly.")],
    point: "aoRepeat({p}, vec3({x}, {y}, {z}), {count})",
    // Endless copies have no bound; counted ones sit at most half the row from the centre.
    bound: "mix(1e6, {bound} + length(abs(vec3({x}, {y}, {z})) * 0.5 * (max(round({count}), 1.0) - 1.0)), step(0.5, {count}))" },
  { name: "radial", type: "modify", description: "Repeats the solid in a ring around the upright axis; move it out along x first.",
    params: [param("count", 6, "Copies around the ring; keep each copy inside its slice.")],
    point: "aoRadial({p}, {count})" },
  { name: "mirror", type: "modify", description: "Reflects the solid across the centre on each chosen axis; move it off-centre first.",
    params: [param("x", 1, "1 mirrors left and right, 0 doesn't."), param("y", 0, "1 mirrors up and down, 0 doesn't."), param("z", 0, "1 mirrors front and back, 0 doesn't.")],
    point: "mix({p}, abs({p}), step(0.5, vec3({x}, {y}, {z})))" },
  { name: "elongate", type: "modify", description: "Stretches the middle of the solid, keeping its ends: a sphere becomes a capsule.",
    params: [param("x", 1, "Extra length along x."), param("y", 0, "Extra length along y."), param("z", 0, "Extra length along z.")],
    point: "aoElongate({p}, vec3({x}, {y}, {z}))", bound: "{bound} + 0.5 * length(vec3({x}, {y}, {z}))" },
  { name: "twist", type: "modify", description: "Twists the solid around its upright axis; large amounts may tear.",
    params: [param("amount", 1, "Radians of twist per unit of height.")],
    point: "aoTwist({p}, {amount})", reach: "1e6", slope: "{slope} + 2.0 * abs({amount})" },
  { name: "bend", type: "modify", description: "Curls the solid sideways into an arch; large amounts may tear.",
    params: [param("amount", 0.5, "Radians of bend per unit along x; negative bends the other way.")],
    point: "aoBend({p}, {amount})", reach: "1e6", slope: "{slope} + 2.0 * abs({amount})" },
  { name: "taper", type: "modify", description: "Narrows or widens the solid with height: a cylinder becomes a cone.",
    params: [param("amount", -0.4, "Change in width per unit of height; negative narrows upwards.")],
    point: "aoTaper({p}, {amount})", distance: "{d} * min(aoTaperWidth({p}.y, {amount}), 1.0)",
    reach: "1e6", slope: "{slope} + 2.0 * abs({amount})", bound: "{bound} * (1.0 + abs({amount}) * {bound})" },
  { name: "ripple", type: "modify", description: "Rings of waves spreading out from the centre; try it on a plane, driven by the bass.",
    params: [param("amount", 0.1, "Height of the waves."), param("frequency", 6, "Waves per unit outwards: higher packs them closer."), param("speed", 2, "How fast they spread; negative draws them in.")],
    point: "{p} - vec3(0.0, {amount} * sin({frequency} * length({p}.xz) - {speed} * iTime), 0.0)",
    reach: "{reach} + abs({amount})", slope: "{slope} + abs({amount} * {frequency})", bound: "{bound} + abs({amount})" },
  { name: "warp", type: "modify", description: "Bends space itself with evolving noise, smearing the solid like melting wax.",
    params: [param("amount", 0.2, "How far space moves."), param("scale", 1.5, "Noise frequency; higher gives tighter bends."), param("speed", 0.3, "How fast the noise evolves.")],
    point: "{p} + {amount} * aoWarp({p} * {scale} + iTime * {speed})",
    reach: "{reach} + 1.8 * abs({amount})", slope: "{slope} + 3.0 * abs({amount} * {scale})", bound: "{bound} + 1.8 * abs({amount})" },
  // Surface
  { name: "spikes", type: "modify", description: "Pushes sharp spikes out of the surface; drive the length with the music.",
    params: [param("length", 0.3, "How far the spikes reach; 0 is smooth."), param("density", 8, "How many spikes: higher packs in more, thinner ones."), param("sharpness", 4, "Higher makes needles, lower makes soft bumps."), param("variety", 0, "How much spike lengths differ: 0 all alike, 1 from nothing to full length.")],
    distance: "{d} - {length} * aoSpikes({p}, {density}, {sharpness}, {variety})",
    reach: "{reach} + abs({length})", slope: "{slope} + 0.5 * abs({length} * {density}) * sqrt(max({sharpness}, 1.0))", bound: "{bound} + abs({length})" },
  { name: "wobble", type: "modify", description: "A slow, liquid swell over the surface.",
    params: [param("amount", 0.1, "How far the surface moves."), param("frequency", 3, "Number of swells across the solid."), param("speed", 1, "How fast the swells move.")],
    distance: "{d} - {amount} * aoWobble({p}, {frequency}, {speed})",
    reach: "{reach} + 2.0 * abs({amount})", slope: "{slope} + abs({amount} * {frequency})", bound: "{bound} + 2.0 * abs({amount})" },
  { name: "noise", type: "modify", description: "Lumpy, evolving noise over the surface.",
    params: [param("amount", 0.15, "How far the surface moves."), param("scale", 2, "Noise frequency; higher gives finer lumps."), param("speed", 0.5, "How fast the noise evolves.")],
    distance: "{d} - {amount} * (2.0 * aoNoise({p} * {scale} + iTime * {speed}) - 1.0)",
    reach: "{reach} + 2.0 * abs({amount})", slope: "{slope} + 2.0 * abs({amount} * {scale})", bound: "{bound} + 2.0 * abs({amount})" },
  { name: "spectrum", type: "modify", description: "Pushes the surface out by the spectrum: lows at the bottom, highs at the top.",
    params: [param("amount", 0.4, "How far a full-level band pushes out.")],
    distance: "{d} - {amount} * aoFFT(0.5 + 0.5 * aoDirection({p}).y)",
    reach: "{reach} + abs({amount})", slope: "{slope} + 8.0 * abs({amount})", bound: "{bound} + abs({amount})" },
  { name: "waveform", type: "modify", description: "Wraps the waveform around the solid's equator, fading out towards its poles.",
    params: [param("amount", 0.3, "How far a full-scale wave pushes out.")],
    distance: "{d} - {amount} * aoWaveform({p})",
    reach: "{reach} + abs({amount})", slope: "{slope} + 16.0 * abs({amount})", bound: "{bound} + abs({amount})" },
  { name: "ridges", type: "modify", description: "Sharp horizontal ridges that scroll along the solid; drive the speed with the tempo.",
    params: [param("amount", 0.08, "How far the ridges stand out."), param("frequency", 12, "Ridges per unit of height, over π."), param("speed", 1, "How fast they scroll upwards; negative scrolls down.")],
    distance: "{d} - {amount} * (1.0 - abs(sin({frequency} * {p}.y - {speed} * iTime)))",
    reach: "{reach} + abs({amount})", slope: "{slope} + abs({amount} * {frequency})", bound: "{bound} + abs({amount})" },
  { name: "cells", type: "modify", description: "Cracks the surface into cells, like dried mud or scales.",
    params: [param("amount", 0.06, "How deep the cracks cut; negative raises veins instead."), param("scale", 3, "Cells per unit; higher gives smaller cells."), param("speed", 0, "How fast the cells drift.")],
    distance: "{d} + {amount} * aoCracks({p} * {scale} + iTime * {speed})",
    reach: "{reach} + abs({amount})", slope: "{slope} + 7.0 * abs({amount} * {scale})", bound: "{bound} + abs({amount})" },
  { name: "round", type: "modify", description: "Rounds edges by growing the solid outwards.",
    params: [param("radius", 0.1, "Rounding radius.")],
    distance: "{d} - {radius}", bound: "{bound} + abs({radius})" },
  { name: "shell", type: "modify", description: "Hollows the solid into a thin skin; cut it open with sub to see inside.",
    params: [param("thickness", 0.05, "Thickness of the skin.")],
    distance: "abs({d}) - {thickness}", bound: "{bound} + abs({thickness})" },
  { name: "onion", type: "modify", description: "Nests shells inside each other like an onion; cut it open with sub to see them.",
    params: [param("count", 3, "Number of shells."), param("gap", 0.15, "Distance between shells."), param("thickness", 0.03, "Thickness of each shell.")],
    distance: "aoOnion({d}, {count}, {gap}, {thickness})", bound: "{bound} + abs({thickness})" },
  // Material
  { name: "color", type: "modify", description: "Colours the solid; values above 1 glow brighter.",
    params: [param("r", 1, "Red."), param("g", 1, "Green."), param("b", 1, "Blue.")],
    color: "vec3({r}, {g}, {b})" },
  { name: "saturate", type: "modify", description: "Scales the solid's colour saturation.",
    params: [param("amount", 2, "Saturation factor: 0 is greyscale, 1 unchanged, above 1 more vivid.")],
    color: "mix(vec3(dot({c}, vec3(0.2125, 0.7154, 0.0721))), {c}, {amount})" },
  // Combining
  { name: "add", type: "combine", description: "Joins another solid to this one; smooth melts them together like liquid.",
    params: [param("smooth", 0, "Blend distance; 0 is a hard join, 0.5 is very blobby.")],
    glsl: "aoUnion({a}, {b}, {smooth})", distance: "aoUnionDistance({a}, {b}, {smooth})" },
  { name: "sub", type: "combine", description: "Cuts another solid out of this one.",
    params: [param("smooth", 0, "Blend distance; 0 is a sharp cut.")],
    glsl: "aoSubtract({a}, {b}, {smooth})", distance: "aoSubtractDistance({a}, {b}, {smooth})" },
  { name: "intersect", type: "combine", description: "Keeps only where this solid and another overlap.",
    params: [param("smooth", 0, "Blend distance; 0 is a sharp edge.")],
    glsl: "aoIntersect({a}, {b}, {smooth})", distance: "aoIntersectDistance({a}, {b}, {smooth})" },
];

/** Options for `.out(source, options)`. */
export interface SolidOutOptions {
  /** Render at this fraction of the output resolution; lower is faster. Automatic unless given. */
  scale?: number | "auto";
  /** Camera distance from the centre. */
  camera?: SolidArg;
  /** Background and fog colour: one number for grey, or [r, g, b]. */
  background?: UniformValue;
  /** Strength of the rim light around edges. */
  glow?: SolidArg;
  /** Fraction of the distance each ray step takes; lower fixes torn spikes and twists, at a cost. */
  step?: SolidArg;
  /** How much of each frame lingers into the next, 0..1: light trails behind moving solids. */
  trails?: SolidArg;
}

export const solidOutParams: SolidParam[] = [
  param("source", "s0", "Source to render into, s0–s3; show it with src(s0).out()."),
  param("options", "{}", "{ scale, camera, background, glow, step, trails }: resolution fraction (\"auto\" by default: as sharp as the GPU keeps up with), camera distance (4), background colour ([0.02, 0.02, 0.04]), rim light (0.6), ray step (0.9), and how much of each frame lingers (none)."),
];

/**
 * GLSL for a solid at a point: a vec4 of colour and distance, or with a
 * distance-only compiler just the float distance, and bounds for the raymarcher.
 */
interface Emitted { value: string; reach: string; slope: string; bound: string }
type Emit = (compiler: Compiler, point: string) => Emitted;

/**
 * Writes one GLSL function for a chain. Rays march with the distance alone
 * and read the colour once where they hit, so a chain compiles twice; the
 * two compilers share the uniforms.
 */
class Compiler {
  readonly lines: string[] = [];
  private count = 0;

  constructor(
    readonly colour: boolean,
    readonly uniforms: Record<string, UniformValue> = {},
    /** Each call's uniform names, so both compilations of it read the same ones. */
    readonly bound = new Map<Resolved[], Record<string, string>>(),
  ) {}

  temp(prefix: string): string {
    return `${prefix}${this.count++}`;
  }

  uniform(name: string, value: UniformValue): string {
    let unique = name, n = 2;
    while (unique in this.uniforms) unique = `${name}_${n++}`;
    this.uniforms[unique] = value;
    return unique;
  }
}

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (value instanceof Solid) return "a solid";
  return String(value);
}

/** An argument, or for an omitted one whose default copies another, that parameter's name. */
type Resolved = SolidArg | { copies: string };

/** Checks each argument and fills in defaults, so mistakes fail when the line runs. */
function resolveArgs(fn: SolidFunction, args: unknown[]): Resolved[] {
  return fn.params.map((p, i) => {
    const value = args[i];
    if (value === undefined) return typeof p.default === "number" ? p.default : { copies: p.default };
    if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "function") return value as SolidArg;
    throw new Error(`${fn.name}(${p.name}): expected a number or a function, got ${show(value)}`);
  });
}

/** Fills `{name}` placeholders in a GLSL template. */
function fill(template: string, names: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => names[key]);
}

/**
 * Registers each argument as a uniform named after its function and
 * parameter. An omitted argument that copies another shares its uniform.
 */
function bind(compiler: Compiler, fn: SolidFunction, values: Resolved[]): Record<string, string> {
  const known = compiler.bound.get(values);
  if (known) return known;
  const names: Record<string, string> = {};
  fn.params.forEach((p, i) => {
    const value = values[i];
    names[p.name] = typeof value === "object" ? names[value.copies] : compiler.uniform(`${fn.name}_${p.name}`, value);
  });
  compiler.bound.set(values, names);
  return names;
}

/** Where `.out()` renders when given no source: the `s0` of the deck the chain was written on. */
type Home = () => unknown;

export class Solid {
  /** @internal `emit` writes GLSL for this solid at a point, returning a vec4 of colour and distance, or the distance alone. */
  constructor(readonly emit: Emit, readonly home: Home) {}

  /** Continues the chain with `fn(this, ...args)`, so a plain function chains like a method. */
  pipe(fn: unknown, ...args: unknown[]): Solid {
    if (typeof fn !== "function") throw new Error(`pipe: expected a function such as (s) => s.spin(), got ${show(fn)}`);
    const result: unknown = fn(this, ...args);
    if (!(result instanceof Solid)) throw new Error(`pipe: expected the function to return a solid, got ${show(result)}`);
    return result;
  }

  /** Renders this solid into a Hydra source, `s0` unless given. */
  out(source?: unknown, options: SolidOutOptions = {}): void {
    const draw = ((source ?? this.home()) as Record<symbol, DrawShader | undefined> | undefined)?.[DRAW_SHADER];
    if (typeof draw !== "function") throw new Error(`out: expected a source such as s0, got ${show(source)}`);
    const { code, uniforms } = compileSolid(this, options);
    // Raymarching costs every pixel dozens of steps; let the GPU's pace pick the resolution.
    draw(code, { scale: options.scale ?? "auto", uniforms });
  }
}

/**
 * The chain-starting functions, such as `sphere`, for one deck's sketches:
 * a chain's `.out()` with no source renders into `home()`.
 */
export function makeSolidShapes(home: Home): Record<string, (...args: unknown[]) => Solid> {
  return Object.fromEntries(solidFunctions.filter((fn) => fn.type === "shape").map((fn) => [fn.name, (...args: unknown[]) => {
    const values = resolveArgs(fn, args);
    return new Solid((compiler, point) => {
      const names = { ...bind(compiler, fn, values), p: point };
      const out = compiler.temp("s"), distance = fill(fn.glsl!, names);
      compiler.lines.push(compiler.colour ? `vec4 ${out} = vec4(vec3(0.85), ${distance});` : `float ${out} = ${distance};`);
      return { value: out, reach: "0.0", slope: "0.0", bound: `(${fill(fn.bound!, names)})` };
    }, home);
  }]));
}

/** Shapes for code outside a sketch's scope, such as the DevTools console: they render into the global `s0`. */
export const solidShapes = makeSolidShapes(() => (globalThis as Record<string, unknown>).s0);

for (const fn of solidFunctions) {
  if (fn.type === "shape") continue;
  if (fn.type === "modify") {
    Object.defineProperty(Solid.prototype, fn.name, {
      value(this: Solid, ...args: unknown[]) {
        const values = resolveArgs(fn, args);
        return new Solid((compiler, point) => {
          const names = bind(compiler, fn, values);
          let inner = point;
          if (fn.point) {
            inner = compiler.temp("p");
            compiler.lines.push(`vec3 ${inner} = ${fill(fn.point, { ...names, p: point })};`);
          }
          const before = this.emit(compiler, inner);
          let value = before.value;
          if (compiler.colour) {
            const color = fn.color ? fill(fn.color, { ...names, c: `${before.value}.rgb` }) : `${before.value}.rgb`;
            const distance = fn.distance ? fill(fn.distance, { ...names, p: inner, d: `${before.value}.a` }) : `${before.value}.a`;
            value = compiler.temp("s");
            compiler.lines.push(`vec4 ${value} = vec4(${color}, ${distance});`);
          } else if (fn.distance) {
            value = compiler.temp("s");
            compiler.lines.push(`float ${value} = ${fill(fn.distance, { ...names, p: inner, d: before.value })};`);
          }
          return {
            value,
            reach: fn.reach ? `(${fill(fn.reach, { ...names, reach: before.reach })})` : before.reach,
            slope: fn.slope ? `(${fill(fn.slope, { ...names, slope: before.slope })})` : before.slope,
            bound: fn.bound ? `(${fill(fn.bound, { ...names, bound: before.bound })})` : before.bound,
          };
        }, this.home);
      },
    });
  } else {
    Object.defineProperty(Solid.prototype, fn.name, {
      value(this: Solid, other: unknown, ...args: unknown[]) {
        if (!(other instanceof Solid)) throw new Error(`${fn.name}: expected a solid such as sphere(), got ${show(other)}`);
        const values = resolveArgs(fn, args);
        return new Solid((compiler, point) => {
          const a = this.emit(compiler, point), b = other.emit(compiler, point);
          const names: Record<string, string> = { ...bind(compiler, fn, values), a: a.value, b: b.value };
          const out = compiler.temp("s");
          compiler.lines.push(compiler.colour ? `vec4 ${out} = ${fill(fn.glsl!, names)};` : `float ${out} = ${fill(fn.distance!, names)};`);
          // A smooth blend moves the surface by up to a quarter of its distance.
          const blend = `0.25 * abs(${names.smooth})`;
          // Smooth cuts and overlaps only ever shrink a solid.
          const bound = fn.name === "add" ? `(max(${a.bound}, ${b.bound}) + ${blend})` : fn.name === "sub" ? a.bound : `min(${a.bound}, ${b.bound})`;
          return { value: out, reach: `(max(${a.reach}, ${b.reach}) + ${blend})`, slope: `max(${a.slope}, ${b.slope})`, bound };
        }, this.home);
      },
    });
  }
}

/** Helpers every solid's shader shares; the GLSL compiler drops the ones a chain doesn't use. */
const LIBRARY = `
vec3 aoDirection(vec3 p) { return p / max(length(p), 1e-4); }
mat2 aoTurn(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec3 aoRotate(vec3 p, vec3 a) {
  p.xy *= aoTurn(a.z);
  p.xz *= aoTurn(a.y);
  p.yz *= aoTurn(a.x);
  return p;
}
vec3 aoRepeat(vec3 p, vec3 s, float count) {
  vec3 safe = max(abs(s), vec3(1e-4));
  vec3 cell = round(p / safe);
  // A count keeps the copies centred: indices 0..n-1, shifted by half of n-1.
  float n = max(round(count), 1.0), middle = 0.5 * (n - 1.0);
  vec3 limited = clamp(round(p / safe + middle), 0.0, n - 1.0) - middle;
  cell = mix(cell, limited, step(0.5, count));
  return mix(p, p - safe * cell, step(1e-4, abs(s)));
}
vec3 aoRadial(vec3 p, float count) {
  float slice = 6.28318531 / max(round(count), 1.0);
  float a = mod(atan(p.z, p.x) + 0.5 * slice, slice) - 0.5 * slice;
  return vec3(length(p.xz) * cos(a), p.y, length(p.xz) * sin(a));
}
vec3 aoElongate(vec3 p, vec3 e) { vec3 h = 0.5 * abs(e); return p - clamp(p, -h, h); }
vec3 aoTwist(vec3 p, float k) { p.xz *= aoTurn(k * p.y); return p; }
vec3 aoBend(vec3 p, float k) { p.xy *= aoTurn(k * p.x); return p; }
float aoTaperWidth(float y, float k) { return max(1.0 + k * y, 0.05); }
vec3 aoTaper(vec3 p, float k) { float w = aoTaperWidth(p.y, k); return vec3(p.x / w, p.y, p.z / w); }
float aoBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float aoCylinder(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, 0.5 * h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float aoSpikes(vec3 p, float density, float sharpness, float variety) {
  vec3 d = aoDirection(p);
  float lattice = abs(sin(density * d.x) * sin(density * d.y) * sin(density * d.z));
  // Each spike peaks inside its own cell of the lattice, and the lattice is 0
  // on the cell walls, so a length picked per cell never tears the surface.
  vec3 cell = floor(density * d / 3.14159265);
  float own = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  return pow(lattice, max(sharpness, 0.01)) * mix(1.0, own, clamp(variety, 0.0, 1.0));
}
float aoWobble(vec3 p, float f, float speed) {
  vec3 d = aoDirection(p);
  float t = iTime * speed;
  return sin(f * d.x + t) * sin(f * d.y + 1.3 * t) * sin(f * d.z + 0.7 * t);
}
float aoHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float aoNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(aoHash(i), aoHash(i + vec3(1, 0, 0)), f.x),
                 mix(aoHash(i + vec3(0, 1, 0)), aoHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(aoHash(i + vec3(0, 0, 1)), aoHash(i + vec3(1, 0, 1)), f.x),
                 mix(aoHash(i + vec3(0, 1, 1)), aoHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 aoWarp(vec3 x) {
  return 2.0 * vec3(aoNoise(x), aoNoise(x + vec3(31.4, 7.1, 17.3)), aoNoise(x + vec3(5.2, 43.7, 23.9))) - 1.0;
}
/** 1 on the walls between Voronoi cells, falling to 0 a little way inside each. */
float aoCracks(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  float first = 8.0, second = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int w = -1; w <= 1; w++) {
    vec3 o = vec3(w, y, z);
    vec3 centre = o + vec3(aoHash(i + o), aoHash(i + o + 19.1), aoHash(i + o + 47.3));
    float d = length(centre - f);
    second = max(min(second, d), first);
    first = min(first, d);
  }
  return 1.0 - clamp((second - first) / 0.3, 0.0, 1.0);
}
/** The waveform around the equator, mirrored so it has no seam, fading out at the poles. */
float aoWaveform(vec3 p) {
  return aoWaveAt(abs(atan(p.z, p.x)) / 3.14159265) * length(aoDirection(p).xz);
}
float aoOnion(float d, float count, float gap, float thickness) {
  float layer = clamp(round(-d / max(gap, 1e-4)), 0.0, max(round(count), 1.0) - 1.0);
  return abs(d + layer * gap) - thickness;
}
float aoUnionDistance(float a, float b, float k) {
  k = max(k, 1e-4);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float aoSubtractDistance(float a, float b, float k) {
  k = max(k, 1e-4);
  float h = clamp(0.5 - 0.5 * (a + b) / k, 0.0, 1.0);
  return mix(a, -b, h) + k * h * (1.0 - h);
}
float aoIntersectDistance(float a, float b, float k) {
  k = max(k, 1e-4);
  float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}
vec4 aoUnion(vec4 a, vec4 b, float k) {
  float h = clamp(0.5 + 0.5 * (b.a - a.a) / max(k, 1e-4), 0.0, 1.0);
  return vec4(mix(b.rgb, a.rgb, h), aoUnionDistance(a.a, b.a, k));
}
vec4 aoSubtract(vec4 a, vec4 b, float k) {
  return vec4(a.rgb, aoSubtractDistance(a.a, b.a, k));
}
vec4 aoIntersect(vec4 a, vec4 b, float k) {
  float h = clamp(0.5 - 0.5 * (b.a - a.a) / max(k, 1e-4), 0.0, 1.0);
  return vec4(mix(b.rgb, a.rgb, h), aoIntersectDistance(a.a, b.a, k));
}
`;

const RENDER = `
// Four samples at the corners of a tetrahedron, rather than six on the axes.
vec3 aoNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0012;
  return normalize(k.xyy * aoDist(p + k.xyy * e) + k.yyx * aoDist(p + k.yyx * e) +
                   k.yxy * aoDist(p + k.yxy * e) + k.xxx * aoDist(p + k.xxx * e));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  vec3 ro = vec3(0.0, 0.0, aoCamera), rd = normalize(vec3(uv, -1.8));
  // The background is given as it should look; lighting works before gamma.
  vec3 background = pow(max(aoBackground, 0.0), vec3(2.2)) * (1.0 - 0.25 * dot(uv, uv));

  // Surface detail makes distances overestimate: far away, step by the
  // distance less how far the detail reaches; close up, by a fraction of it.
  float reach = aoReach(), slope = 1.0 + aoSlope();
  // March only where the ray crosses the sphere the solid fits inside.
  float radius = aoBound() + 0.05, b = dot(ro, rd), h = b * b - dot(ro, ro) + radius * radius;
  float t = max(-b - sqrt(max(h, 0.0)), 0.0), far = h < 0.0 ? -1.0 : min(-b + sqrt(h), 40.0);
  bool found = false;
  // A ray grazing a steep surface, such as the base of a spike, creeps along
  // it in tiny steps and can run out of them; shade it where it came closest.
  float closestT = 0.0, closest = 1e9;
  for (int i = 0; i < 200; i++) {
    if (t > far) break;
    float d = aoDist(ro + rd * t);
    float gap = abs(d) / (1.0 + t);
    if (gap < 0.0005) { found = true; break; }
    if (gap < closest) { closest = gap; closestT = t; }
    t += aoStep * max(d - reach, d / slope);
  }
  if (!found && t <= far && closest < 0.02) { found = true; t = closestT; }

  vec3 colour = background;
  if (found) {
    vec3 p = ro + rd * t, n = aoNormal(p);
    vec4 hit = aoMap(p);
    vec3 light = normalize(vec3(0.6, 0.8, 0.5));
    float diffuse = max(dot(n, light), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    float specular = pow(max(dot(reflect(rd, n), light), 0.0), 40.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    colour = hit.rgb * (0.1 + 0.75 * diffuse + 0.2 * sky) + 0.5 * specular + aoGlow * rim * hit.rgb;
    float fog = 1.0 - exp(-0.004 * pow(max(t - aoCamera, 0.0), 2.0));
    colour = mix(colour, background, fog);
  }
  fragColor = aoFinish(pow(max(colour, 0.0), vec3(0.4545)), fragCoord);
}
`;

const FINISH = "vec4 aoFinish(vec3 colour, vec2 fragCoord) { return vec4(colour, 1.0); }";

/** Keeps the brighter of this frame and the last one, faded: light trails. */
const FINISH_TRAILS = `
vec4 aoFinish(vec3 colour, vec2 fragCoord) {
  vec3 last = texture(aoPrevious, fragCoord / iResolution.xy).rgb;
  return vec4(max(colour, last * clamp(aoTrails, 0.0, 1.0)), 1.0);
}`;

/** Compiles a solid into a shader and the uniforms that drive it. */
export function compileSolid(solid: Solid, options: SolidOutOptions = {}): { code: string; uniforms: Record<string, UniformValue> } {
  const compiler = new Compiler(true);
  const setting = (name: string, value: UniformValue | undefined, fallback: UniformValue) => {
    if (value !== undefined && typeof value !== "number" && typeof value !== "function" && !Array.isArray(value)) {
      throw new Error(`out(${name}): expected a number or a function, got ${show(value)}`);
    }
    compiler.uniforms[`ao${name[0].toUpperCase()}${name.slice(1)}`] = value ?? fallback;
  };
  setting("camera", options.camera, 4);
  setting("background", options.background, [0.02, 0.02, 0.04]);
  setting("glow", options.glow, 0.6);
  setting("step", options.step, 0.9);
  // Only chains with trails read the last frame, so only they pay to keep it.
  if (options.trails !== undefined) setting("trails", options.trails, 0);
  const result = solid.emit(compiler, "p");
  const distance = new Compiler(false, compiler.uniforms, compiler.bound);
  const distanceResult = solid.emit(distance, "p");
  const declarations = Object.keys(compiler.uniforms)
    .map((name) => `uniform ${name === "aoBackground" ? "vec3" : "float"} ${name};`);
  const code = [
    ...declarations,
    LIBRARY,
    "vec4 aoMap(vec3 p) {",
    ...compiler.lines.map((line) => `  ${line}`),
    `  return ${result.value};`,
    "}",
    "float aoDist(vec3 p) {",
    ...distance.lines.map((line) => `  ${line}`),
    `  return ${distanceResult.value};`,
    "}",
    `float aoBound() { return ${result.bound}; }`,
    `float aoReach() { return ${result.reach}; }`,
    `float aoSlope() { return ${result.slope}; }`,
    options.trails === undefined ? FINISH : FINISH_TRAILS,
    RENDER,
  ].join("\n");
  return { code, uniforms: compiler.uniforms };
}
