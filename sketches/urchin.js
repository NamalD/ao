// Shared with the block below, so it lives on the global object.
globalThis.heat ??= 0
update = (dt) => {
  const target = Math.min(1, 0.7 * ao.loudness + 0.9 * ao.impulse)
  const rate = target > heat ? 8 : 0.7 // bristle fast, melt slowly
  heat += (target - heat) * (1 - Math.exp(-rate * dt * 0.001))
}

red = ao.map(() => heat, 0.3, 1)
blue = ao.map(() => heat, 0.1, 0.01)
sphere(1)
  .wobble(() => 0.1 * (1 - heat), 3, 1)
  .spikes(() => 0.9 * heat, ao.map("bass", 5, 9), 5, ao.map("high", 0.5, 0.9))
  .spectrum(0.25)
  .spin(0.2, 0.4)
  .color(red, 0.01, blue)
  .out(s0, { glow: () => 0.6 + 1.5 * ao.impulse })

src(s0)
  .blend(o0, 0.35)
  .out()
