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
| Ctrl+S, `:w` | save the sketch |
| Ctrl+N | create a new sketch |
| Ctrl+PgUp / Ctrl+PgDn | previous / next sketch |
| Ctrl+Shift+H | hide or show the editor (ambient mode) |
| F11 | fullscreen |
| F9 | start or stop recording video with audio |
| F1 | help |
| Ctrl+Q | quit |

The editor uses vim keys: `i` inserts, `Esc` returns to normal mode, `v`/`V`
select, `u` undoes, and `:w` saves. Undo history starts fresh with each sketch
you open.

With the editor hidden, the old single keys work: `j`/`k` switch sketches,
`f` fullscreen, `e` brings the editor back, `i` toggles the FPS counter, `r`
starts or stops recording, and `q` or `Esc` quits.

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

## Recording

F9 (or `r` with the editor hidden) records the visuals with the system audio
to `~/Videos/Ao/ao-YYYYMMDD-HHMMSS-<sketch>.webm`; press it again to stop.
The folder is `Ao` inside your XDG videos folder, created if needed, with
`~/Videos/Ao` and then `/tmp/Ao` as fallbacks. A red `● REC` and the elapsed
time show in the status bar, in ambient mode too, and when you stop, the
saved path shows there and in `state/ao.log`.

Only the canvas is recorded, so the editor, status bar and help never appear
in the video. The sound comes from the same `parec` capture of the default
output's monitor that drives the visuals, so it is what you hear, never the
microphone. While recording, the main process sends that PCM straight to an
AudioWorklet in the renderer, which plays it through a 50 ms jitter buffer
into the recording's audio track; it never reaches your speakers. One
MediaRecorder encodes the canvas, at up to 60 fps, and that track as WebM:
VP9 (or VP8) video at about 16 Mbit/s with Opus audio. Nothing extra runs
while you aren't recording, and no external tools are needed.

The file is written as it records, one chunk a second, so a long recording
never sits in memory. Quitting or closing the window while recording
finishes the file first. Things to know:

- If capture isn't working (no `parec`, say), the recording is video only,
  and the indicator says so.
- The recorded audio runs about 50 ms behind the live sound, and the
  visuals, which react to the same capture, a frame or so behind it, so in
  the video they land within a couple of frames of each other.
- MediaRecorder writes WebM without a duration; Ao fills it in when you
  stop. There is no seek index either, so some players seek slowly;
  `ffmpeg -i in.webm -c copy out.webm` adds one.
- If Ao is killed rather than quit, the file keeps everything up to the last
  second or so, without a duration.
- The video follows the canvas's size; resizing the window mid-recording
  changes the frame size, which some players and editors handle poorly.
- A heavy sketch records at whatever frame rate it renders.

`--record-seconds=N` records the first N seconds once the sketch is up, then
quits, for making clips from a script:

```sh
npx electron . --sketch=dunes --hide-editor --record-seconds=30
```

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
