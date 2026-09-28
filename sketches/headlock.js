// Challenge, 20 min, 2026-09-28
//   constraint: use at least three outputs and composite them into o0
//   technique:  blend modes: add, mult, diff and layer on the same pair of sources

await use("softpattern", "fractals")

bpm = ao.bpm

energy = () => ao.bass * 0.6 + ao.loudness * 0.4
pixelFactor = () => energy()

// high sun
smoothsun(() => 0.3 * ao.high)
  .pixelate(ao.map("high", 2, 50), ao.map("high", 2, 50))
  .brightness(() => 0.4 * energy())
  .thresh(0.8, 0.3)
  .out(o0)

const highSun = o0

// bass blobs
blobs(
  () => ao.beat,
  () => 0.8 * ao.bass,
  0.1,
)
  .invert()
  .mirrorY()
  .pixelate()
  .out(o1)

const bass = o1

// mid blink
blinking(5, 5, 0.5, () => 0.03 * ao.beat)
  .kaleid()
  .pixelate(220, 10)
  .out(o2)

const midBlink = o2

src(midBlink)
  .mask(src(highSun).saturate(0))
  .mult(bass)
  .add(
    // bass jolt
    src(bass)
      .rotate()
      .scale(0.2)
      .kaleid(2)
      .brightness(ao.map("bass", -2, -0.3))
      .mask(src(highSun).invert()),
  )
  .add(src(highSun).rotate(0, [0.1, 0.12]))
  .saturate(0)
  .color(0.7, 0.85, 0)
  .out(o3)

render(o3)