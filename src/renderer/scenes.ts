import type { AudioFeatures } from "../shared/features";
import { sceneResolution } from "./resolution";
import { spectrogram, SpectrumHistory } from "./spectrogram";
import { barNow, clock, phaseNow } from "./tempo";

export type UniformValue = number | number[] | (() => number | number[]);
export interface SceneOptions {
  /**
   * Render at this fraction of the output resolution; lower is faster.
   * "auto" picks it from how long the GPU takes (see resolution.ts).
   */
  scale?: number | "auto";
  /** Extra uniforms, declared in the shader as `uniform float name;` (or vec2..vec4). */
  uniforms?: Record<string, UniformValue>;
  /**
   * Up to four state passes, each GLSL defining `mainImage`, run in order
   * before the scene each frame into float textures that keep their output:
   * `aoBuffer0`..`aoBuffer3` in every pass.
   */
  buffers?: string[];
}

export const MAX_BUFFERS = 4;

/**
 * The GLSL sources for a scene: its buffers in order, then the image. Throws
 * on options that can't work, so a mistake fails when the line runs.
 */
export function sceneSources(code: string, options: SceneOptions = {}): string[] {
  if (typeof code !== "string") throw new Error(`initScene: expected GLSL source, got ${typeof code}`);
  const buffers = options.buffers ?? [];
  if (!Array.isArray(buffers)) throw new Error("initScene buffers: expected an array of GLSL strings, such as [velocity, dye]");
  if (buffers.length > MAX_BUFFERS) throw new Error(`initScene buffers: at most ${MAX_BUFFERS}, got ${buffers.length}`);
  const scale = options.scale;
  if (scale !== undefined && scale !== "auto" && !(typeof scale === "number" && scale > 0 && Number.isFinite(scale))) {
    throw new Error(`initScene scale: expected a number above 0 or "auto", got ${typeof scale === "string" ? JSON.stringify(scale) : String(scale)}`);
  }
  buffers.forEach((buffer, i) => {
    if (typeof buffer !== "string") throw new Error(`initScene buffers[${i}]: expected GLSL source, got ${typeof buffer}`);
  });
  return [...buffers, code];
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
uniform float aoEnergy;
uniform float aoDrop;
uniform float aoBpm;
uniform float aoPhase;
uniform float aoBar;
uniform sampler2D aoSpectrum;
/** Band level at x in 0..1, low to high frequency. */
float aoFFT(float x) { return texture(aoSpectrum, vec2(clamp(x, 0., 1.), .5)).r; }
// Waveform, spectrogram history, stereo image and chroma.
uniform sampler2D aoWave;
uniform sampler2D aoSpectrogram;
uniform float aoSpectrogramRow;
uniform float aoBalance;
uniform float aoWidth;
uniform float aoChroma[12];
uniform float aoKey;
// State buffers: this frame's output for buffers that already ran, the
// previous frame's for the rest. aoPrevious is this pass's previous frame.
uniform sampler2D aoBuffer0;
uniform sampler2D aoBuffer1;
uniform sampler2D aoBuffer2;
uniform sampler2D aoBuffer3;
uniform sampler2D aoPrevious;
#define iChannel0 aoBuffer0
#define iChannel1 aoBuffer1
#define iChannel2 aoBuffer2
#define iChannel3 aoBuffer3
/** Waveform at x in 0..1 across the newest ~21 ms, -1..1. */
float aoWaveAt(float x) { return texture(aoWave, vec2(clamp(x, 0., 1.), .5)).r; }
/** Band level at x (0..1, low to high) as it was age ago: 0 newest, 1 oldest (~5 s). */
float aoHistory(float x, float age) {
  float rows = float(textureSize(aoSpectrogram, 0).y);
  float row = aoSpectrogramRow - clamp(age, 0., 1.) * (rows - 1.);
  return texture(aoSpectrogram, vec2(clamp(x, 0., 1.), (row + .5) / rows)).r;
}
out vec4 aoFragColor;
`;

const MAIN = `
void main() {
  vec4 colour = vec4(0., 0., 0., 1.);
  mainImage(colour, gl_FragCoord.xy);
  aoFragColor = vec4(colour.rgb, 1.);
}
`;

/**
 * Buffers keep alpha. Half floats top out at 65504, and one NaN would spread
 * through the state for good, so those pixels are stored as zero instead.
 */
const BUFFER_MAIN = `
void main() {
  vec4 colour = vec4(0.);
  mainImage(colour, gl_FragCoord.xy);
  aoFragColor = mix(clamp(colour, -65504., 65504.), vec4(0.), bvec4(isnan(colour)));
}
`;

/** Copies or resamples a texture across the whole target. */
const COPY = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 size;
out vec4 colour;
void main() { colour = texture(source, gl_FragCoord.xy / size); }
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

/** A GPU timer query in flight, with the scale its frame was drawn at. */
interface Timing { query: WebGLQuery; scale: number }
/** Frames that may be timed at once; results arrive a few frames late. */
const MAX_TIMINGS = 4;
interface TimerQuery { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

/** A compiled pass: a buffer, or the image the scene shows. */
interface Pass { program: WebGLProgram; uniforms: Map<string, UniformInfo> }

/** A float texture with a framebuffer to render into it. */
interface Target { texture: WebGLTexture; framebuffer: WebGLFramebuffer }

/** Ping-pong state: `read` holds the newest output, the next is drawn into `write`. */
interface State { read: Target; write: Target; width: number; height: number }

// Texture units: audio on 0..2, buffers on 3..6, the pass's own previous frame on 7.
const BUFFER_UNIT = 3;
const PREVIOUS_UNIT = BUFFER_UNIT + MAX_BUFFERS;
const SAMPLERS: Record<string, number> = {
  aoSpectrum: 0, aoWave: 1, aoSpectrogram: 2, aoPrevious: PREVIOUS_UNIT,
  ...Object.fromEntries(Array.from({ length: MAX_BUFFERS }, (_, i) => [`aoBuffer${i}`, BUFFER_UNIT + i])),
};

/**
 * One WebGL2 canvas that renders a scene each frame, used as a Hydra source.
 * Buffers, and an image that reads `aoPrevious`, keep their output in float
 * textures across frames. That state survives recompiles, so editing a
 * running simulation doesn't restart it; it clears when the number of
 * buffers changes, on `clear`, and on `release`.
 */
export class Scene {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext;
  private passes: Pass[] = [];
  private sources: string[] = [];
  private spectrum: WebGLTexture;
  private spectrumData = new Float32Array(0);
  /** The pass whose uniforms are being set. */
  private uniforms = new Map<string, UniformInfo>();
  private setters: ((at: WebGLUniformLocation, v: number[]) => void)[];
  private frame = 0;
  options: SceneOptions = {};
  // Waveform and spectrogram textures, on units 1 and 2.
  private wave: WebGLTexture;
  private waveData = new Float32Array(0);
  private waveSource: ArrayLike<number> | null = null;
  private history: WebGLTexture;
  private historyUploaded = -1;
  private historyVersion = -1;
  // One state per buffer, then the image's if it reads aoPrevious.
  private states: (State | null)[] = [];
  private empty: WebGLTexture;
  private copy: WebGLProgram;
  private copyLocations: { source: WebGLUniformLocation | null; size: WebGLUniformLocation | null };
  private floatTargets: boolean;
  // Without timer queries, "auto" scenes draw at full size.
  private timer: TimerQuery | null;
  private timings: Timing[] = [];

  /** `onError` hears about uniforms that threw or returned unusable values. */
  constructor(private readonly onError: (message: string) => void = () => {}) {
    const gl = this.canvas.getContext("webgl2", { antialias: false, depth: false, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    // Rendering into RGBA16F needs this; WebGL2 filters half floats without help.
    this.floatTargets = !!gl.getExtension("EXT_color_buffer_float");
    this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQuery | null;
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
    this.wave = this.createTexture(gl.CLAMP_TO_EDGE);
    // Rows repeat, so aoHistory reads straight across the ring's wrap.
    this.history = this.createTexture(gl.REPEAT);
    // Buffers a scene doesn't have read as transparent black.
    this.empty = this.createTexture(gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.copy = this.link(COPY, "scene copy");
    this.copyLocations = { source: gl.getUniformLocation(this.copy, "source"), size: gl.getUniformLocation(this.copy, "size") };
  }

  private createTexture(wrapT: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
    return texture;
  }

  /** Compiles and links a fragment shader; `label` names it in errors. */
  private link(fragment: string, label: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? "unknown error";
        gl.deleteShader(shader);
        throw new Error(`${label} shader: ${formatShaderLog(log)}`);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    let fs: WebGLShader;
    try {
      fs = compile(gl.FRAGMENT_SHADER, fragment);
    } catch (e) {
      gl.deleteShader(vs);
      throw e;
    }
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
      throw new Error(`${label} link: ${log}`);
    }
    return program;
  }

  /** Compiles a pass, pointing its samplers at their texture units. */
  private compilePass(code: string, label: string, main: string): Pass {
    const gl = this.gl;
    const program = this.link(PRELUDE + code + main, label);
    // Active uniforms only: the compiler drops the ones a shader doesn't use.
    const uniforms = new Map<string, UniformInfo>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      const location = info && gl.getUniformLocation(program, info.name);
      if (info && location) uniforms.set(info.name, { location, size: FLOAT_SIZES[info.type] ?? 0 });
    }
    gl.useProgram(program);
    for (const [name, unit] of Object.entries(SAMPLERS)) {
      const info = uniforms.get(name);
      if (info) gl.uniform1i(info.location, unit);
    }
    return { program, uniforms };
  }

  /**
   * Compiles `code`, and any `options.buffers`, unless they are already
   * running. Throws and keeps the old programs on error.
   */
  load(code: string, options: SceneOptions = {}): void {
    const sources = sceneSources(code, options);
    this.options = options;
    if (this.passes.length && sources.length === this.sources.length && sources.every((s, i) => s === this.sources[i])) return;
    const passes: Pass[] = [];
    try {
      sources.forEach((source, i) => {
        const image = i === sources.length - 1;
        passes.push(this.compilePass(source, image ? "scene" : `scene buffers[${i}]`, image ? MAIN : BUFFER_MAIN));
      });
    } catch (e) {
      for (const pass of passes) this.gl.deleteProgram(pass.program);
      throw e;
    }
    for (const pass of this.passes) this.gl.deleteProgram(pass.program);
    // A different set of buffers means different state: start it afresh.
    if (sources.length !== this.sources.length) this.clear(true);
    this.passes = passes;
    this.sources = sources;
  }

  /** Empties the buffers and restarts iFrame; `free` also gives up their textures. */
  clear(free = false): void {
    const gl = this.gl;
    for (const state of this.states) {
      if (!state) continue;
      for (const target of [state.read, state.write]) {
        if (free) {
          gl.deleteFramebuffer(target.framebuffer);
          gl.deleteTexture(target.texture);
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (free) {
      this.states = [];
      for (const timing of this.timings) gl.deleteQuery(timing.query);
      this.timings = [];
    }
    this.frame = 0;
  }

  /** Shrinks the canvas and frees the buffers, for a deck that is switching sketches. */
  release(): void {
    this.canvas.width = this.canvas.height = 1;
    this.clear(true);
  }

  private createTarget(width: number, height: number): Target {
    const gl = this.gl;
    const texture = this.createTexture(gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`scene buffers: can't render into half-float textures (status 0x${status.toString(16)})`);
    }
    return { texture, framebuffer };
  }

  /** Draws `texture` over the whole of the bound framebuffer, `width` × `height`. */
  private drawCopy(texture: WebGLTexture, width: number, height: number): void {
    const gl = this.gl;
    gl.useProgram(this.copy);
    gl.activeTexture(gl.TEXTURE0 + PREVIOUS_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.copyLocations.source, PREVIOUS_UNIT);
    gl.uniform2f(this.copyLocations.size, width, height);
    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * The state for pass `i` at `width` × `height`, or null for an image that
   * doesn't read aoPrevious. A resize stretches the old state into the new.
   */
  private stateFor(i: number, width: number, height: number): State | null {
    const gl = this.gl;
    const image = i === this.passes.length - 1;
    const old = this.states[i] ?? null;
    if (image && !this.passes[i].uniforms.has("aoPrevious")) {
      if (old) {
        for (const target of [old.read, old.write]) {
          gl.deleteFramebuffer(target.framebuffer);
          gl.deleteTexture(target.texture);
        }
        this.states[i] = null;
      }
      return null;
    }
    if (old && old.width === width && old.height === height) return old;
    if (!this.floatTargets) throw new Error("scene buffers: this GPU can't render into float textures (EXT_color_buffer_float)");
    const state: State = { read: this.createTarget(width, height), write: this.createTarget(width, height), width, height };
    if (old) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.read.framebuffer);
      this.drawCopy(old.read.texture, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const target of [old.read, old.write]) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
    }
    this.states[i] = state;
    return state;
  }

  render(width: number, height: number, time: number, dt: number, audio: AudioFeatures): void {
    if (!this.passes.length) return;
    const gl = this.gl;
    const auto = this.options.scale === "auto" && this.timer !== null;
    if (this.timings.length) this.collectTimings();
    const scale = auto ? sceneResolution.scaleAt(performance.now()) : typeof this.options.scale === "number" ? this.options.scale : 1;
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const resized = this.canvas.width !== w || this.canvas.height !== h;
    if (resized) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const states = this.passes.map((_, i) => this.stateFor(i, w, h));
    // A frame that reallocated its canvas is slow for that reason alone; timing
    // it would shrink the scale again, and the next resize would do the same.
    const timing = auto && !resized && this.timings.length < MAX_TIMINGS ? { query: gl.createQuery()!, scale } : null;
    if (timing) gl.beginQuery(this.timer!.TIME_ELAPSED_EXT, timing.query);
    this.uploadAudio(audio);
    // Each user uniform is read once a frame, however many passes use it.
    const values = new Map<string, number[]>();
    const buffers = states.length - 1;
    this.passes.forEach((pass, i) => {
      const state = states[i];
      for (let b = 0; b < MAX_BUFFERS; b++) {
        gl.activeTexture(gl.TEXTURE0 + BUFFER_UNIT + b);
        gl.bindTexture(gl.TEXTURE_2D, b < buffers ? states[b]!.read.texture : this.empty);
      }
      gl.activeTexture(gl.TEXTURE0 + PREVIOUS_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, state ? state.read.texture : this.empty);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state ? state.write.framebuffer : null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(pass.program);
      this.uniforms = pass.uniforms;
      this.setUniforms(w, h, time, dt, audio, values);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (state) [state.read, state.write] = [state.write, state.read];
    });
    // An image with state was drawn off screen; show it.
    const image = states[buffers];
    if (image) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.drawCopy(image.read.texture, w, h);
    }
    if (timing) {
      gl.endQuery(this.timer!.TIME_ELAPSED_EXT);
      this.timings.push(timing);
    }
    gl.activeTexture(gl.TEXTURE0);
    this.frame++;
  }

  /** Reports the GPU time of frames whose timer queries have finished, oldest first. */
  private collectTimings(): void {
    const gl = this.gl;
    // A disjoint period, such as a GPU clock change, spoils every timing in flight.
    const disjoint = gl.getParameter(this.timer!.GPU_DISJOINT_EXT) as boolean;
    while (this.timings.length) {
      const { query, scale } = this.timings[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      if (!disjoint) sceneResolution.report(this, ns / 1e6, scale, performance.now());
      gl.deleteQuery(query);
      this.timings.shift();
    }
  }

  /** Uploads the audio textures that changed, once a frame for every pass. */
  private uploadAudio(audio: AudioFeatures, history: SpectrumHistory = spectrogram): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spectrum);
    this.uploadSpectrum(audio.spectrum);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.wave);
    if (audio.wave && audio.wave !== this.waveSource) {
      this.waveSource = audio.wave;
      this.uploadRow(audio.wave);
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.history);
    this.uploadHistory(history);
  }

  /** Sets the active pass's uniforms; `values` caches user uniforms across passes. */
  private setUniforms(w: number, h: number, time: number, dt: number, audio: AudioFeatures, values: Map<string, number[]>): void {
    this.uniform("iResolution", [w, h, 1]);
    this.uniform("iTime", time);
    this.uniform("iTimeDelta", dt);
    this.uniformInt("iFrame", this.frame);
    this.uniform("aoLoudness", audio.loudness);
    this.uniform("aoImpulse", audio.impulse);
    this.uniform("aoBeat", audio.beat);
    this.uniform("aoBass", audio.bass);
    this.uniform("aoMid", audio.mid);
    this.uniform("aoHigh", audio.high);
    this.uniform("aoEnergy", audio.energy ?? 0);
    this.uniform("aoDrop", audio.drop ?? 0);
    this.uniform("aoBpm", clock.bpm);
    this.uniform("aoPhase", phaseNow());
    this.uniform("aoBar", barNow());
    this.uniform("aoSpectrogramRow", spectrogram.newest);
    this.uniform("aoBalance", audio.balance ?? 0);
    this.uniform("aoWidth", audio.width ?? 0);
    this.uniform("aoKey", audio.key ?? 0);
    const chroma = this.uniforms.get("aoChroma[0]");
    if (chroma && audio.chroma?.length === 12) this.gl.uniform1fv(chroma.location, audio.chroma);
    for (const [name, value] of Object.entries(this.options.uniforms ?? {})) {
      const info = this.uniforms.get(name);
      if (!info) continue; // undeclared, or unused and optimized away
      if (!info.size) {
        this.onError(`uniform ${name} must be declared as float or vec2..vec4`);
        continue;
      }
      const key = `${name}/${info.size}`;
      let result = values.get(key);
      if (!result) {
        const evaluated = evaluateUniform(name, value, info.size);
        if (evaluated.error) this.onError(evaluated.error);
        values.set(key, (result = evaluated.value));
      }
      this.setters[info.size - 1](info.location, result);
    }
  }

  /** Streams the waveform into the bound one-row texture, allocated once per length. */
  private uploadRow(values: ArrayLike<number>): void {
    const gl = this.gl;
    if (this.waveData.length !== values.length) {
      this.waveData = new Float32Array(values.length);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, Math.max(1, values.length), 1, 0, gl.RED, gl.FLOAT, null);
    }
    if (!values.length) return;
    this.waveData.set(values);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, values.length, 1, gl.RED, gl.FLOAT, this.waveData);
  }

  /** Uploads the spectrogram rows written since the last upload into the bound texture. */
  private uploadHistory(history: SpectrumHistory): void {
    if (history.version === this.historyVersion) return;
    const gl = this.gl;
    const { bands, rows, data } = history;
    if (this.historyUploaded < 0 || history.written - this.historyUploaded >= rows) {
      if (this.historyUploaded < 0) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, bands, rows, 0, gl.RED, gl.FLOAT, null);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bands, rows, gl.RED, gl.FLOAT, data);
    } else {
      // From the previously newest row, which may have been refreshed since.
      for (let w = Math.max(0, this.historyUploaded - 1); w < history.written; w++) {
        const row = w % rows;
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, bands, 1, gl.RED, gl.FLOAT, data, row * bands);
      }
    }
    this.historyUploaded = history.written;
    this.historyVersion = history.version;
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
