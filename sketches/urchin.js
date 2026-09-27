// Urchin: a liquid ball that bristles with spikes when the song gets intense.
// Quiet passages leave a slowly wobbling blob; loud, hit-heavy passages push
// spikes out fast and they melt back slowly. Each spike has its own length,
// all of them grow longer where the spectrum is loud, and the heat turns the
// ball from cool blue to magenta.

// Shared with the block below, so it lives on the global object.
globalThis.heat ??= 0
update = (dt) => {
  const target = Math.min(1, 0.7 * ao.loudness + 0.9 * ao.impulse)
  const rate = target > heat ? 8 : 0.7 // bristle fast, melt slowly
  heat += (target - heat) * (1 - Math.exp(-rate * dt * 0.001))
}

const red = ao.map(() => heat, 0.3, 1)
const blue = ao.map(() => heat, 1, 0.6)
sphere(1)
  .wobble(() => 0.1 * (1 - heat), 3, 1)
  .spikes(() => 0.9 * heat, 9, 5, 0.7)
  .spectrum(0.25)
  .spin(0.2, 0.4)
  .color(red, 0.35, blue)
  .out(s0, { glow: () => 0.6 + 1.5 * ao.impulse })

src(s0).blend(o0, 0.35).out()
