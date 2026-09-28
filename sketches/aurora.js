// Aurora: curtains of light over a dark horizon. A few thin glowing lines
// sway on slow sine waves, green low down and violet higher up; loudness
// brightens them, the bass stirs them through noise, and faint stars sit
// behind.

// A horizontal line of light `y` above the middle, with a soft glow,
// stretched so the ends of shape(2) sit off-screen.
line = (y, width) => shape(2, width, 0.08).scale(1, 3, 1).scrollY(y)

curtains = line(-0.06, 0.004)
  .add(line(0.03, 0.003), 0.8)
  .add(line(0.1, 0.002), 0.5)
  .add(line(0.17, 0.002), 0.3)
  .modulateScrollY(osc(5, 0.15, 0), 0.1)
  .modulateScrollY(osc(13, -0.2, 0), 0.03)

// Green below the middle, violet above it (Hydra's y runs down).
tint = solid(0.1, 1, 0.55)
  .mult(gradient().g(2.2, -0.6))
  .add(solid(0.65, 0.3, 1).mult(gradient().g(-2.5, 1.2)))

stars = noise(300, 0.2)
  .thresh(0.92, 0)
  .color(0.5, 0.55, 0.7)

glow = () => 0.4 + 0.8 * ao.loudness

curtains
  .mult(tint)
  .color(glow, glow, glow)
  .modulateScrollY(noise(1.5, 0.1), () => 0.02 + 0.05 * ao.bass)
  .add(stars, 0.4)
  .blend(o0, 0.6)
  .out()
