// Interference: hyper-hydra's arithmetics does maths on colours, so a ripple
// is just distance, minus time, through a sine. Two ripple sources overlap
// into a moiré; the waves step out one wavelength per beat on the tempo
// clock, the bass tightens them, and the harmony picks the hue.

await use("arithmetics")

// Distance from the point (a, b), measured from the centre, built from the
// x and y ramps with maths on colours; then rings moving outward each beat.
const ripples = (a, b) =>
  xCenter()
    .sub(a)
    .abs()
    .pow(2)
    .add(yCenter().sub(b).abs().pow(2))
    .sqrt()
    .mult(() => 55 + 20 * ao.bass)
    .sub(() => 2 * Math.PI * (ao.bar + ao.phase))
    .sin()

ripples(0.16, 0.04)
  .add(ripples(-0.16, -0.04))
  .mult(0.5)
  .unipolar()
  .pow(() => 1.5 + 2 * ao.impulse)
  .color(0.35, 0.8, 1)
  .hue(() => ao.hue)
  .out()
