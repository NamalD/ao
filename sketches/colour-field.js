base = (level, i, sides = 4) => {
  return shape(sides, 0.1, 0.01)
    .repeat(i + 8, (i + 5) * 2)
    .scroll(0.01, 0.02, ao.map(level, 0.011, 0.011001), ao.map("impulse", 0.012, 0.012001))
    .modulate(osc(2), ao.map(level, 0.1, 0.2))
    .scrollX(0, -0.01 * i)
    .mask(gradient())
}

;["beat", "bass", "mid"]
  .map((level, i) => base(level, i))
  .reduce((agg, cur) => {
    return agg == null
      ? cur
      : agg
          .blend(cur, ao.map("bpm", 0.2, 0.4))
          .modulate(noise())
          .pixelate(17, 8)
          .a(1.18)
  }, null)
  .blend(base("high", 4, 20).mask(osc(ao.bpm, 0.1)))
  .blend(base("bass", 5).pixelate().a(2))
  .out()