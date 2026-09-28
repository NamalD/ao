// Dunes: flying low over a desert at golden hour, as a solid. The floor is
// a plane heaped into dunes by noise and rippled by the wind, fading into a
// warm haze under a low sun. Loudness sets the flight speed, the bass
// thickens the haze, the beat swells the sun, and hits flare the light.
// Hydra adds the sun and a little heat shimmer.

// Shared with the block below, so it lives on the global object.
globalThis.travel ??= 0
update = (dt) => {
  travel += dt * 0.001 * (0.2 + 0.8 * ao.loudness)
}

haze = () => [0.8 + 0.1 * ao.bass, 0.62 + 0.08 * ao.bass, 0.5 + 0.05 * ao.bass]

plane(-0.8)
  .noise(0.45, 0.4, 0) // the dunes
  .wobble(0.04, 24, 0.3) // wind ripples
  .move(0, 0, () => travel)
  .rotate(0.1, 0.5, 0)
  .color(0.9, 0.58, 0.34)
  .out(s0, { background: haze, glow: () => 0.2 + ao.impulse, camera: 3 })

sun = shape(48, () => 0.035 + 0.01 * ao.beat, 0.03)
  .scale(1, 9 / 16, 1)
  .scroll(-0.3, 0.28) // up and to the right (Hydra's y runs down)
  .color(1, 0.95, 0.85)

src(s0)
  .add(sun, 0.8)
  .scale(1.02)
  .modulate(noise(2.5, 0.2), () => 0.0015 + 0.004 * ao.impulse)
  .out()
