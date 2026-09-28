// Challenge, 20 min, 2026-09-28
//   constraint: use at least three outputs and composite them into o0
//   technique:  blend modes: add, mult, diff and layer on the same pair of sources

await use("softpattern")

smoothsun().out(o0)

blobs().out(o1)

blinking()
  .kaleid()
  .pixelate()
  .rotate(0, -0.1)
  .out(o2)

// src(o0)
//   .layer(src(o1))
//   .diff(src(o2))
//   .diff(src(o1))
//   .add(src(o1))
//   .mult(src(o1))
//   .out(o3)
src(o1)
  .add(o2)
  .out(o3)

render()