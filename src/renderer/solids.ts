import type { SceneOptions, UniformValue } from "./scenes";

/**
 * Solids: 3D shapes written like Hydra chains and raymarched as a GLSL scene.
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
  /** modify: the point the chain before it sees, from `{p}`. */
  point?: string;
  /** modify: the new distance, from the chain's distance `{d}` at point `{p}`. */
  distance?: string;
  /** modify: the new colour, replacing the chain's. */
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
    glsl: "length({p}) - {radius}" },
  { name: "box", type: "shape", description: "A box centred on the origin.",
    params: [param("width", 1.4, "Size along x."), param("height", "width", "Size along y; defaults to width."), param("depth", "width", "Size along z; defaults to width.")],
    glsl: "aoBox({p}, 0.5 * vec3({width}, {height}, {depth}))" },
  { name: "torus", type: "shape", description: "A ring lying flat in the x-z plane.",
    params: [param("radius", 1, "Distance from the centre to the middle of the tube."), param("thickness", 0.3, "Radius of the tube.")],
    glsl: "length(vec2(length({p}.xz) - {radius}, {p}.y)) - {thickness}" },
  { name: "cylinder", type: "shape", description: "An upright cylinder centred on the origin.",
    params: [param("radius", 0.6, "Radius."), param("height", 1.6, "Height along y.")],
    glsl: "aoCylinder({p}, {radius}, {height})" },
  { name: "octahedron", type: "shape", description: "An eight-sided diamond.",
    params: [param("size", 1.2, "Distance from the centre to each point.")],
    glsl: "(dot(abs({p}), vec3(1.0)) - {size}) * 0.57735" },
  { name: "plane", type: "shape", description: "An endless floor; pair it with repeat for fields of shapes.",
    params: [param("height", -1, "Height of the floor; below 0 is under the centre.")],
    glsl: "{p}.y - {height}" },
  // Placement
  { name: "move", type: "modify", description: "Moves the solid.",
    params: [param("x", 0, "Right."), param("y", 0, "Up."), param("z", 0, "Towards the camera.")],
    point: "{p} - vec3({x}, {y}, {z})" },
  { name: "rotate", type: "modify", description: "Turns the solid by fixed angles, in radians.",
    params: [param("x", 0, "Tilt around the x axis."), param("y", 0, "Turn around the upright y axis."), param("z", 0, "Roll around the z axis, facing the camera.")],
    point: "aoRotate({p}, vec3({x}, {y}, {z}))" },
  { name: "spin", type: "modify", description: "Keeps the solid turning, in radians per second.",
    params: [param("x", 0, "Speed around the x axis."), param("y", 0.5, "Speed around the upright y axis."), param("z", 0, "Speed around the z axis.")],
    point: "aoRotate({p}, vec3({x}, {y}, {z}) * iTime)" },
  { name: "scale", type: "modify", description: "Grows or shrinks the solid.",
    params: [param("amount", 1, "Size factor: above 1 grows, below 1 shrinks.")],
    point: "{p} / {amount}", distance: "{d} * {amount}", reach: "{reach} * abs({amount})" },
  { name: "repeat", type: "modify", description: "Repeats the solid endlessly along each axis.",
    params: [param("x", 3, "Spacing along x; 0 doesn't repeat."), param("y", 0, "Spacing along y; 0 doesn't repeat."), param("z", 3, "Spacing along z; 0 doesn't repeat.")],
    point: "aoRepeat({p}, vec3({x}, {y}, {z}))" },
  { name: "twist", type: "modify", description: "Twists the solid around its upright axis; large amounts may tear.",
    params: [param("amount", 1, "Radians of twist per unit of height.")],
    point: "aoTwist({p}, {amount})", reach: "1e6", slope: "{slope} + 2.0 * abs({amount})" },
  // Surface
  { name: "spikes", type: "modify", description: "Pushes sharp spikes out of the surface; drive the length with the music.",
    params: [param("length", 0.3, "How far the spikes reach; 0 is smooth."), param("density", 8, "How many spikes: higher packs in more, thinner ones."), param("sharpness", 4, "Higher makes needles, lower makes soft bumps.")],
    distance: "{d} - {length} * aoSpikes({p}, {density}, {sharpness})",
    reach: "{reach} + abs({length})", slope: "{slope} + 0.5 * abs({length} * {density}) * sqrt(max({sharpness}, 1.0))" },
  { name: "wobble", type: "modify", description: "A slow, liquid swell over the surface.",
    params: [param("amount", 0.1, "How far the surface moves."), param("frequency", 3, "Number of swells across the solid."), param("speed", 1, "How fast the swells move.")],
    distance: "{d} - {amount} * aoWobble({p}, {frequency}, {speed})",
    reach: "{reach} + 2.0 * abs({amount})", slope: "{slope} + abs({amount} * {frequency})" },
  { name: "noise", type: "modify", description: "Lumpy, evolving noise over the surface.",
    params: [param("amount", 0.15, "How far the surface moves."), param("scale", 2, "Noise frequency; higher gives finer lumps."), param("speed", 0.5, "How fast the noise evolves.")],
    distance: "{d} - {amount} * (2.0 * aoNoise({p} * {scale} + iTime * {speed}) - 1.0)",
    reach: "{reach} + 2.0 * abs({amount})", slope: "{slope} + 2.0 * abs({amount} * {scale})" },
  { name: "spectrum", type: "modify", description: "Pushes the surface out by the spectrum: lows at the bottom, highs at the top.",
    params: [param("amount", 0.4, "How far a full-level band pushes out.")],
    distance: "{d} - {amount} * aoFFT(0.5 + 0.5 * aoDirection({p}).y)",
    reach: "{reach} + abs({amount})", slope: "{slope} + 8.0 * abs({amount})" },
  { name: "round", type: "modify", description: "Rounds edges by growing the solid outwards.",
    params: [param("radius", 0.1, "Rounding radius.")],
    distance: "{d} - {radius}" },
  { name: "shell", type: "modify", description: "Hollows the solid into a thin skin; cut it open with sub to see inside.",
    params: [param("thickness", 0.05, "Thickness of the skin.")],
    distance: "abs({d}) - {thickness}" },
  // Material
  { name: "color", type: "modify", description: "Colours the solid; values above 1 glow brighter.",
    params: [param("r", 1, "Red."), param("g", 1, "Green."), param("b", 1, "Blue.")],
    color: "vec3({r}, {g}, {b})" },
  // Combining
  { name: "add", type: "combine", description: "Joins another solid to this one; smooth melts them together like liquid.",
    params: [param("smooth", 0, "Blend distance; 0 is a hard join, 0.5 is very blobby.")],
    glsl: "aoUnion({a}, {b}, {smooth})" },
  { name: "sub", type: "combine", description: "Cuts another solid out of this one.",
    params: [param("smooth", 0, "Blend distance; 0 is a sharp cut.")],
    glsl: "aoSubtract({a}, {b}, {smooth})" },
  { name: "intersect", type: "combine", description: "Keeps only where this solid and another overlap.",
    params: [param("smooth", 0, "Blend distance; 0 is a sharp edge.")],
    glsl: "aoIntersect({a}, {b}, {smooth})" },
];

/** Options for `.out(source, options)`. */
export interface SolidOutOptions {
  /** Render at this fraction of the output resolution; lower is faster. */
  scale?: number;
  /** Camera distance from the centre. */
  camera?: SolidArg;
  /** Background and fog colour: one number for grey, or [r, g, b]. */
  background?: UniformValue;
  /** Strength of the rim light around edges. */
  glow?: SolidArg;
  /** Fraction of the distance each ray step takes; lower fixes torn spikes and twists, at a cost. */
  step?: SolidArg;
}

export const solidOutParams: SolidParam[] = [
  param("source", "s0", "Source to render into, s0–s3; show it with src(s0).out()."),
  param("options", "{}", "{ scale, camera, background, glow, step }: resolution fraction, camera distance (4), background colour ([0.02, 0.02, 0.04]), rim light (0.6), and ray step (0.9)."),
];

/** GLSL for a solid at a point: a vec4 of colour and distance, and bounds for the raymarcher. */
interface Emitted { value: string; reach: string; slope: string }
type Emit = (compiler: Compiler, point: string) => Emitted;

class Compiler {
  readonly lines: string[] = [];
  readonly uniforms: Record<string, UniformValue> = {};
  private count = 0;

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
  const names: Record<string, string> = {};
  fn.params.forEach((p, i) => {
    const value = values[i];
    names[p.name] = typeof value === "object" ? names[value.copies] : compiler.uniform(`${fn.name}_${p.name}`, value);
  });
  return names;
}

/** Where `.out()` renders when given no source: the `s0` of the deck the chain was written on. */
type Home = () => unknown;

export class Solid {
  /** @internal `emit` writes GLSL for this solid at a point, returning a vec4 of colour and distance. */
  constructor(readonly emit: Emit, readonly home: Home) {}

  /** Renders this solid into a Hydra source, `s0` unless given. */
  out(source?: unknown, options: SolidOutOptions = {}): void {
    const target = (source ?? this.home()) as { initScene?: (code: string, options?: SceneOptions) => void } | undefined;
    if (typeof target?.initScene !== "function") throw new Error(`out: expected a source such as s0, got ${show(source)}`);
    const { code, uniforms } = compileSolid(this, options);
    target.initScene(code, { scale: options.scale, uniforms });
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
      const out = compiler.temp("s");
      compiler.lines.push(`vec4 ${out} = vec4(vec3(0.85), ${fill(fn.glsl!, names)});`);
      return { value: out, reach: "0.0", slope: "0.0" };
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
          const color = fn.color ? fill(fn.color, names) : `${before.value}.rgb`;
          const distance = fn.distance ? fill(fn.distance, { ...names, p: inner, d: `${before.value}.a` }) : `${before.value}.a`;
          const out = compiler.temp("s");
          compiler.lines.push(`vec4 ${out} = vec4(${color}, ${distance});`);
          return {
            value: out,
            reach: fn.reach ? `(${fill(fn.reach, { ...names, reach: before.reach })})` : before.reach,
            slope: fn.slope ? `(${fill(fn.slope, { ...names, slope: before.slope })})` : before.slope,
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
          compiler.lines.push(`vec4 ${out} = ${fill(fn.glsl!, names)};`);
          // A smooth blend moves the surface by up to a quarter of its distance.
          return { value: out, reach: `(max(${a.reach}, ${b.reach}) + 0.25 * abs(${names.smooth}))`, slope: `max(${a.slope}, ${b.slope})` };
        }, this.home);
      },
    });
  }
}

/** Helpers every solid scene shares; the GLSL compiler drops the ones a chain doesn't use. */
const LIBRARY = `
vec3 aoDirection(vec3 p) { return p / max(length(p), 1e-4); }
mat2 aoTurn(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec3 aoRotate(vec3 p, vec3 a) {
  p.xy *= aoTurn(a.z);
  p.xz *= aoTurn(a.y);
  p.yz *= aoTurn(a.x);
  return p;
}
vec3 aoRepeat(vec3 p, vec3 s) {
  vec3 safe = max(abs(s), vec3(1e-4));
  return mix(p, p - safe * round(p / safe), step(1e-4, abs(s)));
}
vec3 aoTwist(vec3 p, float k) { p.xz *= aoTurn(k * p.y); return p; }
float aoBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float aoCylinder(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, 0.5 * h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float aoSpikes(vec3 p, float density, float sharpness) {
  vec3 d = aoDirection(p);
  float lattice = abs(sin(density * d.x) * sin(density * d.y) * sin(density * d.z));
  return pow(lattice, max(sharpness, 0.01));
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
vec4 aoUnion(vec4 a, vec4 b, float k) {
  k = max(k, 1e-4);
  float h = clamp(0.5 + 0.5 * (b.a - a.a) / k, 0.0, 1.0);
  return vec4(mix(b.rgb, a.rgb, h), mix(b.a, a.a, h) - k * h * (1.0 - h));
}
vec4 aoSubtract(vec4 a, vec4 b, float k) {
  k = max(k, 1e-4);
  float h = clamp(0.5 - 0.5 * (a.a + b.a) / k, 0.0, 1.0);
  return vec4(a.rgb, mix(a.a, -b.a, h) + k * h * (1.0 - h));
}
vec4 aoIntersect(vec4 a, vec4 b, float k) {
  k = max(k, 1e-4);
  float h = clamp(0.5 - 0.5 * (b.a - a.a) / k, 0.0, 1.0);
  return vec4(mix(b.rgb, a.rgb, h), mix(b.a, a.a, h) + k * h * (1.0 - h));
}
`;

const RENDER = `
vec3 aoNormal(vec3 p) {
  vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(aoMap(p + e.xyy).a - aoMap(p - e.xyy).a,
                        aoMap(p + e.yxy).a - aoMap(p - e.yxy).a,
                        aoMap(p + e.yyx).a - aoMap(p - e.yyx).a));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  vec3 ro = vec3(0.0, 0.0, aoCamera), rd = normalize(vec3(uv, -1.8));
  // The background is given as it should look; lighting works before gamma.
  vec3 background = pow(max(aoBackground, 0.0), vec3(2.2)) * (1.0 - 0.25 * dot(uv, uv));

  // Surface detail makes distances overestimate: far away, step by the
  // distance less how far the detail reaches; close up, by a fraction of it.
  float reach = aoReach(), slope = 1.0 + aoSlope();
  float t = 0.0;
  vec4 hit = vec4(0.0);
  bool found = false;
  for (int i = 0; i < 200; i++) {
    hit = aoMap(ro + rd * t);
    if (abs(hit.a) < 0.0005 * (1.0 + t)) { found = true; break; }
    t += aoStep * max(hit.a - reach, hit.a / slope);
    if (t > 40.0) break;
  }

  vec3 colour = background;
  if (found) {
    vec3 p = ro + rd * t, n = aoNormal(p);
    vec3 light = normalize(vec3(0.6, 0.8, 0.5));
    float diffuse = max(dot(n, light), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    float specular = pow(max(dot(reflect(rd, n), light), 0.0), 40.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    colour = hit.rgb * (0.1 + 0.75 * diffuse + 0.2 * sky) + 0.5 * specular + aoGlow * rim * hit.rgb;
    float fog = 1.0 - exp(-0.004 * pow(max(t - aoCamera, 0.0), 2.0));
    colour = mix(colour, background, fog);
  }
  fragColor = vec4(pow(max(colour, 0.0), vec3(0.4545)), 1.0);
}
`;

/** Compiles a solid into a scene shader and the uniforms that drive it. */
export function compileSolid(solid: Solid, options: SolidOutOptions = {}): { code: string; uniforms: Record<string, UniformValue> } {
  const compiler = new Compiler();
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
  const result = solid.emit(compiler, "p");
  const declarations = Object.keys(compiler.uniforms)
    .map((name) => `uniform ${name === "aoBackground" ? "vec3" : "float"} ${name};`);
  const code = [
    ...declarations,
    LIBRARY,
    "vec4 aoMap(vec3 p) {",
    ...compiler.lines.map((line) => `  ${line}`),
    `  return ${result.value};`,
    "}",
    `float aoReach() { return ${result.reach}; }`,
    `float aoSlope() { return ${result.slope}; }`,
    RENDER,
  ].join("\n");
  return { code, uniforms: compiler.uniforms };
}
