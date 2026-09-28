// Halo: the spectrum bent into a ring. spectrum() lays the bands out left
// to right, pixelate cuts them into bars, and polar(1) wraps them round,
// lows at the bottom and highs meeting at the top. Before bending, y is the
// distance from the centre, so bars and rings are drawn as horizontal
// bands. The ring breathes with the bass, flashes on hits, and its colour
// follows how bright the sound is (ao.centroid).

inner = () => 0.42 + 0.06 * ao.bass
// Lit above height y, which polar turns into outside a circle of that radius.
above = (y) => gradient().g().thresh(y, 0.004)

bars = spectrum(0.4)
  .pixelate(40, 1)
  .add(solid(1, 1, 1), inner)
  .sub(gradient().g())
  .thresh(0, 0.004) // lit below inner + level
  .mult(above(inner))
  .mult(osc(251.3, 0, 0).scrollX(-0.00625).thresh(0.3, 0)) // gaps between bars

ring = above(() => inner() - 0.035).sub(above(() => inner() - 0.025))

bars
  .mult(osc(4, 0, 2).saturate(1.5))
  .add(ring, () => 0.4 + 1.5 * ao.impulse)
  .hue(() => ao.centroid)
  .polar(1)
  .add(src(o0).scale(1.015), 0.7)
  .out()
