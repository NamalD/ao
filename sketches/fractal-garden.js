// Fractal garden: vendored Hydra extensions, loaded with `use`.
// Thomas Jourdan's domain-warped noise grows the ground, hyper-hydra's
// inversion folds the feedback so shapes keep blooming back from the
// edges, and a gradient map colours the grey by its brightness. The bass
// pushes the warp, hits brighten the petals, mids turn the fold.

await use("noise", "fractals", "gradientmap", "outputs")

// Night soil to moss to pollen; lookupX reads each pixel's brightness.
const palette = createGradient(
  [0.02, 0.02, 0.06],
  [0.06, 0.2, 0.24],
  [0.35, 0.58, 0.36],
  [0.98, 0.78, 0.42],
  [1, 0.96, 0.88],
)

// o1: the garden in grey, folded back into itself every frame. Linear
// filtering (hydra-outputs) keeps the fold smooth instead of grainy.
o1.setLinear()
src(o1)
  .scrollX(-0.5)
  .scrollY(-0.5)
  .inversion()
  .mirrorWrap()
  .scale(1.4)
  .rotate(() => 0.05 * time + 0.3 * ao.mid)
  .blend(warp(2, 0.04, 2, 3, ao.map("bass", 1, 1.8)).add(solid(0.4, 0.4, 0.4)), 0.25)
  .out(o1)

// o0: petals mirrored into a symmetric bed, then coloured.
src(o1)
  .mirrorX(0, 1)
  .contrast(() => 1.2 + 0.5 * ao.impulse)
  .lookupX(palette)
  .out()
