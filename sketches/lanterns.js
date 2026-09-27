// Lanterns: Thomas Jourdan's soft patterns (lib-softpattern), loaded with `use`.
// A wall of paper lanterns glows in its own colours (blinking), slow rings of
// light breathe out across it (concentric), and a smooth sun burns in the
// middle, swelling with the bass and flaring on every hit (smoothsun).

await use("softpattern")

blinking(7, 7, () => 0.2 + 0.8 * ao.mid, 0.03)
  .mult(concentric(4, 2, 0.5, 0.3).brightness(0.15))
  .add(
    smoothsun(() => 0.2 + 0.3 * ao.bass, 0.2, 1, 0.5).color(1, 0.55, 0.2),
    () => 0.5 + 0.8 * ao.impulse,
  )
  .out()
