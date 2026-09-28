await use("fractals")

g = () => ao.impulse * 0.2
b = () => ao.impulse * 0.3

baseSphere = (level, scale = 1) =>
  sphere(2)
    .intersect(torus(1, 0.9).spin(ao.loudness, -ao.loudness))
    .intersect(torus(1).noise().spin())
    .intersect(sphere().spikes(level, level).spin(0.2, 0.3).scale(0.79))
    .spikes(level, level)
    .add(sphere(0.2).wobble().color(1, g, b))
    .wobble(() => ao.bass * ao.loudness)
    .add(sphere(0.2).wobble().spin().color(1, g, b))
    .spin(level, level)
    .scale(scale)
    .color(1 * level, g, b)

baseSphere(ao.mid, 0.7).out(s0)
baseSphere(ao.high, 0.7).out(s1)
baseSphere(ao.bass, 1).out(s2)

src(s0).scrollX(0.36).add(src(s1).scrollX(-0.36)).add(src(s2)).out()