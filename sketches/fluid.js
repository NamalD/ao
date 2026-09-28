// Fluid: ink stirred through water by the music, made from feedback. Each
// frame the last one drifts on a slowly turning flow of noise and fades a
// little. Three stirrers wander the water: hits drop fresh ink in the key's
// colours, the bass pushes the flow harder, mids spin up eddies, and quiet
// passages let the ink fade.

await use("outputs")
o1.setLinear() // smooth feedback, so the ink stays soft as it drifts

// One wandering stirrer, a soft dot on a 16:9 screen.
stirrer = (i) =>
  shape(32, 0.05, 0.1)
    .scale(1, 9 / 16, 1)
    .scroll(
      () => 0.3 * Math.sin(time * (0.21 + 0.07 * i) + 2 * i),
      () => 0.25 * Math.cos(time * (0.17 + 0.05 * i) + 4 * i),
    )
    .color(1, 0.35, 0.35) // red, turned to the key's hue and its neighbours
    .hue(() => ao.hue + i / 6)

ink = stirrer(0)
  .add(stirrer(1))
  .add(stirrer(2))

fade = () => 0.96 + 0.03 * Math.min(1, 2 * ao.loudness)

// The water, in o1: last frame's ink, moved on and faded, plus fresh drops.
src(o1)
  .modulate(noise(2, 0.05), () => 0.002 + 0.008 * ao.bass)
  .modulateRotate(noise(1.2, 0.05), () => 0.01 + 0.08 * ao.mid)
  .color(fade, fade, fade)
  .add(ink, () => 0.01 + 0.3 * ao.impulse)
  .out(o1)

src(o1)
  .add(solid(0.01, 0.015, 0.035))
  .out()
