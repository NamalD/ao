// Ridges: the recent spectrum as stacked ridgelines, newest at the front,
// like a certain album cover. Every tenth of a second the ridges so far
// step up a line and fade a little, and the spectrum right now is drawn in
// front, lows on the left and highs on the right, with black under it to
// hide the older lines behind. The lines take their colour from the
// harmony (ao.hue).

STEP = 16 // pixels between lines
globalThis.shift ??= 0
let wait = 0
update = (dt) => {
  wait += dt
  shift = wait > 110 ? 1 : 0
  if (shift) wait = 0
}

// How far pixel y sits under the newest ridge (Hydra's y runs down).
under = () =>
  spectrum(0.13)
    .scale(1, 0.72, 1, 0, 0)
    .scrollX(-0.14)
    .add(gradient().g())
    .add(solid(1, 1, 1), -0.88)

// A bright edge over solid black, added only on the frames that step.
// luma(-1) makes it opaque again, since sub subtracts alpha too.
ridge = under()
  .thresh(0, 0)
  .sub(under().thresh(0.004, 0))
  .luma(-1, 0)
  .mask(under().thresh(0, 0))
  .mask(
    solid(
      () => shift,
      () => shift,
      () => shift,
    ),
  )

src(o1)
  .scrollY(() => (shift * STEP) / height)
  .color(
    () => 1 - 0.03 * shift,
    () => 1 - 0.03 * shift,
    () => 1 - 0.03 * shift,
  )
  .layer(ridge)
  .out(o1)

// Keeps only the ridge field, x from 0.14 to 0.86.
field = gradient()
  .r()
  .thresh(0.14, 0)
  .sub(gradient().r().thresh(0.86, 0))

src(o1)
  .mult(field)
  .color(0.75, 0.55, 1)
  .hue(() => ao.hue)
  .add(solid(0.02, 0.02, 0.03))
  .out()
