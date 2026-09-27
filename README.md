# Ao

Ao is a personal Linux/Wayland ambient audio visualizer you live-code. It
captures whatever PipeWire is playing and drives sketches written in
[Hydra](https://hydra.ojack.xyz/)'s pattern language, raw GLSL scenes, or
both composed together, with the code floating over the visuals.

## Run

```sh
make run      # build and start
make dev      # Vite hot reload for Ao itself; restarts on main-process edits
make test     # typecheck, unit tests, production build
```

It needs Node 22+, and `parec`/`pactl` (PipeWire's PulseAudio tools) for
capture. Ao listens to the default output's `.monitor` source, so it hears
system audio, never the microphone. Window geometry, the last sketch, and
`ao.log` live in `state/`; past 1 MB the log moves to `ao.log.1`.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+Enter | run the block under the cursor (lines between blank lines) |
| Ctrl+Shift+Enter, Alt+Enter | run the whole sketch |
| Ctrl+S | save the sketch |
| Ctrl+PgUp / Ctrl+PgDn | previous / next sketch |
| Ctrl+Shift+H | hide or show the editor (ambient mode) |
| F11 | fullscreen |
| F1 | help |
| Ctrl+Q | quit |

With the editor hidden, the old single keys work: `j`/`k` switch sketches,
`f` fullscreen, `e` brings the editor back, `i` toggles the FPS counter, and
`q` or `Esc` quits.

## Sketches

A sketch is a `.js` file in `sketches/`. Opening one runs it; saving it from
the overlay or any other editor re-runs it. If a run fails, the previous
visuals keep going and the error shows in the status bar.

**Patterns** are plain Hydra. Every Hydra function is available, and the
global `ao` object carries the audio:

```js
osc(20, 0.05, () => 1 + ao.bass)
  .rotate(ao.map("mid", 0, 0.5))
  .modulate(noise(3), () => 0.2 * ao.impulse)
  .out()
```

`ao.loudness` is the sustained level, `ao.impulse` a transient envelope that
jumps on hits and decays within a fraction of a second, `ao.beat` a short
onset pulse, `ao.bass`/`ao.mid`/`ao.high` band averages, and `ao.fft` 64
log-spaced band levels. All run 0..1. `setFunction` registers custom GLSL
functions that then chain like built-ins (see `sketches/aurora.js`).

For finer control over the spectrum, `ao.hz(lo, hi)` averages any frequency
range in Hz, `ao.fftAt(x)` samples it at a position 0..1 like GLSL `aoFFT`,
and `ao.peak` and `ao.centroid` give the loudest band's position and the
overall brightness on that same 0..1 axis, handy for colour. `ao.map` takes a
level name or any function:

```js
shape(4, ao.map(() => ao.hz(40, 100), 0.2, 0.6))  // kick
  .rotate(() => 2 * ao.hz(6000, 12000))           // hats
  .color(1, 0.5, 0.2).hue(() => ao.centroid)
  .out()
```

See `TYPES.md` for the full `ao` interface, and `sketches/prism.js` and
`sketches/halo.js` for examples.

**Scenes** are Shadertoy-style GLSL ES 3.0 fragment shaders loaded into a
Hydra source, so they can be shown directly or remixed with patterns:

```js
s0.initScene(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime + 6.0 * aoFFT(uv.x)), 1.0);
}`, { scale: 0.75, uniforms: { swirl: () => ao.mid } })

src(s0).modulate(osc(8), 0.02).out()
```

Scenes get `iResolution`, `iTime`, `iTimeDelta`, `iFrame`, the audio levels as
`aoLoudness`, `aoImpulse`, `aoBeat`, `aoBass`, `aoMid`, and `aoHigh`, and
`aoFFT(x)` to sample the spectrum. `scale` renders at a fraction of the output
resolution for heavy raymarchers; `uniforms` feeds extra values, declared in
the shader as `uniform float name;`. Shader errors report line numbers within
the scene string. `sketches/dunes.js` is a full raymarched landscape.

Each evaluation runs in its own function scope, so re-running a block that
declares `const` works; share values between blocks through globals.

## Screenshots

`make screenshot SKETCH=dunes` renders a sketch offscreen with a synthetic
kick-and-pad signal and writes `state/dunes.png`. Useful for checking a
change without watching the screen, and it prints the frame rate it reached.

## Layout

- `src/main`: Electron main process, audio capture, state and sketch files.
- `src/shared`: audio analysis (FFT, loudness, impulse, beat), kept pure.
- `src/preload`: the narrow bridge the renderer may call.
- `src/renderer`: Hydra host, GLSL scene runner, overlay editor.
- `sketches`: the visualizers.

## Parallel development

For concurrent feature work, create an isolated checkout rather than editing
the primary checkout:

```sh
make worktree-create NAME=short-feature-name
cd .worktrees/short-feature-name
```

Use `make worktree-list` to see active worktrees. From the primary checkout,
`make worktree-remove NAME=short-feature-name` removes a clean worktree after
handoff; it leaves the branch intact for review or merge.
