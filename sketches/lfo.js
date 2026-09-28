// LFO: four tempo-synced waveforms, each shaped from ao.ramp(n), a 0..1 saw
// over n beats that is aligned to the bar. Sine sways the rotation over two bars,
// triangle breathes the scale once a bar, saw sweeps the hue every two beats,
// and square flips the kaleidoscope between 3 and 6 sides each bar.
// Tap Ctrl+Shift+T on the beat to lock them to the music.

const TAU = 2 * Math.PI;
const saw = (n) => ao.ramp(n);
const sine = (n) => 0.5 - 0.5 * Math.cos(TAU * ao.ramp(n));
const tri = (n) => 1 - Math.abs(2 * ao.ramp(n) - 1);
const square = (n) => (ao.ramp(n) < 0.5 ? 1 : 0);

osc(40, 0.05, 1.2)
  .kaleid(() => 3 + 3 * square(4))
  .rotate(() => (sine(8) - 0.5) * Math.PI)
  .scale(() => 0.4 + 0.4 * tri(4))
  .hue(() => saw(2))
  .modulate(noise(2), () => 0.05 + 0.15 * tri(1))
  .blend(src(o0).scale(1.01), 0.5)
  .out();
