await use("softpattern")

smoothCent = ao.glide(() => (ao.loudness > 0.01 ? 1.6 - ao.centroid : 0))

r = ao.glide(() => ao.bass / 2 - 0.1 + ao.impulse / 2)
m = ao.glide(() => ao.mid)
b = ao.glide(() => ao.high / 2)
e = ao.glide(() => ao.energy)

sphere(smoothCent)
  .wobble(() => ao.energy)
  .scale(0.8)
  .add(sphere(() => (ao.energy > 0.5 ? ao.energy + 0.45 : 0)).wobble(r))
  .out(s0, { background: 0 })

gradient(ao.bpm / 100)
  .kaleid(3)
  .repeat()
  .brightness(ao.energy)
  .saturate(0)
  .color(r, () => m() * 0.1, b)
  .out(o0)

src(o0)
  .mask(src(s0))
  .out(o1)

render(o1)