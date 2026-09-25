import type { AudioFeatures } from "../shared/features";

export type UniformValue = number | number[] | (() => number | number[]);
export interface SceneOptions {
  /** Render at this fraction of the output resolution; lower is faster. */
  scale?: number;
  /** Extra uniforms, declared in the shader as `uniform float name;` (or vec2..vec4). */
  uniforms?: Record<string, UniformValue>;
}

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

/** One WebGL2 canvas that renders a scene each frame, used as a Hydra source. */
export class Scene {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private code = "";
  private spectrum: WebGLTexture;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private frame = 0;
  options: SceneOptions = {};

  constructor() {
    const gl = this.canvas.getContext("webgl2", { antialias: false, depth: false, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
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
    this.locations.clear();
    this.frame = 0;
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, audio.spectrum.length, 1, 0, gl.RED, gl.FLOAT,
      new Float32Array(audio.spectrum));
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
      this.uniform(name, typeof value === "function" ? value() : value);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program!, name));
    return this.locations.get(name)!;
  }

  private uniform(name: string, value: number | number[]): void {
    const at = this.location(name);
    if (!at) return;
    const v = typeof value === "number" ? [value] : value;
    const setters = [this.gl.uniform1fv, this.gl.uniform2fv, this.gl.uniform3fv, this.gl.uniform4fv];
    setters[v.length - 1]?.call(this.gl, at, v);
  }

  private uniformInt(name: string, value: number): void {
    const at = this.location(name);
    if (at) this.gl.uniform1i(at, value);
  }
}
