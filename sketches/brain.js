smoothRippleFactor = ao.glide("bass", 2)

sphere()
  .add(sphere(0.6).move(ao.map("high", 1, 0.6)), ao.map("mid", 0.6, 1))
  .add(sphere(0.6).move(ao.map("mid", -1, -0.6)), ao.map("high", 1, 0.6))
  .ripple(
    0.5,
    () => smoothRippleFactor(),
    () => smoothRippleFactor() * 0.1,
  )
  .out(s0)

gradient()
  .saturate(0)
  .color(ao.map("loudness", 0.35, 0.5), 0.01, 0.7)
  .mask(s0)
  .out()