// Prism: every layer listens to its own slice of the spectrum.
// The kick (40-100 Hz) swells the core, the mids (300 Hz-2 kHz) spin and
// light the petals, the hats (6-12 kHz) scatter sparks, and the loudest
// frequency, ao.peak, turns the colour wheel.

// Shared with the block below, so it lives on the global object.
globalThis.spin ??= 0
update = (dt) => { spin += dt * 0.001 * (0.1 + 2 * ao.hz(300, 2000)) }

shape(6, ao.map(() => ao.hz(40, 100), 0.1, 0.35), 0.25)
  .color(1, 0.5, 0.25)
  .add(shape(3, 0.07, 0.02).scroll(0.22, 0.5).kaleid(9).rotate(() => spin)
         .color(0.35, 0.65, 1), ao.map(() => ao.hz(300, 2000), 0.3, 1.5))
  .add(noise(90, 0.5).thresh(0.8, 0.01).mult(shape(64, 0.6, 0.4))
         .color(0.8, 0.9, 1), () => 4 * ao.hz(6000, 12000))
  .scale(1, innerHeight / innerWidth)
  .hue(() => ao.peak)
  .blend(o0, 0.5)
  .out()
