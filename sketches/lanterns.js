// Lanterns: Thomas Jourdan's soft patterns (lib-softpattern), loaded with `use`.
// A wall of paper lanterns glows in its own colours (blinking), slow rings of
// light breathe out across it (concentric), and a smooth sun burns in the
// middle, swelling with the bass and flaring on every hit (smoothsun).

await use("softpattern")

torus()
  .spikes(ao.map("mid", -1, -1.5), ao.map("bass", 1, 8), 4, ao.map("impulse", 0.1, 0.7))
  .noise(0.15, ao.map("bass", 1, 2))
  .spin(0.5, 0)
  .twist(ao.map("bass", 0, 2))
  .intersect(sphere().wobble())
  .add(
    cylinder()
      .noise()
      .intersect(sphere().noise())
      .intersect(sphere(0.4))
      .spikes(ao.map("high", 0.1, 0.9))
      .spin(0.1, 0.1),
  )
  .out(s0)

pixel = ao.map("impulse", 2, 200)
src(s0).out(o3)

render(o3)