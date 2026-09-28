/**
 * Challenge prompts, one list per bucket. Plain data: add a line to extend a
 * bucket. `hint` is optional and shown only on demand; it names the functions
 * or ideas that help, without giving the answer away.
 */

export type Bucket = "recreate" | "constraint" | "audio-reactive" | "technique";

export interface Prompt {
  text: string;
  hint?: string;
}

export const BUCKETS: readonly Bucket[] = ["recreate", "constraint", "audio-reactive", "technique"];

export const PROMPTS: Record<Bucket, readonly Prompt[]> = {
  recreate: [
    { text: "a lava lamp", hint: "voronoi or noise().thresh() for blobs, a slow scrollY, warm color()" },
    { text: "a CRT with rolling scanlines", hint: "osc(...).rotate(Math.PI / 2) for lines, scrollY with a speed, a little pixelate" },
    { text: "rain on a window at night", hint: "noise stretched with scale(1, 1, 20), scrollY, feedback through src(o0) for streaks" },
    { text: "a Bridget Riley op-art stripe field", hint: "a dense osc, modulate(osc(...)) to bend it, thresh() for hard black and white" },
    { text: "northern lights over a dark horizon", hint: "noise scrolled sideways, masked by a gradient; sketches/aurora.js layers a few curtains" },
    { text: "a campfire seen through heat haze", hint: "modulate(noise(4, 0.5), 0.03) for the shimmer, colours from black through red to yellow" },
    { text: "an old film projector: flicker, grain and dust", hint: "brightness(() => Math.random() * 0.1), noise(300) for grain, a slow vignette with shape(64)" },
    { text: "sunlight caustics on the floor of a swimming pool", hint: "voronoi(8, 0.3) with modulate(noise), thresh or pow-like contrast(3)" },
    { text: "a starfield you fly through", hint: "noise(200).thresh(0.9) for stars, src(o0).scale(1.02) for streaks" },
    { text: "Matrix-style digital rain", hint: "pixelate(40, 60) on noise scrolled down, color(0.2, 1, 0.3), repeatX" },
    { text: "an oscilloscope drawing a Lissajous figure", hint: "shape(32, 0.02) scrolled to (sin(3t), sin(2t)), with src(o0) feedback drawing the trail" },
    { text: "a stained-glass window with light moving behind it", hint: "voronoi for panes, colorama for colour, mult by a moving shape" },
    { text: "a lighthouse beam sweeping through fog", hint: "a thin shape stretched with scale, rotate with speed, noise for fog, add()" },
    { text: "a thermal camera watching a warm moving blob", hint: "a greyscale field, then map brightness to a palette with color() and colorama" },
    { text: "a disco floor of lit tiles", hint: "pixelate or repeat for tiles, a noise that jumps with ao.beat to pick which are lit" },
    { text: "a 70s slit-scan stargate tunnel", hint: "horizontal colour bands scrolled through polar() rush outwards, or src(o0).scale(0.98)" },
    { text: "a vinyl record spinning under a strobe light", hint: "osc turned into grooves with polar(), brightness flashing on ao.beat" },
    { text: "bioluminescent plankton in a breaking wave", hint: "noise(100).thresh for sparks, masked to a moving band, glow via feedback" },
    { text: "a VHS tape on pause: tracking noise and colour bleed", hint: "a horizontal noise band scrolling up, shift() for colour offset, modulateScrollX" },
  ],
  constraint: [
    { text: "only osc and transforms, no noise" },
    { text: "at most 3 lines of code" },
    { text: "black and white only", hint: "finish with saturate(0) or thresh()" },
    { text: "use feedback via src(o0) as the main ingredient", hint: "src(o0).scale(1.01).rotate(0.01).blend(...)" },
    { text: "a single source function, used exactly once" },
    { text: "the only audio value you may use is ao.impulse" },
    { text: "shape() is the only source" },
    { text: "exactly two colours on screen at any time", hint: "thresh() or posterize(2) first, then color() both sides" },
    { text: "no color(), hue() or colorama(): colour may only come from sources" },
    { text: "calm: nothing may cycle faster than once every four seconds" },
    { text: "use at least three outputs and composite them into o0", hint: "build in o1 and o2, then src(o1).blend(src(o2)).out(o0); render(o0)" },
    { text: "no number greater than 10 anywhere in the code" },
    { text: "one chain only, but at least 12 functions long" },
    { text: "voronoi is the only source" },
    { text: "audio sources only: spectrum, history or waveform start every chain" },
    { text: "nothing centred: the focus of the image must sit off-centre", hint: "scroll(), scale with offsetX / offsetY" },
    { text: "every chain ends in polar(): everything is a ring" },
    { text: "no modulate in any form" },
    { text: "only ao.fft or ao.hz may drive motion: no loudness, bass, mid or high" },
  ],
  "audio-reactive": [
    { text: "the kick feels like a heartbeat", hint: "ao.hz(40, 100) or ao.impulse into scale(), with a quick attack and slow release" },
    { text: "make silence as interesting as loud passages", hint: "use () => 1 - ao.loudness to fade in a time-driven layer when it's quiet" },
    { text: "hats sparkle, bass breathes", hint: "ao.hz(6000, 12000) for sparkle, ao.bass on a slow scale or brightness" },
    { text: "the colour follows how bright the music sounds", hint: "hue(() => ao.centroid) or ao.map('peak', ...)" },
    { text: "every beat cuts to a new camera angle", hint: "keep an angle in a global; in update = () => {...} change it when ao.beat crosses 0.5" },
    { text: "loud passages build up slowly instead of flashing", hint: "smooth in update: level += (ao.loudness - level) * 0.02, or accumulate with src(o0)" },
    { text: "the spectrum as a landscape", hint: "history() as the ground, or horizontal lines pushed up by it with modulateScrollY" },
    { text: "the voice draws in the middle, the drums live at the edges", hint: "ao.hz(300, 3000) for the voice, ao.hz(40, 100) and ao.hz(2000, 5000) for drums, mask with shape()" },
    { text: "the visuals flinch at snare hits only", hint: "ao.hz(2000, 5000) times ao.impulse, into scrollX or modulate" },
    { text: "bass pushes outwards, highs pull inwards", hint: "scale(() => 1 + ao.bass - ao.high)" },
    { text: "quiet music gets a warm palette, loud music a cold one", hint: "blend two colour chains by () => ao.loudness" },
    { text: "beatless ambient music still gets motion", hint: "ao.centroid and ao.mid change slowly; drive speeds with them" },
    { text: "each frequency band lights its own stripe", hint: "spectrum().pixelate(16, 1), or repeatX with ao.fftAt" },
    { text: "the visuals echo behind the music", hint: "feedback: src(o0).scale(0.99) with fresh shapes added on ao.impulse" },
    { text: "the beat moves things; it never flashes brightness", hint: "put ao.impulse into rotate, scroll or modulate, not brightness or color" },
    { text: "audio only changes texture, never colour or brightness" },
    { text: "a drop feels like the floor falls away", hint: "watch ao.bass in update; when it jumps after a quiet stretch, trigger a zoom" },
  ],
  technique: [
    { text: "modulate vs modulateScale: the same source distorted both ways, side by side", hint: "modulate(noise(3), 0.1) displaces by colour; modulateScale(osc(8), 0.5) zooms by brightness; show both with render()" },
    { text: "kaleid symmetry: build one wedge, then mirror it with an audio-driven kaleid", hint: "kaleid(nSides); compare rotate before kaleid with rotate after" },
    { text: "masks: show one texture only inside a shape", hint: "a.mask(shape(4, 0.4)), or layer(b.mask(...)) over another source" },
    { text: "polar: bend a horizontal band into a ring, then the spectrum into a halo", hint: "spectrum().pixelate(40, 1).polar(1); see sketches/halo.js" },
    { text: "a first solid: one lit sphere that swells on the kick", hint: "sphere(() => 1 + 0.3 * ao.hz(40, 100)).out() then src(s0).out(); see sketches/urchin.js" },
    { text: "ao.hz ranges: three shapes that answer kick, snare and hats", hint: "kick 40..100, snare body 150..300, crack 2000..5000, hats 6000..12000" },
    { text: "feedback trails: src(o0) with a tiny scale and rotate", hint: "src(o0).scale(1.01).rotate(0.005).blend(fresh, 0.1).out()" },
    { text: "several outputs: two patterns in o1 and o2, crossfaded in o0", hint: "src(o1).blend(src(o2), () => ...).out(o0); render(o0)" },
    { text: "blend modes: add, mult, diff and layer on the same pair of sources", hint: "compare them in four outputs with render()" },
    { text: "keying: layer a source over another using luma", hint: "b.luma(0.5, 0.1) makes dark areas transparent; a.layer(b.luma(...))" },
    { text: "modulateRotate and modulateKaleid: distortion driven by another source", hint: "osc().modulateRotate(noise(2), 1), shape(3).modulateKaleid(osc(4), 2)" },
    { text: "arrays as sequences: step a parameter through values in time", hint: "[1, 2, 4].fast(0.5), .smooth(), .ease('easeInOutCubic')" },
    { text: "lo-fi: pixelate and posterize driven by audio", hint: "pixelate(() => 20 + 200 * ao.high), posterize(() => 2 + 6 * ao.loudness)" },
    { text: "tiling: repeat with an offset for a brick layout, then scroll it", hint: "repeat(4, 4, 0.5, 0), scrollX(0, 0.05)" },
    { text: "ao.map: map three levels onto useful ranges instead of raw 0..1", hint: "ao.map('bass', 1, 1.4), ao.map(() => ao.hz(6000, 12000), 0, 0.2)" },
    { text: "history as a tunnel: the spectrogram bent round into rings", hint: "history().polar(): now at the rim, the past closing in towards the centre" },
    { text: "spectrum bars: light each band up to its level", hint: "spectrum().pixelate(32, 1).sub(gradient().g()).thresh(0, 0.01)" },
    { text: "self-modulation: src(o0) distorting itself", hint: "src(o0).modulate(src(o0), 0.005) plus a small fresh input" },
    { text: "colour from phase: build a palette only with osc's offset", hint: "osc(freq, sync, offset): offset splits r, g and b; then saturate()" },
  ],
};
