shape(ao.map("bass", 5, 5))
  .color(ao.map("impulse", 0.4, 1), 0.2, 0.2)
  .modulateScale(osc(ao.map("bass", 2, 2.1)), ao.map("bass", 1, 1.5))
  .rotate(0, -0.01)
  .saturate(ao.map("bass", 0.4, 0.8))
  .modulate()
  .blend(
    shape(ao.map("impulse", 5, 5))
      .color(ao.map("bass", 0.4, 1), 0.2, 0.2)
      .rotate(0, -0.02),
    ao.map("impulse", 0.5, 0.52),
  )
  .blend(
    shape(90)
      .color(ao.map("bass", 0.4, 1), 0.2, 0.2)
      .rotate(0, ao.map("impulse", -0.1, -0.101))
      .scale(ao.map("impulse", 0.4, 1.5))
      .mask(noise(ao.map("impulse", 1, 2)))
      .mask(osc()),
    ao.map("mid", 0.3, 0.35),
  )
  .out()
