// Rothko: two soft colour fields breathing on a dark ground.
// Bass swells the upper field, mids the lower; noise frays their edges.

solid(0.14, 0.03, 0.05)
  .add(
    shape(4, 0.6, 0.12).scale(1, 1.3, 0.42).scrollY(0.2).color(0.8, 0.22, 0.1),
    () => 0.65 + 0.35 * ao.bass,
  )
  .add(
    shape(4, 0.6, 0.12).scale(1, 1.3, 0.3).scrollY(-0.22).color(0.95, 0.55, 0.18),
    () => 0.55 + 0.45 * ao.mid,
  )
  .modulate(noise(3.5, 0.04), 0.014)
  .add(noise(120, 0.8).color(0.025, 0.02, 0.02))
  .out()
