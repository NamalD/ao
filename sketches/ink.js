// Ink: dye blooming through water. The output feeds back into itself (o0),
// drifting and fading, while every hit drops fresh colour into the centre.

src(o0)
  .modulate(noise(2, 0.06), 0.004)
  .scale(1.004)
  .rotate(() => 0.001 + 0.004 * ao.mid)
  .color(0.95, 0.94, 0.96)
  .add(
    shape(48, () => 0.02 + 0.1 * ao.impulse, 0.15).color(1, 0.4, 0.65),
    () => 0.5 * ao.impulse * ao.impulse,
  )
  .add(
    shape(48, 0.01, 0.2)
      .color(0.25, 0.55, 1)
      .scrollX(() => 0.25 * Math.sin(time * 0.4))
      .scrollY(() => 0.18 * Math.cos(time * 0.3)),
    0.08,
  )
  .out()
