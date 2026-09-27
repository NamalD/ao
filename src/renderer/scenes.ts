import type { AudioFeatures } from "../shared/features";

export type UniformValue = number | number[] | (() => number | number[]);
export interface SceneOptions {
  /** Render at this fraction of the output resolution; lower is faster. */
  scale?: number;
  /** Extra uniforms, declared in the shader as `uniform float name;` (or vec2..vec4). */
  uniforms?: Record<string, UniformValue>;
}

export interface UniformResult {
  /** Exactly `size` finite numbers, safe to upload. */
  value: number[];
  /** Set when the value had to be replaced or corrected. */
  error?: string;
}

/**
 * Evaluates a user uniform for a GLSL uniform of `size` floats (1 for float,
 * up to 4 for vec4). A function that throws or returns something unusable
 * falls back to zeros instead of breaking the frame; a single number fills a
 * vector, as GLSL's `vec3(x)` does. Pure, so the frame loop can rely on it.
 */
export function evaluateUniform(name: string, uniform: UniformValue, size: number): UniformResult {
  const zeros = () => new Array<number>(size).fill(0);
  let raw: unknown = uniform;
  if (typeof uniform === "function") {
    try {
      raw = uniform();
    } catch (e) {
      return { value: zeros(), error: `uniform ${name}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const expected = size === 1 ? "a number" : `a number or ${size} numbers`;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { value: zeros(), error: `uniform ${name} is ${raw}, expected ${expected}` };
    return { value: new Array<number>(size).fill(raw) };
  }
  const list = Array.isArray(raw) || ArrayBuffer.isView(raw) ? Array.from(raw as ArrayLike<unknown>) : null;
  if (!list || !list.every((x) => typeof x === "number" && Number.isFinite(x))) {
    const shown = typeof raw === "string" ? JSON.stringify(raw) : list ? `[${list.map(String).join(", ")}]` : String(raw);
    return { value: zeros(), error: `uniform ${name} is ${shown}, expected ${expected}` };
  }
  const numbers = list as number[];
  if (numbers.length === size) return { value: numbers };
  const value = zeros();
  for (let i = 0; i < Math.min(size, numbers.length); i++) value[i] = numbers[i];
  return { value, error: `uniform ${name} has ${numbers.length} values, expected ${size}` };
}

/** Float components per active uniform type: float, vec2, vec3, vec4. */
const FLOAT_SIZES: Record<number, number> = { 0x1406: 1, 0x8b50: 2, 0x8b51: 3, 0x8b52: 4 };

/**
 * Shadertoy-style GLSL ES 3.0 prelude. Scenes define
 * `void mainImage(out vec4 fragColor, in vec2 fragCoord)`.
 */
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform float aoLoudness;
uniform float aoImpulse;
uniform float aoBeat;
uniform float aoBass;
uniform float aoMid;
uniform float aoHigh;
uniform sampler2D aoSpectrum;
/** Band level at x in 0..1, low to high frequency. */
float aoFFT(float x) { return texture(aoSpectrum, vec2(clamp(x, 0., 1.), .5)).r; }
out vec4 aoFragColor;
`;

const MAIN = `
void main() {
  vec4 colour = vec4(0., 0., 0., 1.);
  mainImage(colour, gl_FragCoord.xy);
  aoFragColor = vec4(colour.rgb, 1.);
}
`;

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0., 1.); }
`;

export const PRELUDE_LINES = PRELUDE.split("\n").length - 1;

/** Rewrites driver error line numbers so they refer to the scene source. */
export function formatShaderLog(log: string): string {
  return log.replace(/(ERROR: \d+:)(\d+)/g, (_m, prefix: string, line: string) =>
    `${prefix}${Math.max(1, Number(line) - PRELUDE_LINES)}`).trim();
}

interface UniformInfo { location: WebGLUniformLocation; size: number }

/** One WebGL2 canvas that renders a scene each frame, used as a Hydra source. */
export class Scene {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private code = "";
  private spectrum: WebGLTexture;
  private spectrumData = new Float32Array(0);
  private uniforms = new Map<string, UniformInfo>();
  private setters: ((at: WebGLUniformLocation, v: number[]) => void)[];
  private frame = 0;
  options: SceneOptions = {};

  /** `onError` hears about uniforms that threw or returned unusable values. */
  constructor(private readonly onError: (message: string) => void = () => {}) {
    const gl = this.canvas.getContext("webgl2", { antialias: false, depth: false, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    this.setters = [
      (at, v) => gl.uniform1fv(at, v), (at, v) => gl.uniform2fv(at, v),
      (at, v) => gl.uniform3fv(at, v), (at, v) => gl.uniform4fv(at, v),
    ];
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.spectrum = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.spectrum);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Compiles `code` unless it is already running. Throws and keeps the old program on error. */
  load(code: string, options: SceneOptions = {}): void {
    this.options = options;
    if (code === this.code && this.program) return;
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? "unknown error";
        gl.deleteShader(shader);
        throw new Error(`scene shader: ${formatShaderLog(log)}`);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, PRELUDE + code + MAIN);
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "position");
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`scene link: ${log}`);
    }
    if (this.program) gl.deleteProgram(this.program);
    this.program = program;
    this.code = code;
    this.frame = 0;
    // Active uniforms only: the compiler drops the ones a shader doesn't use.
    this.uniforms.clear();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      const location = info && gl.getUniformLocation(program, info.name);
      if (info && location) this.uniforms.set(info.name, { location, size: FLOAT_SIZES[info.type] ?? 0 });
    }
  }

  render(width: number, height: number, time: number, dt: number, audio: AudioFeatures): void {
    if (!this.program) return;
    const gl = this.gl;
    const scale = this.options.scale ?? 1;
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spectrum);
    this.uploadSpectrum(audio.spectrum);
    this.uniform("iResolution", [w, h, 1]);
    this.uniform("iTime", time);
    this.uniform("iTimeDelta", dt);
    this.uniformInt("iFrame", this.frame++);
    this.uniform("aoLoudness", audio.loudness);
    this.uniform("aoImpulse", audio.impulse);
    this.uniform("aoBeat", audio.beat);
    this.uniform("aoBass", audio.bass);
    this.uniform("aoMid", audio.mid);
    this.uniform("aoHigh", audio.high);
    this.uniformInt("aoSpectrum", 0);
    for (const [name, value] of Object.entries(this.options.uniforms ?? {})) {
      const info = this.uniforms.get(name);
      if (!info) continue; // undeclared, or unused and optimized away
      if (!info.size) {
        this.onError(`uniform ${name} must be declared as float or vec2..vec4`);
        continue;
      }
      const result = evaluateUniform(name, value, info.size);
      if (result.error) this.onError(result.error);
      this.setters[info.size - 1](info.location, result.value);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Streams the spectrum into texture storage that is allocated once per length. */
  private uploadSpectrum(spectrum: readonly number[]): void {
    const gl = this.gl;
    if (this.spectrumData.length !== spectrum.length) {
      this.spectrumData = new Float32Array(spectrum.length);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, Math.max(1, spectrum.length), 1, 0, gl.RED, gl.FLOAT, null);
    }
    if (!spectrum.length) return;
    this.spectrumData.set(spectrum);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, spectrum.length, 1, gl.RED, gl.FLOAT, this.spectrumData);
  }

  private uniform(name: string, value: number | number[]): void {
    const info = this.uniforms.get(name);
    if (!info?.size) return;
    if (typeof value === "number") this.gl.uniform1f(info.location, value);
    else this.setters[info.size - 1](info.location, value);
  }

  private uniformInt(name: string, value: number): void {
    const info = this.uniforms.get(name);
    if (info) this.gl.uniform1i(info.location, value);
  }
}
