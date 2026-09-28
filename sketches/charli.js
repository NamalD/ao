await use("softpattern", "fractals")

bpm = ao.bpm

shape(3, 0.3, ao.map("bass", 0.4, 0.3))
  .scrollY(ao.map("bass", 0.05, 0.1))
  .scale(1.8)
  .kaleid(5)
  .rotate(0, () => ao.bar / 10)
  .mirrorY(0, 0.5)
  .mirrorX()
  .add(shape(4).scale().invert())
  .thresh(0.9)
  .color(0.7, 0.85, 0)
  .out()