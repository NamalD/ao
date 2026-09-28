// Challenge, 20 min, 2026-09-28
//   constraint: use at least three outputs and composite them into o0
//   technique:  blend modes: add, mult, diff and layer on the same pair of sources

await use("softpattern", "fractals")

energy = () => ao.bass * 0.6 + ao.loudness * 0.4
pixelFactor = () => energy()

// high sun
smoothsun(() => 0.3 * ao.high)
  .pixelate(ao.map("high", 8, 50), ao.map("high", 8, 50))
  .brightness(ao.map(() => 0.4 * energy() + ao.loudness / 6 + ao.high * 2, 0.3, 0.5))
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
  .brightness(() => -0.5)
  .out(o1)

const bass = o1

// mid blink
blinking(5, 5, ao.beat > 0.9 ? 1 : 0, () => 0.03 * ao.beat)
  .pixelate(220, 10)
  .kaleid(ao.map("mid", 2, 9))
  .saturate(0)
  .out(o2)

const midBlink = o2

solid(0, 0, 0)
  .layer(
    src(midBlink)
      .add(
        src(highSun)
          .rotate(0, () => ao.drop + 0.1 * ao.loudness)
          .scrollX(ao.map("high", 0, 0.2))
          .pixelate(
            () => 20 * ao.high + 20,
            () => 20 * ao.high + 20,
          )
          .thresh(0.8, 0.04)
          .mirrorX(),
      )
      .mask(src(highSun))
      .mult(bass)
      .mask(
        src(midBlink)
          .mask(highSun)
          .pixelate(ao.map("beat", 2, 20))
          .thresh(0.2, 0.01)
          .brightness(ao.map("beat", -0.4, -0.2)),
      )
      .add(
        // bass jolt
        src(bass)
          .rotate(10, () => ao.drop + 0.1 * ao.loudness)
          .scale(0.2)
          .kaleid(2)
          .brightness(ao.map("energy", -2, -0.5))
          .mask(src(highSun).invert().scale(1.5)),
      )
      .add(src(highSun).rotate(0, [0.1, 0.12]))
      .mask(
        smoothsun(() => 0.4 * ao.loudness)
          .pixelate(100, 100)
          .thresh(0.8, 0.9),
      )
      .add(src(highSun).pixelate(10, 10).thresh(0.8, 0.9))
      // .brightness(() => ao.loudness - 0.3)
      .saturate(0)
      .color(0.6, 0.85, 0),
  )
  .out(o3)

render(o3)