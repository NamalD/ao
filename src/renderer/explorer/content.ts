/**
 * The code explorer's hand-written content: one runnable example for every
 * Hydra function, `ao` member and source method, plus Hydra's globals and a
 * few recipes. Descriptions and parameters for the first three come from the
 * editor's docs (editor.ts, audio.ts); tests check every name has an example.
 */

/** An example that shouldn't auto-play: it needs a camera, the screen, the network, or blanks the screen. */
export interface ManualExample { code: string; manual: true }
export type Example = string | ManualExample;

/** One example per Hydra GLSL function, keyed by name. */
export const hydraExamples: Record<string, Example> = {
  // Sources
  noise: `noise(() => 3 + 4 * ao.bass, 0.1).out()`,
  voronoi: `voronoi(8, () => 0.3 + ao.mid, 0.3)
  .color(0.8, 0.4, 1)
  .out()`,
  osc: `osc(30, 0.05, () => 1.5 * ao.impulse).out()`,
  shape: `shape(6, () => 0.2 + 0.4 * ao.bass, 0.02).out()`,
  gradient: `gradient(() => 2 * ao.loudness).out()`,
  src: `// Feed the output back into itself for trails.
shape(4, () => 0.1 + 0.3 * ao.impulse)
  .add(src(o0).scale(1.02).rotate(0.01), 0.9)
  .out()`,
  solid: `solid(() => ao.bass, 0.1, () => ao.high).out()`,
  prev: `shape(3, 0.3)
  .rotate(() => time)
  .blend(prev(), 0.9)
  .out()`,
  // Geometry
  rotate: `osc(40, 0.05, 1)
  .rotate(() => 3.14 * ao.bass)
  .out()`,
  scale: `shape(5, 0.3)
  .scale(() => 1 + ao.hz(40, 100))
  .out()`,
  pixelate: `noise(4)
  .pixelate(() => 8 + 60 * ao.high, 20)
  .out()`,
  repeat: `shape(4, 0.3)
  .repeat(4, 4, 0, () => ao.impulse)
  .out()`,
  repeatX: `osc(20, 0.1, 1)
  .repeatX(4, () => ao.mid)
  .out()`,
  repeatY: `osc(20, 0.1, 1)
  .repeatY(4, () => ao.mid)
  .out()`,
  kaleid: `osc(20, 0.05, 1)
  .kaleid(() => 3 + Math.round(6 * ao.mid))
  .out()`,
  scroll: `shape(3, 0.2)
  .repeat(3, 3)
  .scroll(0, 0, 0.05, () => 0.2 * ao.bass)
  .out()`,
  scrollX: `osc(10, 0, 1)
  .scrollX(0, () => 0.1 + ao.loudness)
  .out()`,
  scrollY: `shape(4, 0.2)
  .repeat(4, 4)
  .scrollY(0, () => 0.1 + ao.loudness)
  .out()`,
  // Colour
  posterize: `gradient(0.5)
  .posterize(() => 2 + 6 * ao.mid, 0.6)
  .out()`,
  shift: `osc(20, 0.1, 1)
  .shift(() => ao.bass, 0, () => ao.high)
  .out()`,
  invert: `osc(20, 0.1)
  .invert(() => ao.beat)
  .out()`,
  contrast: `noise(3)
  .contrast(() => 1 + 3 * ao.loudness)
  .out()`,
  brightness: `voronoi(6)
  .brightness(() => ao.impulse - 0.3)
  .out()`,
  luma: `// The noise's dark areas become see-through, showing the stripes below.
osc(10, 0.1, 1)
  .layer(noise(4).luma(() => 0.7 - 0.5 * ao.bass))
  .out()`,
  thresh: `noise(4)
  .thresh(() => 0.2 + 0.6 * ao.mid, 0.04)
  .out()`,
  color: `osc(20, 0.05)
  .color(1, () => ao.mid, () => ao.high)
  .out()`,
  saturate: `osc(20, 0.1, 1)
  .saturate(() => 4 * ao.loudness)
  .out()`,
  hue: `osc(20, 0.1, 1)
  .hue(() => ao.centroid)
  .out()`,
  colorama: `osc(10, 0.1, 1)
  .colorama(() => 0.1 * ao.impulse)
  .out()`,
  sum: `// sum() returns a float, so osc().sum() won't compile as a chain.
// For one channel as greyscale, use r(), g(), b() or a() instead:
osc(10, 0.1, 1).g().out()`,
  r: `osc(20, 0.1, 1)
  .r(() => 1 + ao.bass)
  .out()`,
  g: `osc(20, 0.1, 1)
  .g(() => 1 + ao.mid)
  .out()`,
  b: `osc(20, 0.1, 1)
  .b(() => 1 + ao.high)
  .out()`,
  a: `// A soft shape's alpha, shown as greyscale.
shape(4, () => 0.2 + 0.3 * ao.bass, 0.3)
  .a()
  .out()`,
  // Blending
  add: `osc(20, 0.1)
  .add(shape(4, 0.4), () => ao.impulse)
  .out()`,
  sub: `osc(20, 0.1, 1)
  .sub(shape(4, () => 0.2 + 0.4 * ao.bass))
  .out()`,
  layer: `osc(20, 0.1, 1)
  .layer(shape(4, () => 0.2 + 0.3 * ao.bass).color(1, 0.2, 0.5).luma(0.1))
  .out()`,
  blend: `osc(20, 0.1, 1)
  .blend(noise(3), () => ao.mid)
  .out()`,
  mult: `osc(20, 0.1, 1)
  .mult(shape(4, () => 0.2 + 0.5 * ao.bass, 0.3))
  .out()`,
  diff: `osc(20, 0.1, 1)
  .diff(shape(4, 0.4).rotate(() => ao.time))
  .out()`,
  mask: `osc(20, 0.1, 1)
  .mask(shape(4, () => 0.2 + 0.5 * ao.bass, 0.1))
  .out()`,
  // Modulation
  modulate: `osc(20, 0.1, 1)
  .modulate(noise(3), () => 0.4 * ao.impulse)
  .out()`,
  modulateScale: `shape(4, 0.4)
  .modulateScale(osc(8), () => 2 * ao.bass)
  .out()`,
  modulatePixelate: `noise(3)
  .modulatePixelate(noise(5), () => 20 * ao.mid, 3)
  .out()`,
  modulateRotate: `osc(20, 0.1, 1)
  .modulateRotate(shape(4, 0.4), () => 3 * ao.bass)
  .out()`,
  modulateHue: `// Feedback that flows along colour edges.
src(o0)
  .modulateHue(src(o0).scale(1.01), 1)
  .blend(osc(10, 0.1, 1), () => 0.05 + 0.2 * ao.impulse)
  .out()`,
  modulateRepeat: `shape(4, 0.3)
  .modulateRepeat(osc(4), 3, 3, () => ao.mid, 0.5)
  .out()`,
  modulateRepeatX: `osc(20, 0.1, 1)
  .modulateRepeatX(noise(2), 4, () => ao.bass)
  .out()`,
  modulateRepeatY: `osc(20, 0.1, 1)
  .modulateRepeatY(noise(2), 4, () => ao.bass)
  .out()`,
  modulateKaleid: `osc(20, 0.05, 1)
  .modulateKaleid(noise(() => 1 + 3 * ao.mid), 6)
  .out()`,
  modulateScrollX: `osc(20, 0.1, 1)
  .modulateScrollX(noise(3), () => 0.5 * ao.bass)
  .out()`,
  modulateScrollY: `osc(20, 0.1, 1)
  .modulateScrollY(noise(3), () => 0.5 * ao.bass)
  .out()`,
};

/** One example per public `ao` member. */
export const aoExamples: Record<string, Example> = {
  time: `osc(10, 0.1, 1)
  .rotate(() => 0.1 * ao.time)
  .out()`,
  loudness: `shape(64, () => 0.1 + 0.5 * ao.loudness, 0.01).out()`,
  impulse: `osc(40, 0.05, 1)
  .modulate(noise(3), () => 0.3 * ao.impulse)
  .out()`,
  beat: `voronoi(5)
  .brightness(() => 0.6 * ao.beat)
  .out()`,
  bass: `shape(3, () => 0.2 + 0.5 * ao.bass).out()`,
  mid: `osc(20, 0.1, 1)
  .kaleid(() => 2 + 8 * ao.mid)
  .out()`,
  high: `noise(() => 2 + 20 * ao.high).out()`,
  fft: `// ao.fft[i] is band i of 64, from low to high.
shape(4, () => 0.5 * ao.fft[4]).scrollX(-0.3)
  .add(shape(4, () => 0.5 * ao.fft[24]))
  .add(shape(4, () => 0.5 * ao.fft[48]).scrollX(0.3))
  .out()`,
  fftAt: `osc(20, 0.1, 1)
  .rotate(() => 2 * ao.fftAt(0.5))
  .out()`,
  hz: `shape(4, () => 0.2 + 0.5 * ao.hz(40, 100))       // kick
  .rotate(() => 2 * ao.hz(6000, 12000))           // hats
  .out()`,
  peak: `osc(20, 0.1, 1)
  .hue(() => ao.peak)
  .out()`,
  centroid: `// Dark sounds go red, bright sounds blue.
gradient()
  .color(() => 1 - ao.centroid, 0.4, () => ao.centroid)
  .out()`,
  map: `osc(20, 0.05, 1)
  .rotate(ao.map("mid", 0, 3))
  .scale(ao.map("bass", 1, 1.5))
  .out()`,
  wave: `// An oscilloscope: draw ao.wave onto a canvas each frame.
const ctx = s0.initCanvas(512, 256)
update = () => {
  ctx.clearRect(0, 0, 512, 256)
  ctx.strokeStyle = "white"
  ctx.lineWidth = 3
  ctx.beginPath()
  ao.wave.forEach((v, i) => ctx.lineTo(i, 128 - 100 * v))
  ctx.stroke()
}

src(s0).out()`,
  waveAt: `// The waveform's middle sample nudges the stripes.
osc(20, 0.05, 1)
  .scrollY(() => 0.2 * ao.waveAt(0.5))
  .out()`,
  balance: `// Leans towards whichever speaker is louder.
shape(4, 0.3)
  .scroll(() => 0.3 * ao.balance, 0)
  .out()`,
  width: `// Mono stays a narrow line; wide stereo spreads it out.
shape(4, 0.4)
  .scale(1, () => 0.1 + 2 * ao.width, 1)
  .out()`,
  chroma: `// ao.chroma[0] is C, ao.chroma[7] is G: each shape lights with its note.
shape(4, () => 0.3 * ao.chroma[0]).scrollX(-0.2)
  .add(shape(4, () => 0.3 * ao.chroma[7]).color(1, 0.6, 0.2).scrollX(0.2))
  .out()`,
  key: `// Twelve positions round a wheel, one per pitch class.
shape(3, 0.25)
  .rotate(() => (ao.key / 12) * 6.283)
  .out()`,
  hue: `// Colour that follows the harmony.
osc(15, 0.05, 1)
  .saturate(2)
  .hue(() => ao.hue)
  .out()`,
  bpm: `// Spin one full turn every four beats.
shape(3, 0.3)
  .rotate(0, () => (ao.bpm / 60 / 4) * 6.283)
  .out()`,
  phase: `// A ring that swells through each beat, then snaps back.
shape(64, () => 0.1 + 0.4 * ao.phase, 0.05)
  .out()`,
  bar: `// A different shape on each beat of the bar.
shape(() => 3 + ao.bar, 0.35)
  .out()`,
  tempoConfidence: `// Stripes sharpen as the tempo locks in.
osc(20, 0.05, 1)
  .saturate(() => ao.tempoConfidence)
  .modulate(noise(3), () => 0.3 * (1 - ao.tempoConfidence))
  .out()`,
  ramp: `// One slow turn per bar, in time with the music.
osc(20, 0, 1)
  .kaleid(6)
  .rotate(() => ao.ramp(4) * 6.283)
  .out()`,
  pulse: `// Flashes on eighth notes.
voronoi(6, 0.2)
  .color(0.3, 0.2, 0.8)
  .add(solid(1, 1, 1), () => 0.4 * ao.pulse(2))
  .out()`,
};

/** One example per s0–s3 method. */
export const sourceExamples: Record<string, Example> = {
  initScene: `s0.initScene(\`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float bar = step(uv.y, aoFFT(uv.x));
  fragColor = vec4(vec3(bar) * vec3(uv.x, 0.5, 1.0 - uv.x), 1.0);
}\`, { scale: 0.5 })

src(s0).out()`,
  initCanvas: `const ctx = s0.initCanvas(512, 512)
ctx.fillStyle = "white"
ctx.font = "200px monospace"
ctx.fillText("ao", 130, 320)

src(s0)
  .modulate(noise(3), () => 0.1 * ao.impulse)
  .out()`,
  init: `const canvas = document.createElement("canvas")
canvas.width = canvas.height = 256
const ctx = canvas.getContext("2d")
ctx.fillStyle = "orange"
ctx.fillRect(64, 64, 128, 128)
s0.init({ src: canvas })

src(s0).kaleid(4).out()`,
  initImage: { manual: true, code: `// Swap in any image URL.
s0.initImage("https://example.com/texture.jpg")
src(s0)
  .modulate(osc(8), () => 0.1 * ao.bass)
  .out()` },
  initVideo: { manual: true, code: `// Swap in any video URL; it loops, muted.
s0.initVideo("https://example.com/loop.mp4")
src(s0)
  .blend(osc(10, 0.1, 1), () => ao.impulse)
  .out()` },
  initCam: { manual: true, code: `s0.initCam()
src(s0)
  .kaleid(() => 2 + 6 * ao.mid)
  .out()` },
  initScreen: { manual: true, code: `s0.initScreen()
src(s0).out()` },
  initStream: { manual: true, code: `// Needs Hydra's peer-to-peer server, which Ao doesn't run.
s0.initStream("friend")
src(s0).out()` },
  clear: { manual: true, code: `// Stop the camera, video or scene in s0 and free it.
s0.clear()` },
};

export interface GlobalEntry {
  name: string;
  signature: string;
  description: string;
  example: Example;
  /** Other words that lead here: K on `o1` finds "o0–o3". */
  aliases?: string[];
}

/** Hydra's globals and chain helpers that aren't GLSL functions. */
export const globalEntries: GlobalEntry[] = [
  {
    name: "out", signature: "out(output = o0)",
    description: "Ends a chain and renders it into an output buffer. o0 is the one on screen unless render() picks another.",
    example: `osc(20, 0.1, 1).out(o1)
render(o1)`,
  },
  {
    name: "o0–o3", signature: "o0, o1, o2, o3",
    description: "Four output buffers. Render a chain into one with .out(o1), then sample it anywhere with src(o1). Only one is shown at a time; see render().",
    aliases: ["o0", "o1", "o2", "o3"],
    example: `noise(3).out(o1)
src(o1)
  .kaleid(() => 3 + 5 * ao.mid)
  .out(o0)`,
  },
  {
    name: "render", signature: "render(output?)",
    description: "Chooses which output is shown. With no argument, all four in a grid, handy for checking a multi-output patch.",
    example: `osc(20, 0.1, 1).out(o0)
noise(() => 2 + 8 * ao.bass).out(o1)
voronoi(5).out(o2)
shape(4, () => 0.2 + 0.4 * ao.impulse).out(o3)
render()`,
  },
  {
    name: "s0–s3", signature: "s0, s1, s2, s3",
    description: "Four sources: external textures such as GLSL scenes, images, video, a canvas or a camera. Load one with an init method, then sample it with src(s0).",
    aliases: ["s0", "s1", "s2", "s3"],
    example: `const ctx = s1.initCanvas(256, 256)
ctx.fillStyle = "white"
ctx.fillRect(96, 32, 64, 192)

src(s1)
  .rotate(() => ao.time)
  .out()`,
  },
  {
    name: "hush", signature: "hush()",
    description: "Clears every output and source and resets update, blanking the screen.",
    example: { manual: true, code: `hush()` },
  },
  {
    name: "speed", signature: "speed = 1",
    description: "Multiplier for Hydra's clock, and so for every animated argument and scene time. The explorer resets it to 1 as you move on.",
    example: `speed = 0.25
osc(20, 0.1, 1)
  .rotate(0, 0.5)
  .out()`,
  },
  {
    name: "bpm", signature: "bpm = 30",
    description: "Tempo at which array arguments step to their next value. The explorer resets it to 30 as you move on.",
    example: `bpm = 120
shape([3, 4, 5, 6], 0.4).out()`,
  },
  {
    name: "arrays", signature: "[a, b, c].fast(speed).smooth(amount).ease(name).offset(t).fit(lo, hi)",
    description: "An array argument steps through its values at bpm. fast() changes the rate, smooth() glides between values, ease() picks the curve ('linear', 'easeInOutCubic', …), offset() shifts the phase, and fit() rescales the values into lo..hi.",
    aliases: ["fast", "smooth", "ease", "offset", "fit"],
    example: `osc([10, 20, 40].fast(2), 0.1, 1)
  .rotate([0, 0.5, 1].smooth())
  .out()`,
  },
  {
    name: "time", signature: "time",
    description: "Hydra's clock in seconds, scaled by speed. ao.time is the audio clock instead.",
    example: `shape(4, () => 0.3 + 0.2 * Math.sin(time)).out()`,
  },
  {
    name: "mouse", signature: "mouse.x, mouse.y",
    description: "Pointer position in pixels.",
    example: `shape(4, 0.2)
  .scroll(() => mouse.x / width - 0.5, () => mouse.y / height - 0.5)
  .out()`,
  },
  {
    name: "width, height", signature: "width, height",
    description: "Output size in pixels. Divide by them to correct aspect ratio or normalise mouse.",
    aliases: ["width", "height"],
    example: `// A square that stays square in any window.
shape(4, 0.3)
  .scale(1, () => height / width, 1)
  .out()`,
  },
  {
    name: "update", signature: "update = (dt) => {}",
    description: "A function Hydra calls every frame with the milliseconds since the last one. Use it to smooth or accumulate values. hush() resets it.",
    example: `let level = 0
update = () => { level += (ao.bass - level) * 0.05 }

shape(4, () => 0.2 + level)
  .rotate(() => 4 * level)
  .out()`,
  },
  {
    name: "setFunction", signature: "setFunction({ name, type, inputs, glsl })",
    description: "Registers a custom GLSL function that then chains like a built-in. type is 'src', 'coord', 'color', 'combine' or 'combineCoord'; a src function reads _st and returns a vec4. See sketches/aurora.js.",
    example: `setFunction({
  name: "rings",
  type: "src",
  inputs: [{ type: "float", name: "count", default: 10 }],
  glsl: \`return vec4(vec3(sin(length(_st - 0.5) * count * 6.283 - time)), 1.0);\`,
})

rings(() => 5 + 20 * ao.bass).out()`,
  },
];

export interface Recipe { name: string; description: string; example: Example }

/** Short how-tos: Hydra ideas and ways to map audio. */
export const recipes: Recipe[] = [
  {
    name: "chains",
    description: "A pattern is a chain: a source (osc, noise, shape, …), then any number of geometry, colour, blend and modulate steps, then .out(). Steps run in order, so .rotate().kaleid() differs from .kaleid().rotate().",
    example: `osc(20, 0.1, 1)
  .kaleid(5)
  .color(1, 0.5, 0.8)
  .rotate(0, 0.1)
  .out()`,
  },
  {
    name: "feedback trails",
    description: "src(o0) reads the last frame of the output you're drawing, so mixing a little of it back in, slightly scaled or rotated, leaves trails. Keep the blend below 1 or the image saturates.",
    example: `src(o0)
  .scale(1.01)
  .rotate(0.005)
  .blend(shape(4, () => 0.05 + 0.3 * ao.impulse).color(0.4, 0.8, 1), 0.15)
  .out()`,
  },
  {
    name: "kick → zoom",
    description: "ao.hz(40, 100) isolates the kick drum. Feed it into scale so every kick punches the picture forward.",
    example: `osc(30, 0.05, 1)
  .kaleid(6)
  .scale(() => 1 + 0.6 * ao.hz(40, 100))
  .out()`,
  },
  {
    name: "hats → sparkle",
    description: "Hats and cymbals live around 6–12 kHz. Lowering a threshold on fine noise as they get louder lets more sparkles through.",
    example: `noise(60, 0.5)
  .thresh(() => 0.9 - 0.5 * ao.hz(6000, 12000), 0)
  .add(osc(10, 0.05, 1).mult(shape(64, 0.4, 0.4)), 0.5)
  .out()`,
  },
  {
    name: "beat flash",
    description: "ao.beat jumps to 1 on an onset and decays in about 0.15s, so it reads as a flash. ao.impulse is the longer, softer version.",
    example: `voronoi(6, 0.2)
  .color(0.3, 0.2, 0.8)
  .add(solid(1, 1, 1), () => 0.5 * ao.beat)
  .out()`,
  },
  {
    name: "brightness → hue",
    description: "ao.centroid tracks how bright the sound is, on a 0..1 axis. It's steadier than ao.peak, which suits colour.",
    example: `osc(15, 0.05, 1)
  .modulate(noise(2), 0.2)
  .hue(() => ao.centroid)
  .saturate(() => 1 + 2 * ao.loudness)
  .out()`,
  },
  {
    name: "smooth jumpy values",
    description: "Raw levels can twitch. Ease a value towards its target each frame in update: the smaller the factor, the smoother and slower.",
    example: `let smooth = 0
update = () => { smooth += (ao.mid - smooth) * 0.03 }

osc(20, 0.05, 1)
  .rotate(() => 3 * smooth)
  .kaleid(() => 3 + 6 * smooth)
  .out()`,
  },
  {
    name: "frequency ranges",
    description: "Rough ranges for ao.hz(lo, hi):\n- kick 40..100\n- bass line 60..250\n- snare body 150..300\n- voice 300..3000\n- snare crack 2000..5000\n- hats and cymbals 6000..12000",
    example: `shape(4, () => 0.1 + 0.4 * ao.hz(40, 100)).scrollX(-0.3)
  .add(shape(4, () => 0.1 + 0.4 * ao.hz(300, 3000)))
  .add(shape(4, () => 0.1 + 0.4 * ao.hz(6000, 12000)).scrollX(0.3))
  .out()`,
  },
  {
    name: "layering outputs",
    description: "Build a background in o1 and a foreground in o0 that samples it. Each output is its own chain, so the layers can react to different bands.",
    example: `voronoi(4, () => 0.2 + ao.mid).color(0.2, 0.1, 0.4).out(o1)

src(o1)
  .layer(shape(3, () => 0.2 + 0.4 * ao.bass).color(1, 0.6, 0.2).luma(0.1))
  .out(o0)`,
  },
];
