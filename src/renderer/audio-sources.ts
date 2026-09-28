import type { AudioFeatures } from "../shared/features";
import { SPECTRUM_BANDS, WAVE_SIZE } from "../shared/features";
import { spectrogram, type SpectrumHistory } from "./spectrogram";

/**
 * Audio sources: Hydra generators whose pixels are the sound, so a sketch
 * can draw the spectrum, its recent history or the waveform with plain
 * chains, plus `polar`, which bends any chain into a ring.
 *
 *   spectrum().pixelate(40, 1).polar().out()
 *
 * Each deck registers them with Hydra's own `setFunction`. The sound
 * reaches the shader as a small texture per source, refreshed every frame,
 * passed as a hidden first argument: `spectrum(2)` calls `_spectrum(tex, 2)`.
 */

interface Input { type: "float"; name: string; default: number }

/** One Ao addition to Hydra, in hydra-synth's own function format. */
export interface AoHydraFunction {
  name: string;
  type: "src" | "coord";
  inputs: Input[];
  glsl: string;
  /** The audio texture a source reads, passed ahead of `inputs`. */
  texture?: "spectrum" | "history" | "wave";
}

const float = (name: string, value: number): Input => ({ type: "float", name, default: value });

/** 16-bit waveform samples, packed into red (high byte) and green (low byte). */
const WAVE_AT = (i: string) => `dot(texture2D(tex, vec2((${i} + 0.5) / ${WAVE_SIZE}.0, 0.5)).rg, vec2(65280.0, 255.0)) / 32767.5 - 1.0`;

export const aoHydraFunctions: AoHydraFunction[] = [
  {
    name: "spectrum",
    type: "src",
    texture: "spectrum",
    inputs: [float("gain", 1)],
    glsl: `
  float level = texture2D(tex, vec2(clamp(_st.x, 0.0, 1.0), 0.5)).r * gain;
  return vec4(vec3(level), 1.0);`,
  },
  {
    name: "history",
    type: "src",
    texture: "history",
    inputs: [float("gain", 1)],
    glsl: `
  float level = texture2D(tex, clamp(_st, 0.0, 1.0)).r * gain;
  return vec4(vec3(level), 1.0);`,
  },
  {
    name: "waveform",
    type: "src",
    texture: "wave",
    inputs: [float("thickness", 0.01), float("gain", 1)],
    glsl: `
  float fx = clamp(_st.x, 0.0, 1.0) * ${WAVE_SIZE - 1}.0;
  float i = floor(fx);
  float a = ${WAVE_AT("i")};
  float b = ${WAVE_AT("min(i + 1.0, " + (WAVE_SIZE - 1) + ".0)")};
  // Hydra's y runs down the screen; positive samples go up.
  float y = 0.5 - 0.5 * gain * mix(a, b, fract(fx));
  // The trace's slope on screen, so steep edges stay as thick as flat ones.
  float slope = 0.5 * gain * (b - a) * ${WAVE_SIZE - 1}.0 * resolution.y / resolution.x;
  float d = abs(_st.y - y) / sqrt(1.0 + slope * slope);
  return vec4(vec3(smoothstep(max(thickness, 1e-4), 0.0, d)), 1.0);`,
  },
  {
    name: "polar",
    type: "coord",
    inputs: [float("mirror", 0)],
    glsl: `
  vec2 p = _st - 0.5;
  p.x *= resolution.x / resolution.y;
  // Hydra's y runs down the screen, so -p.y points up.
  float around = fract(atan(p.x, -p.y) / 6.2831853);
  float mirrored = abs(atan(p.x, p.y)) / 3.1415927;
  return vec2(mix(around, mirrored, step(0.5, mirror)), 2.0 * length(p));`,
  },
];

/** Fills `out` (RGBA) with the waveform as 16-bit samples: red holds the high byte, green the low. */
export function packWave(wave: ArrayLike<number>, out: Uint8Array): Uint8Array {
  const n = out.length / 4;
  for (let i = 0; i < n; i++) {
    const v = i < wave.length && Number.isFinite(wave[i]) ? Math.min(1, Math.max(-1, wave[i])) : 0;
    const u = Math.round((v + 1) * 32767.5);
    out[4 * i] = u >> 8;
    out[4 * i + 1] = u & 255;
    out[4 * i + 2] = 0;
    out[4 * i + 3] = 255;
  }
  return out;
}

/** A level 0..1 as a byte; anything else reads as silence. */
const byte = (v: number) => (Number.isFinite(v) ? Math.round(Math.min(1, Math.max(0, v)) * 255) : 0);

/** Fills `out` (RGBA) with levels 0..1 as bytes in red. */
export function packLevels(levels: ArrayLike<number>, out: Uint8Array): Uint8Array {
  for (let i = 0; i < out.length / 4; i++) {
    out[4 * i] = i < levels.length ? byte(levels[i]) : 0;
    out[4 * i + 3] = 255;
  }
  return out;
}

/**
 * Fills `out` (RGBA, `bands` × `rows`) with the history, newest row last.
 * Hydra's y runs down the screen, so now is at the bottom and age runs up.
 */
export function packHistory(history: SpectrumHistory, out: Uint8Array): Uint8Array {
  const { bands, rows } = history;
  for (let age = 0; age < rows; age++) {
    for (let b = 0; b < bands; b++) {
      const i = 4 * ((rows - 1 - age) * bands + b);
      out[i] = history.written > age ? byte(history.at(b, age)) : 0;
      out[i + 3] = 255;
    }
  }
  return out;
}

interface ReglTexture { subimage?(data: { data: Uint8Array; width: number; height: number }): void }
interface Regl { texture(options: object): ReglTexture }

/** One source's texture and the bytes it is filled from. */
interface Feed { texture: ReglTexture; data: Uint8Array; width: number; height: number }

/**
 * Registers the audio sources and `polar` on one deck's synth. Returns the
 * per-frame update that refreshes their textures.
 */
export function installAudioSources(regl: Regl, synth: Record<string, unknown>, history: SpectrumHistory = spectrogram) {
  const feed = (width: number, height: number, filter: "linear" | "nearest"): Feed => {
    const data = new Uint8Array(width * height * 4);
    return { texture: regl.texture({ width, height, data, min: filter, mag: filter, wrap: "clamp" }), data, width, height };
  };
  const feeds = {
    spectrum: feed(SPECTRUM_BANDS, 1, "linear"),
    history: feed(history.bands, history.rows, "linear"),
    // Nearest: each sample's two bytes must be read whole, then mixed in the shader.
    wave: feed(WAVE_SIZE, 1, "nearest"),
  };
  const setFunction = synth.setFunction as (definition: object) => void;
  for (const fn of aoHydraFunctions) {
    if (!fn.texture) {
      setFunction({ name: fn.name, type: fn.type, inputs: fn.inputs, glsl: fn.glsl });
      continue;
    }
    const inner = `_${fn.name}`;
    setFunction({ name: inner, type: fn.type, inputs: [{ type: "sampler2D", name: "tex", default: NaN }, ...fn.inputs], glsl: fn.glsl });
    const texture = feeds[fn.texture].texture;
    // Hydra samples an argument with getTexture(), as it does o0 or s0.
    const holder = { getTexture: () => texture };
    synth[fn.name] = (...args: unknown[]) => (synth[inner] as (...a: unknown[]) => unknown)(holder, ...args);
  }

  let historyVersion = -1;
  const upload = (f: Feed) => f.texture.subimage?.({ data: f.data, width: f.width, height: f.height });
  return (features: AudioFeatures): void => {
    packLevels(features.spectrum, feeds.spectrum.data);
    upload(feeds.spectrum);
    packWave(features.wave, feeds.wave.data);
    upload(feeds.wave);
    if (history.version !== historyVersion) {
      historyVersion = history.version;
      packHistory(history, feeds.history.data);
      upload(feeds.history);
    }
  };
}
