/**
 * Words you might reach for that aren't the name, and the names they lead
 * to: the explorer's K and search follow them, and the editor offers the
 * name when you type one. They never show as names themselves. `on` is where
 * the word is written: after `ao.`, on a Hydra chain, after `s0.`, or
 * (omitted) on its own. So `ao.smooth` leads to glide, `osc().move` to
 * scroll, and `sphere().move`, a real solid method, nowhere.
 */
import type { Receiver } from "./editor";

export interface Synonym {
  on?: Receiver;
  words: string[];
  /** Explorer entry ids, best first; the name after the first `:` is what completion offers. */
  to: string[];
}

export const synonyms: Synonym[] = [
  { on: "ao", words: ["smooth", "smoothed", "ease", "lerp", "damp", "slew", "lag", "follow"], to: ["ao:glide"] },
  { on: "ao", words: ["volume", "level", "rms", "amplitude", "gain"], to: ["ao:loudness"] },
  { on: "ao", words: ["low", "lows", "sub", "kick"], to: ["ao:bass"] },
  { on: "ao", words: ["mids"], to: ["ao:mid"] },
  { on: "ao", words: ["treble", "highs", "hats"], to: ["ao:high"] },
  { on: "ao", words: ["onset", "hit", "trigger", "transient"], to: ["ao:impulse", "ao:beat"] },
  { on: "ao", words: ["tempo"], to: ["ao:bpm"] },
  { on: "ao", words: ["range", "scale", "remap"], to: ["ao:map", "ao:fit"] },
  { on: "ao", words: ["spectrum", "bands"], to: ["ao:fft"] },
  { on: "ao", words: ["freq", "frequency", "band"], to: ["ao:hz", "ao:fftAt"] },
  { on: "ao", words: ["waveform", "samples", "scope"], to: ["ao:wave"] },
  { on: "ao", words: ["pan", "stereo"], to: ["ao:balance", "ao:width"] },
  { on: "ao", words: ["notes", "pitch"], to: ["ao:chroma", "ao:key"] },
  { on: "ao", words: ["clock"], to: ["ao:time"] },
  { on: "hydra", words: ["move", "translate", "pan", "position", "slide"], to: ["hydra:scroll", "hydra:scrollX", "hydra:scrollY"] },
  { on: "hydra", words: ["spin", "turn", "angle"], to: ["hydra:rotate"] },
  { on: "hydra", words: ["zoom", "size", "resize", "grow"], to: ["hydra:scale"] },
  { on: "hydra", words: ["tile", "grid"], to: ["hydra:repeat"] },
  { on: "hydra", words: ["mirror", "symmetry"], to: ["hydra:kaleid"] },
  { on: "hydra", words: ["colour", "tint", "rgb"], to: ["hydra:color"] },
  { on: "hydra", words: ["saturation", "desaturate", "grey", "gray"], to: ["hydra:saturate"] },
  { on: "hydra", words: ["brighten", "lighten", "exposure"], to: ["hydra:brightness"] },
  { on: "hydra", words: ["negate", "negative"], to: ["hydra:invert"] },
  { on: "hydra", words: ["mix", "crossfade", "fade", "lerp"], to: ["hydra:blend"] },
  { on: "hydra", words: ["multiply"], to: ["hydra:mult"] },
  { on: "hydra", words: ["subtract", "minus"], to: ["hydra:sub"] },
  { on: "hydra", words: ["difference"], to: ["hydra:diff"] },
  { on: "hydra", words: ["over", "overlay", "composite"], to: ["hydra:layer"] },
  { on: "hydra", words: ["clip", "cutout"], to: ["hydra:mask"] },
  { on: "hydra", words: ["threshold"], to: ["hydra:thresh"] },
  { on: "hydra", words: ["quantize", "quantise", "levels"], to: ["hydra:posterize"] },
  { on: "hydra", words: ["pixelize", "pixelise", "mosaic"], to: ["hydra:pixelate"] },
  { on: "hydra", words: ["distort", "displace"], to: ["hydra:modulate"] },
  { on: "hydra", words: ["key", "chromakey"], to: ["hydra:luma"] },
  { on: "hydra", words: ["show", "draw", "display"], to: ["global:out"] },
  { words: ["circle", "polygon", "triangle", "square", "rect"], to: ["hydra:shape"] },
  { words: ["stripes", "sine", "lines"], to: ["hydra:osc"] },
  { words: ["perlin", "simplex"], to: ["hydra:noise"] },
  { words: ["cells", "worley"], to: ["hydra:voronoi"] },
  { words: ["fill", "background"], to: ["hydra:solid"] },
  { words: ["feedback"], to: ["hydra:src", "recipe:feedback trails"] },
  { words: ["clear", "reset", "stop"], to: ["global:hush"] },
  { words: ["tick", "frame", "loop", "animate"], to: ["global:update"] },
  { on: "source", words: ["camera", "webcam"], to: ["source:initCam"] },
  { on: "source", words: ["image", "picture", "load"], to: ["source:initImage"] },
  { on: "source", words: ["video", "movie"], to: ["source:initVideo"] },
  { on: "source", words: ["glsl", "shader"], to: ["source:initScene"] },
];
