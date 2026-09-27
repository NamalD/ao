// Tempo: motion locked to the beat clock (ao.phase, ao.bar, ao.ramp), not
// to loudness. The square snaps an eighth of a turn on each beat and kicks with
// ao.pulse(); the outline turns once per bar. Its side count is a Hydra
// array sequence: Ao keeps Hydra's bpm on the tempo, so it steps on each
// beat (3, 4, 5, 6) and starts over on the bar. Tap Ctrl+Shift+T (or t)
// on each beat, starting on the one, to set the tempo and the bar by hand.

shape(4, 0.2, 0.01)
  .rotate(() => (ao.bar + Math.min(1, 5 * ao.phase)) * Math.PI / 4)
  .scale(() => 1 + 0.3 * ao.pulse())
  .color(1, 0.45, 0.15)
  .add(shape([3, 4, 5, 6], 0.5, 0.01).diff(shape([3, 4, 5, 6], 0.46, 0.01))
         .rotate(() => 2 * Math.PI * ao.ramp(4))
         .color(0.35, 0.75, 1))
  .blend(src(o0).scale(1.01), 0.6)
  .out()
