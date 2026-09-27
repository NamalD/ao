voronoi()
  // shift colour to red
  .shift(0.5)
  // rotate gradient
  .rotate(7)
  // scroll into left with loudness for impact
  .scrollX(ao.map("loudness", 0, 2))
  .scrollY(ao.map("mid", 0, 2))
  // pixellate to breakup borders between scrolls
  .pixelate(ao.map("loudness", 200, 400), ao.map("loudness", 10, 40))
  // desaturate with bass for impact
  .saturate(ao.map("bass", 0, 1))
  .blend(
    gradient()
      .pixelate(ao.map("treble", 20, 400), ao.map("treble", 20, 400))
      // ensure output stays red
      .color(0, 1, 0),
  )
  .rotate(12.8)
  .repeat(ao.map("loudness", 10, 59), ao.map("bass", 10, 100))
  .color(ao.map("loudness", 0, 1), 0, 0)
  .blend(osc(2, -0.1, 0.6).brightness(ao.map("loudness", 0.0, 0.2)))
  .blend(shape(2), ao.map("loudness", 0, 0.2))
  .out()
