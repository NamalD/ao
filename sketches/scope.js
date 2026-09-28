// Scope: an oscilloscope trace of the waveform, held still by the trigger.
// waveform() draws the line, the dominant pitch class (ao.hue) picks its
// colour, the twelve chroma levels glow as a ring of dots, and stereo
// balance tilts the whole display. Feedback adds phosphor afterglow.

trace = waveform(0.006, 0.6)
  .add(waveform(0.04, 0.6), () => 0.1 + 0.25 * ao.loudness) // soft glow
  .color(1, 0.35, 0.35) // red, turned to the key's hue
  .hue(() => ao.hue)

// A faint graticule of square cells on a 16:9 screen.
grid = shape(4, 0.96, 0)
  .invert()
  .repeat(14.2, 8)
  .color(0.05, 0.07, 0.06)

// The chroma ring near the bottom: one dot per pitch class, C at the top,
// going clockwise. Scrolling by -x moves a shape right (Hydra's y runs down).
dots = solid(0, 0, 0)
for (let i = 0; i < 12; i++) {
  const a = (2 * Math.PI * i) / 12
  dots = dots.add(
    shape(24, 0.016, 0.012)
      .scale(1, 9 / 16, 1)
      .scroll(-0.04 * Math.sin(a), -(0.36 - 0.07 * Math.cos(a)))
      .color(1, 0.5, 0.5)
      .hue(i / 12),
    () => 0.12 + ao.chroma[i] ** 2,
  )
}

trace
  .add(grid)
  .add(dots)
  .rotate(() => -0.12 * ao.balance)
  .blend(src(o0).scale(1.003), 0.45) // phosphor persistence
  .out()
