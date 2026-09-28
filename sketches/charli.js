await use("fractals", "softpattern")

bpm = ao.bpm

smoothBeat = ao.

smoothsun(() => ao.beat * 0.3)
  .mask(
    shape([5, 3])
      .mirrorY([0])
      .rotate(0, 1)
      .scale(() => 1.5 * ao.beat)
      .repeat()
      .kaleid([3, 9]),
  )
  .add()
  .color(0.7, 0.8, 0)
  .out()