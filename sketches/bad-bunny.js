await use("fractals")

bpm = ao.glide("bpm", 2)
mid = ao.glide("mid", 2)
impulse = ao.glide("impulse", 2)
loudness = ao.glide("loudness", 2)

grad = () =>
  gradient()
    .color(1, 0.3, 0.4)
    .shift(0, 0, () => ao.bass * 0.2)
    .rotate(() => impulse() * 2, 0.5)
    .scale(
      1.3,
      1,
      1,
      () => ao.bass,
      () => ao.high,
    )
    .saturate(1.5)

sphere()
  .spin(0, 0, 0.5)
  .elongate(0, 0.8)
  .noise(() => 0.15 * mid())
  .ripple(
    () => bpm() / 1000,
    () => bpm() * impulse() * 0.8,
  )
  .sub(box(2.5, 1.5, 4).move(0, -1))
  .scale(() => loudness())
  .out(s0)

grad().mask(src(s0)).scrollY(-0.2).out()