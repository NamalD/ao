await use("fractals")

louded = (factor) => factor * ao.loudness
z = (factor = 1) => 0.2 * ao.loudness * factor

// bass
box(
  () => louded(1.1),
  () => ao.bass,
  () => ao.bass,
)
  .scale(() => ao.loudness * 2)
  .spin(0.3, 0.2)
  .wobble(
    () => 0.04 * ao.bass,
    () => ao.bpm / 10,
  )
  .twist(() => ao.loudness * 2)
  .noise(() => 0.15 * ao.bass)
  .spikes(
    () => 0.2 * ao.bass,
    () => 8 * ao.bass,
    6,
    () => 0.8 * ao.bass,
  )
  .add(
    box(
      () => louded(0.5),
      () => louded(0.2),
      () => louded(0.3),
    )
      .noise(() => 0.3 * ao.bass)
      .intersect(sphere(0.5))
      .wobble(() => 0.1 * ao.bass)
      .spikes(() => 0.1 * ao.bass),
  )
  .add(
    // high
    sphere(() => ao.high * 2)
      .spin(0.3, 0.2)
      .wobble(() => ao.high)
      .twist(() => ao.high)
      .elongate(0, () => ao.high * 1.5)
      .scale(0.6),
  )
  .add(sphere(() => ao.centroid).wobble(ao.map("impulse", 0, 0.8)))
  .out(s1, { background: 0 })

osc(() => ao.bpm / 2, -0.1, 0.8)
  .modulateRotate(noise(() => ao.bass * 10 + ao.loudness))
  .pixelate(200, () => 50 * ao.bass + ao.loudness)
  .out(o0)

src(o0)
  .mask(src(s1).thresh(0.02, 0.01))
  .out(o1)

render(o1)