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
system audio, never the microphone. Window geometry, the last sketch,
`settings.json` (see [Settings](#settings)), and `ao.log` live in `state/`;
past 1 MB the log moves to `ao.log.1`.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+Enter | run the block under the cursor (lines between blank lines) |
| Ctrl+Shift+Enter, Alt+Enter | run the whole sketch |
| Ctrl+S, `:w` | save the sketch |
| Ctrl+N | create a new sketch |
| Ctrl+PgUp / Ctrl+PgDn | previous / next sketch |
| Ctrl+Shift+H | hide or show the editor (ambient mode) |
| Ctrl+Shift+M | show or hide the audio meter |
| Ctrl+Shift+N | night fade: follow the schedule, force on, force off |
| Ctrl+Shift+C | challenge: draw a prompt, or finish the running one |
| F11 | fullscreen |
| F1 | help |
| Ctrl+Q | quit |

The editor uses vim keys: `i` inserts, `Esc` returns to normal mode, `v`/`V`
select, `u` undoes, and `:w` saves. Undo history starts fresh with each sketch
you open.

With the editor hidden, the old single keys work: `j`/`k` switch sketches,
`f` fullscreen, `e` brings the editor back, `i` toggles the FPS counter, `m`
the audio meter, `n` cycles the night fade, `c`
opens a challenge, and `q` or `Esc` quits.

## Sketches

A sketch is a `.js` file in `sketches/`. Opening one runs it. After that,
code runs only when you ask: Ctrl+Enter or Ctrl+Shift+Enter in the overlay.
The overlay autosaves shortly after you stop typing, and Ctrl+S saves at
once; neither re-runs the sketch, and saving an unchanged sketch doesn't write
anything. Saving the file from another editor does re-run it, unless the
overlay has unsaved edits, in which case the status bar says so and Ctrl+S
keeps your version.

If a run fails, the previous visuals keep going and the error shows in the
status bar. Errors while the sketch runs, such as a Hydra argument function,
`update`, or a scene uniform that throws, a timer callback, or a rejected
promise, show there too, once each until the next run; the failing value
falls back to its default and the visuals keep going. Capture problems from
the main process, like missing `parec`, stay on the right of the status bar.

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

**Remote media** works like in Hydra's web editor: sources load images and
video from `http(s)` URLs, and sketches may `fetch` data.

```js
s1.initImage("https://example.com/texture.jpg")
s2.initVideo("https://example.com/loop.mp4")
src(s1).blend(src(s2), () => ao.impulse).out()
```

Hydra requests media with `crossOrigin = "anonymous"`. Under `make run` the
page is a local file and Electron doesn't enforce CORS, so any host works;
under `make dev` the page is served from `localhost`, and WebGL can only
sample media whose host sends CORS headers (`Access-Control-Allow-Origin`).
Scripts still load only from Ao itself, and a sketch can't navigate the
window away from Ao or open new windows.

## Audio meter

Ctrl+Shift+M (`m` with the editor hidden) shows a small meter in the top-right
corner, so you can see what you're mapping instead of guessing: bars and
values for `ao.loudness`, `ao.impulse`, `ao.beat`, `ao.bass`, `ao.mid` and
`ao.high`, and the 64 bands of `ao.fft` with `ao.peak` (white) and
`ao.centroid` (lilac) marked on the spectrum. It is an overlay on top of the
window, not part of the visuals, and draws nothing while hidden. Ao remembers
whether it was showing.

## Night fade

Late at night the visuals ease down to a dimmer brightness so they aren't
glaring. By default the fade runs from 22:00 to 07:00: over the first 45
minutes after 22:00 the brightness eases down to 40%, and over the last 45
minutes before 07:00 it eases back up. Windows may cross midnight. Only the
visuals dim; the editor, status bar, and meter stay as they are.

Ctrl+Shift+N (`n` with the editor hidden) cycles the mode: follow the schedule,
force night on, force it off. The status bar briefly shows the new mode, for
example `night fade: scheduled (active 22:00–07:00)`, and the mode is saved.
The schedule, brightness, and fade length are set in `state/settings.json`.

The fade is a dark layer over the window, so it doesn't reach recordings of the
canvas stream: a recording made at night is captured at full brightness.

## Settings

`state/settings.json` holds your preferences. Ao reads it at startup, so
restart after editing it; toggling the meter or night fade updates just that
field and keeps the rest of the file. Missing or invalid values fall back to
the defaults:

```json
{
  "meter": false,
  "night": {
    "mode": "schedule",
    "start": "22:00",
    "end": "07:00",
    "brightness": 0.4,
    "fadeMinutes": 45,
    "speed": 1
  }
}
```

- `meter`: whether the audio meter is showing.
- `night.mode`: `"schedule"`, `"on"` (always night), or `"off"` (never).
- `night.start`, `night.end`: local 24-hour `HH:MM` times of the window;
  equal times make it empty.
- `night.brightness`: brightness at full night, `0..1`.
- `night.fadeMinutes`: how long the fade takes at each end of the window,
  inside it; a window shorter than two fades never reaches full night.
- `night.speed`: optionally slow Hydra and scene time at night, `0.1..1`, eased
  in with the fade; `1` (the default) leaves speed alone. Audio levels are
  unaffected.

## Challenge mode

Ctrl+Shift+C (or `c` with the editor hidden) draws a challenge to practise
Hydra: one prompt from one of four buckets, **recreate** ("a lava lamp"),
**constraint** ("at most 3 lines of code"), **audio-reactive** ("the kick
feels like a heartbeat"), and **technique** (one-idea drills such as masks,
`setFunction` or a first raymarched scene). Half the time it adds a prompt
from another bucket, a quarter of those times a third, and an eighth of
those a fourth. The card shows the prompts; `H` reveals hints naming useful
functions, `1`/`2`/`3` pick a 5, 10 or 20 minute time box (10 by default),
`R` re-rolls, `Enter` starts and `Esc` dismisses.

Starting creates and opens a sketch named `challenge-YYYY-MM-DD-<slug>` whose
header comment holds the prompt, and the status bar counts down. When time
runs out, or you press Ctrl+Shift+C and then `Enter` to finish early, Ao saves
the sketch, briefly hides the editor and status bar to snapshot the visuals to
`state/challenges/<sketch>.png`, and appends a record (prompts and buckets,
sketch, start and end times, duration, time box, whether you finished early,
snapshot path) to `state/challenges.json`. Challenge sketches are git-ignored
(`sketches/challenge-*.js`), so attempts don't clutter the example sketches.
Prompts live in `src/shared/challenge-prompts.ts`; add a line to extend a
bucket.

## Screenshots

`make screenshot SKETCH=dunes` renders a sketch offscreen with a synthetic
kick-and-pad signal and writes `state/dunes.png`. Useful for checking a
change without watching the screen, and it prints the frame rate it reached.
Screenshots ignore `settings.json`, so the meter and night fade stay out of
them unless you ask: add `--meter` or `--night=on` to the `electron` command
(`npx electron . --sketch=dunes --hide-editor --meter --screenshot=state/dunes.png`).

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
