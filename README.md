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
| Ctrl+Enter | run and format the block under the cursor (lines between blank lines) |
| Ctrl+Shift+Enter, Alt+Enter | run and format the whole sketch |
| Ctrl+S, `:w` | save the sketch |
| `:w <name>`, `:w! <name>` | save as `sketches/<name>.js` and rename the sketch (`!` replaces an existing one) |
| Alt+scroll, Alt+drag | scrub the number under the pointer; Shift steps ten times coarser |
| Alt+R | remix the numbers in the block under the cursor |
| Ctrl+N | create a new sketch |
| Ctrl+PgUp / Ctrl+PgDn | previous / next sketch, crossfading |
| Ctrl+O | browse sketches by thumbnail (see [Sketch browser](#sketch-browser)) |
| Ctrl+Shift+A | autopilot on or off: shuffle sketches on drops, section changes and a timer |
| Ctrl+Shift+H | hide or show the editor (ambient mode) |
| Ctrl+Shift+M | show or hide the audio meter |
| Ctrl+Shift+L | show or hide live values beside `ao` expressions in the code |
| Ctrl+Shift+N | night fade: follow the schedule, force on, force off |
| Ctrl+Shift+C | challenge: draw a prompt, or finish the running one |
| Ctrl+Shift+T | tap tempo on each beat, starting on the one; two quick taps return to auto (see [Tempo](#tempo)) |
| F11 | fullscreen |
| F9 | start or stop recording video with audio |
| F1 | help |
| F2 | code explorer: `ao`, Hydra and recipes, with live examples |
| Ctrl+Q | quit |

The editor uses vim keys: `i` inserts, `Esc` returns to normal mode, `v`/`V`
select, `u` undoes, and `:w` saves. Undo history starts fresh with each sketch
you open. `:w <name>` renames the open sketch, keeping its undo history; it
refuses a name that's taken unless you write `:w! <name>`.

`K` in normal mode opens the code explorer on the word under the cursor.

With the editor hidden, the old single keys work: `j`/`k` switch sketches,
`a` toggles autopilot, `f` fullscreen, `e` brings the editor back, `i` toggles the FPS counter, `m`
the audio meter, `n` cycles the night fade, `c` opens a challenge, `r` starts
or stops recording, `o` opens the sketch browser, `t` taps the tempo, and `q` or `Esc` quits.

## Sketches

A sketch is a `.js` file in `sketches/`. Opening one runs it. After that,
code runs only when you ask: Ctrl+Enter or Ctrl+Shift+Enter in the overlay.
The overlay autosaves shortly after you stop typing, and Ctrl+S saves at
once; neither re-runs the sketch, and saving an unchanged sketch doesn't write
anything. Saving the file from another editor does re-run it, unless the
overlay has unsaved edits, in which case the status bar says so and Ctrl+S
keeps your version.

**Formatting.** Ctrl+Enter and Ctrl+Shift+Enter format the code they run
with [Prettier](https://prettier.io/): double quotes, no semicolons, lines up
to 100 columns. The code runs first, so formatting never delays it. The
cursor stays on the same code, the formatting is its own undo step, and
autosave saves it. Code that doesn't parse is left as you wrote it, and so is
the inside of scene and `glsl:` strings. Scrubbing and remix don't format. Set `"format": false` in
[`settings.json`](#settings) to turn this off.

**Scrubbing and remix.** Hold Alt and scroll over a number, or Alt+drag it
sideways, and the block around it re-runs as it changes. Each step is the
number's last decimal place, so `0.05` moves by `0.01` and `10` by `1`; write
`0.050` for finer steps, or hold Shift for steps ten times coarser. Numbers
can cross zero. Alt+R remixes the block under the cursor instead: each number
moves 10–40% up or down, keeping its sign and decimal places, and integers
stay integers. Both work on GLSL floats inside `initScene` and `glsl:` strings
too, re-running the whole scene; remix leaves GLSL integers (loop counts,
indices) alone, and neither touches other strings or comments. A whole scrub
gesture, or a whole remix, is one undo step: `u` or Ctrl+Z brings the exact
text back, and autosave then saves that too.

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
`aoLoudness`, `aoImpulse`, `aoBeat`, `aoBass`, `aoMid`, and `aoHigh`, the
tempo as `aoBpm`, `aoPhase` and `aoBar` (see [Tempo](#tempo)), and
`aoFFT(x)` to sample the spectrum. `scale` renders at a fraction of the output
resolution for heavy raymarchers; `uniforms` feeds extra values, declared in
the shader as `uniform float name;`. Shader errors report line numbers within
the scene string. `sketches/dunes.js` is a full raymarched landscape.

**Solids** are 3D shapes written like Hydra chains, with no GLSL. A shape
starts the chain, methods move, warp and colour it, and `.out(s0)` raymarches
it, lit and shaded, into a source you then use like any other:

```js
sphere(1)
  .wobble(0.1)                        // a slow liquid swell
  .spikes(() => ao.impulse, 9, 5)     // bristles on hits
  .spin(0.2, 0.4)
  .color(1, 0.3, 0.6)
  .out(s0, { glow: () => ao.bass })

src(s0).blend(o0, 0.3).out()
```

Shapes are `sphere`, `box`, `torus`, `cylinder`, `octahedron` and `plane`.
Methods place the solid (`move`, `rotate`, `spin`, `scale`, `repeat`,
`twist`), shape its surface (`spikes`, `wobble`, `noise`, `spectrum`, `round`,
`shell`), colour it (`color`), and combine it with another solid (`add`,
`sub`, `intersect`), where a second argument such as `.add(sphere(0.5).move(1), 0.4)`
melts the two together like liquid. As in Hydra, every argument can be a
number or a function read each frame. Numbers become uniforms too, so
scrubbing one never recompiles the shader. `out` takes `{ scale, camera,
background, glow, step }`; lower `step` if very long spikes or strong twists
tear. Completion and signature help know solid chains apart from Hydra ones.
`sketches/urchin.js` is a ball that turns spiky when the song gets intense.

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

### Waveform, spectrogram and harmony

Beyond levels and the spectrum, Ao hands sketches and scenes the shape of
the sound. `ao.wave` is the newest ~21 ms of waveform, 512 values `-1..1`,
trigger-aligned like an oscilloscope so a steady tone holds still, and
scenes read it as `aoWaveAt(x)`. Scenes also get `aoHistory(x, age)`, the
spectrum over the last 5.12 s (age `0` now, `1` oldest) for waterfalls and
terrain. `ao.balance` (`-1` left .. `1` right) and `ao.width` (`0` mono ..
`1` wide) describe the stereo image. `ao.chroma` holds 12 pitch-class
levels, C to B, and `ao.key` the strongest (`0..11`), so colour can follow
the harmony: `ao.hue` is `ao.key / 12`.

```js
s0.initScene(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 tint = 0.5 + 0.5 * cos(6.2832 * (aoKey / 12. + vec3(0., .33, .67)));
  float scope = smoothstep(0.01, 0., abs(uv.y - 0.5 - 0.4 * aoWaveAt(uv.x)));
  fragColor = vec4(tint * (aoHistory(uv.x, uv.y) + scope), 1.);
}`)
src(s0).out()
```

Scenes see these as `aoWave`, `aoSpectrogram`, `aoBalance`, `aoWidth`,
`aoChroma[12]` and `aoKey`; `TYPES.md` has the details, and
`sketches/scope.js` and `sketches/ridges.js` show them off.

## Hydra extensions

Ao bundles a few third-party Hydra extensions. A sketch loads them with
`use`, before using what they add:

```js
await use("fractals", "noise")

warp(2, 0.04, 2, 3, ao.map("bass", 1, 1.8))
  .blend(src(o0).inversion().mirrorWrap().scale(1.4), 0.7)
  .out()
```

| Name | From | Adds |
| --- | --- | --- |
| `noise` | Thomas Jourdan's [extra-shaders-for-hydra](https://gitlab.com/metagrowing/extra-shaders-for-hydra) `lib-noise.js` | Noise generators: `whitenoise`, `colornoise`, `unoise`, `turb`, `uturb`, `warp` (domain warping), `cwarp`, `ncontour`. `turb(4, 0.1, 3)` |
| `softpattern` | the same, `lib-softpattern.js` | Soft animated patterns: `blinking`, `blobs`, `concentric`, `phasenoise`, `sdfmove`, `smoothsun`. `blinking(8, 3, 0.5)` |
| `fractals` | geikha's [hyper-hydra](https://github.com/geikha/hyper-hydra) `hydra-fractals.js` | Folds for fractal feedback: `.mirrorX(pos, coverage)`, `.mirrorY`, `.mirrorX2`, `.mirrorY2`, `.mirrorWrap()`, `.inversion()`. `src(o0).inversion().mirrorWrap()` |
| `outputs` | hyper-hydra, `hydra-outputs.js` | Output framebuffer settings: `o1.setLinear()` for smooth feedback, `setNearest()`, `clear()`, `setFbos({ mag, min })`, and `oS` for all four outputs. `o1.setLinear()` |
| `gradientmap` | hyper-hydra, `hydra-gradientmap.js` | Gradient maps: `createGradient(...colors)` and `createLinearGradient(angle, ...)` make a gradient texture, `.lookupX(tex)` recolours by brightness. `noise(3).lookupX(createGradient("navy", "gold"))` |
| `arithmetics` | hyper-hydra, `hydra-arithmetics.js` | Maths on colours: `.sin()`, `.pow(2)`, `.mod(0.5)`, `.range(lo, hi)`, `.clamp()`, `.add(0.1)`, `.div(2)`, … and `x()`, `y()`, `xCenter()`, `lengthCenter()` generators. `x(6).sin().range(0.2, 0.8)` |

`use` also takes the file names, with or without `.js` (`"lib-noise"`,
`"hydra-fractals.js"`); any other name throws, listing these. Nothing is
fetched: the files are bundled with Ao, unmodified, and
`src/renderer/vendor/hydra/SOURCES.md` records where each came from.
hyper-hydra's own docs describe each extension in full.
`sketches/fractal-garden.js` uses noise, fractals, gradientmap and outputs
together, `sketches/lanterns.js` shows softpattern, and
`sketches/interference.js` builds ripples from arithmetics.

Each extension loads into the deck running the sketch (see
[Autopilot](#autopilot)), so it works on either side of a crossfade; `use`
on the other deck loads it there too, and loading one twice costs nothing.
Things to know:

- **Extensions stay loaded.** Nothing can unload them, so what they add stays
  on that deck until Ao restarts, including for later sketches that never
  called `use`. They only add names, with one exception: `arithmetics` wraps
  the built-in `add`, `sub` and `mult` so they also take numbers
  (`.add(0.1)`). Given a texture, they give the same result as before (to
  within 1/255). A sketch shouldn't count on a function it didn't `use`,
  since which deck it lands on is chance.
- **Per-sketch settings are reset.** On every sketch switch, outputs go back
  to Hydra's defaults (two buffers, nearest filtering, clamped), undoing
  `o0.setLinear()` and friends, and gradient textures are freed.
- `arithmetics` claims short names, `x`, `y`, `length` and `distance`, as
  Hydra functions. A sketch that assigns an undeclared global of the same
  name overwrites the function on that deck; declare your own with `const`
  or `let`. Its `length()`, `distance()` and `distanceCenter()` don't
  compile in Hydra's WebGL 1 shaders: use `lengthCenter()` or
  `x().mult(x()).add(y().mult(y())).sqrt()`.
- `outputs`: `setRepeat()` and `setMirror()` turn an output black at
  Ao's window sizes, because WebGL 1 can't wrap textures whose sides aren't
  powers of two. Use Hydra's `.repeat()` or `fractals`' `.mirrorWrap()`.
  `setBufferCount(n)` is marked experimental upstream.
- `noise` loads the noise library; Hydra's own `noise()` is unchanged.

## Sketch browser

Ctrl+O (`o` with the editor hidden) shows every sketch as a card with a
thumbnail over the visuals, the open one marked `● playing`. Type to filter
by name: the match is fuzzy, so `dns` finds `dunes` and `lamp` finds
`challenge-…-lava-lamp`, best matches first. Arrows, Tab, or Ctrl+H/J/K/L move
(Home, End, PgUp and PgDn too), Enter or a click opens the sketch, and Esc or
a click outside closes the browser. Backspace edits the filter and Ctrl+U
clears it. While it is open, keys go only to the browser, never to the editor.

Sketches you opened recently come first, then the rest alphabetically;
Ctrl+S switches to plain a–z. Challenge attempts (`challenge-*`) are hidden
unless you press Ctrl+A. Both choices are remembered.

Thumbnails live in `state/thumbnails/<name>.png`, 320×180. Ao makes them as
you go: once a sketch has been on screen for four seconds, and then once a
minute while it stays, it copies a small frame of the canvas, so the editor,
bar, cards and night fade never appear in it, and an all-black frame never
replaces a thumbnail. Renaming a sketch with `:w <name>` moves its thumbnail
along. A sketch without one gets a gradient card with its name.

To fill in the missing ones at once, render them offscreen with the synthetic
audio (a few seconds each):

```sh
make thumbnails                 # sketches without a thumbnail
make thumbnails FORCE=1         # re-render them all
make thumbnails SKETCH=dunes,halo FORCE=1
```

That runs `npx electron . --thumbnails[=a,b] [--force]`, which reuses the
screenshot path (`--screenshot-delay=<ms>` sets how long each sketch runs,
3 s by default). A sketch that throws, hangs or draws nothing is reported and
skipped, the rest carry on, and the run exits with status 1 if any failed.
It also deletes thumbnails of sketches that no longer exist. The recently
opened list is `state/recent.json`.

## Autopilot

Ctrl+Shift+A (`a` with the editor hidden) turns on autopilot, Ao's answer to
MilkDrop's auto-switching: it shuffles through `sketches/`, crossfading to
the next one when the music drops or changes section, or when the current
sketch has had its time. The status bar flashes each switch, for example
`autopilot → prism (drop)`, and `state/ao.log` records it with the reason.
Whether it's on is saved, and the last sketch follows it as usual.

**Shuffle, no playlists.** Every sketch plays once, in random order, before
any repeats, and a new round never starts with the one just shown.
Challenge attempts (`challenge-*`) and sketches with nothing but comments
are left out; new and deleted sketches count from the next pick. A sketch
that throws while starting is skipped for the next one. With autopilot on,
`k` and Ctrl+PgDn crossfade to the next sketch in the shuffle at once, and
`j` and Ctrl+PgUp go back to the one before.

**When it switches.** Ao follows the energy (loudness and bass together) and
the shape of the spectrum:

- A **breakdown** is the energy falling well below its level of the last
  quarter minute and staying there while the music plays on. It doesn't
  switch by itself; it arms the drop.
- A **drop** is the energy jumping back abruptly after a breakdown, or after
  a pause of under three seconds, and holding. A slow return isn't a drop,
  nor is a single hit in the lull.
- A **section change** is the spectrum's shape over the last few seconds
  differing clearly from that of the last half minute: new instruments, a
  new part. Gradual change never counts. Music after three seconds of
  silence counts too: it's probably a new track.

A drop or a section change switches once `minSeconds` have passed since the
last switch; a strong drop (after a long lull, with a big jump) may switch
after only 15 seconds. When nothing happens in the music, the switch comes
after `dwellSeconds`. Nothing fires during silence, and each kind of event
has to settle before it can fire again, so beats never trigger anything.
Autopilot also holds off while you're editing: while the editor is showing
and you have typed or run code in the last minute, it doesn't switch, so a
sketch never vanishes under you. Hide the editor, or leave it alone for a
minute, and autopilot carries on; a switch that came due meanwhile happens
then.

**Crossfades.** Every switch to another sketch with Ctrl+PgUp/PgDn, `j`/`k`
or autopilot crossfades over `fadeSeconds`, whether autopilot is on or not:
both sketches keep animating while the new one fades in over the old. The
editor shows the new sketch at once, and Ctrl+Enter runs code on it, even
mid-fade. Opening a new, empty sketch or a challenge still cuts, and
`fadeSeconds: 0` makes every switch a cut. Switching away from a sketch
stops the timers it started and resets `speed`, so nothing of it lingers.
Recordings and challenge snapshots capture the blend as you see it.

The settings live under `autopilot` in `state/settings.json`:

```json
{
  "autopilot": {
    "enabled": false,
    "dwellSeconds": 120,
    "fadeSeconds": 4,
    "switchOnSections": true,
    "minSeconds": 45
  }
}
```

- `enabled`: whether autopilot is on; Ctrl+Shift+A saves it.
- `dwellSeconds`: the longest one sketch stays, `5` and up.
- `fadeSeconds`: crossfade length for every sketch switch, `0..60`; `0` cuts.
- `switchOnSections`: switch on drops and section changes too; `false`
  leaves only the timer.
- `minSeconds`: the shortest time between a switch and a section-triggered
  one, `5` and up.

For trying it out, `--autopilot` turns it on for one session without saving,
`--autopilot=10` also sets a 10 second dwell and minimum, and `--fade=8` sets
the fade: `npx electron . --autopilot=10 --fade=8`.

**How the crossfade works.** Hydra keeps its state in globals (one synth,
`o0`–`o3`, `s0`–`s3`, `update`, `speed`), so two sketches can't share one
instance. Ao runs two Hydra instances, the decks, each on its own canvas,
and evaluates a sketch inside a scope that maps Hydra's names to its own
deck, including in the functions it leaves behind, like `() => time` or
`update`. While idle, only the current deck renders; the other is reset and
shrunk to a couple of pixels. During a fade both render, the incoming canvas
over the outgoing one. The recorder captures `#stage`, so while recording
Ao draws the same blend into it every frame. Hydra's names stay available on
`window` for the DevTools console, pointing at the current deck.

## Code explorer

F2 opens a reference panel on the left, and `K` in the editor's normal mode
opens it on the word under the cursor (`osc`, `ao.hz`, `s0.initScene`, `o1`,
…), or searches for a word it doesn't know. It covers every `ao` member, each
with a live reading of its value, every Hydra function by kind (sources,
geometry, colour, blend, modulate), Hydra's globals (`out`, outputs,
`render`, `speed`, `bpm`, arrays, `update`, `setFunction`, …), the `s0`–`s3`
methods, and a few recipes for mapping audio.

Each entry has its signature, parameters and one example, which plays on
the visuals as you move to it; while the panel is open the visuals shrink to
its right so the example is centred where you can see it. Examples that would
turn on the camera or screen capture, fetch a URL, or blank everything are
marked `·` and play only on Enter. Closing the explorer puts your sketch
back, re-running it; `i` instead inserts the example into your sketch as a
new block after the one under the cursor and runs the whole sketch.

| Key | Action |
| --- | --- |
| `j`/`k`, arrows | move |
| Tab, Shift+Tab | next / previous section |
| `/` | search names, then descriptions; Enter or Esc returns to the list |
| Enter | play the example |
| `i` | insert the example into the sketch |
| Esc, F2 | close and restore the sketch |

Examples play on the canvas, so a recording running meanwhile captures them.
Content lives in `src/renderer/explorer/content.ts`; a test checks every
Hydra function, `ao` member and source method has an example.

## Audio meter

Ctrl+Shift+M (`m` with the editor hidden) shows a small meter in the top-right
corner, so you can see what you're mapping instead of guessing: bars and
values for `ao.loudness`, `ao.impulse`, `ao.beat`, `ao.bass`, `ao.mid` and
`ao.high`, and the 64 bands of `ao.fft` with `ao.peak` (white) and
`ao.centroid` (lilac) marked on the spectrum. It is an overlay on top of the
window, not part of the visuals, and draws nothing while hidden. Ao remembers
whether it was showing.

## Live values

The meter's information, where you're writing: after each `ao` expression in
the code, a small sparkline of its last 2.5 seconds and its current value.
`ao.bass`, `ao.hz(40, 100)` and `ao.fftAt(0.2)` show what they read, and
`ao.map("bass", 0, 2)` shows the mapped value. An argument Hydra re-reads,
such as `() => 4 * ao.hz(6000, 12000)`, shows as one value, the one Hydra
sees. `ao.fft` shows a tiny spectrum. Hover a value for its full precision.
Ctrl+Shift+L turns them off or back on, and Ao remembers.

Nothing you write is run to get these values. Expressions are read from the
syntax tree, and only literals, arithmetic, a few `Math` functions and `ao`'s
own getters and methods (called with literal arguments) count: anything
else, such as `() => spin + ao.bass`, shows just the `ao` reads inside it.
Strings and comments are skipped. New `ao` members show up automatically.
Values are drawn only on visible lines, at most 40 of them, and nothing is
drawn while they're off or the editor is hidden.

## Tempo

Ao keeps a beat clock, so motion can move with the music rather than only
react to how loud it is. `ao.beat` pulses on each detected onset, whatever
its timing; the clock runs steadily at the tempo between hits, carries on
through breaks, and knows where the next beat will land:

- `ao.bpm`: the tempo, detected or tapped; 120 until something is detected.
- `ao.phase`: `0..1` through the current beat, wrapping on each beat.
- `ao.bar`: the beat within a 4-beat bar, `0`, `1`, `2` or `3`.
- `ao.ramp(n = 1)`: a `0..1` ramp over every `n` beats, aligned to the bar;
  `ao.ramp(4)` runs once per bar.
- `ao.pulse(div = 1)`: `1` on every `1/div` of a beat, easing to `0` by the
  next; `ao.pulse(2)` on eighths, `ao.pulse(1/4)` once a bar.
- `ao.tempoConfidence`: `0..1`, how sure the detected tempo is; `1` while
  tapped.

```js
shape(4, 0.2)
  .rotate(() => (ao.bar + Math.min(1, 5 * ao.phase)) * Math.PI / 4)  // step each beat
  .scale(() => 1 + 0.3 * ao.pulse())
  .add(shape([3, 4, 5, 6], 0.5).rotate(() => 2 * Math.PI * ao.ramp(4)))  // one turn a bar
  .out()
```

GLSL scenes get the same clock as `aoBpm`, `aoPhase` and `aoBar`.
`sketches/tempo.js` puts it together.

**Detection** runs in the main process on the captured audio. It measures
onset strength about 190 times a second from the energy in three bands
(kicks weigh most), autocorrelates the last 8 seconds of it, and scores
every tempo from 70 to 180 bpm by the autocorrelation at one to four beat
periods. The true beat outscores its half and double because they miss
some of those peaks; a mild preference for tempos near 120 settles what's
left. The phase comes from folding recent onsets at the beat period, and a
free-running clock is steered toward it gently, so phase never jumps on a
single hit. It locks within about five seconds, follows a tempo change in
two or three, and through silence or a breakdown it holds the last tempo
while its confidence fades.

**Tap tempo** is the fallback and override, since no detector is right
about every track. Press Ctrl+Shift+T (`t` with the editor hidden) on each
beat, starting on the one: the first tap sets the phase and makes that beat
bar `0`, keeping the current tempo, and each further tap is the next beat.
The tempo is the median of the last eight tap intervals, and a pause over
two seconds starts a new sequence. A tapped tempo stays until you tap twice
quickly (under a quarter second apart); then detection takes over again,
keeping the bar where you tapped it. The status bar shows the result, for
example `tempo 128.0 (tap)` or `tempo 127.9 (auto, 82%)`.

Detection can't tell which beat starts a bar, so until you tap, bar `0` is
simply the beat the clock happened to start on. Tapping once on the one
fixes that; two quick taps then return to the detected tempo, keeping it.

**Hydra's `bpm`**, which sets the speed of array sequences such as
`shape([3, 4, 5, 6])` or `[1, 2].fast(2)`, follows the tempo once detection is
confident or you've tapped. Ao also lines the sequences up with its beat,
not just its tempo: `[a, b, c, d]` changes exactly on each beat and starts
over on each bar, and `.fast(2)` steps on eighths. If a sketch sets `bpm`
itself, Ao leaves it, and its arrays, to Hydra until the whole sketch next
runs without setting it.

Things to know:

- Tempos outside 70–180 bpm are reported at their half or double.
- The phase runs a frame or two behind the sound, like the other levels.
- [Ableton Link](https://www.ableton.com/en/link/) isn't supported yet, so
  the clock can't sync with other software.
- Detection costs about 40 µs per 20 ms audio chunk, 0.2% of a core.

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
restart after editing it; toggling the meter, night fade or autopilot updates
just that field and keeps the rest of the file. Missing or invalid values fall back to
the defaults:

```json
{
  "meter": false,
  "liveValues": true,
  "format": true,
  "night": {
    "mode": "schedule",
    "start": "22:00",
    "end": "07:00",
    "brightness": 0.4,
    "fadeMinutes": 45,
    "speed": 1
  },
  "autopilot": { "enabled": false, "dwellSeconds": 120, "fadeSeconds": 4, "switchOnSections": true, "minSeconds": 45 }
}
```

- `meter`: whether the audio meter is showing.
- `liveValues`: whether live values show beside `ao` expressions in the code.
- `format`: whether running code in the editor also formats it.
- `night.mode`: `"schedule"`, `"on"` (always night), or `"off"` (never).
- `night.start`, `night.end`: local 24-hour `HH:MM` times of the window;
  equal times make it empty.
- `night.brightness`: brightness at full night, `0..1`.
- `night.fadeMinutes`: how long the fade takes at each end of the window,
  inside it; a window shorter than two fades never reaches full night.
- `night.speed`: optionally slow Hydra and scene time at night, `0.1..1`, eased
  in with the fade; `1` (the default) leaves speed alone. Audio levels are
  unaffected.
- `autopilot`: see [Autopilot](#autopilot).

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
kick, pad and hats signal (slightly stereo) and writes `state/dunes.png`.
Useful for checking a change without watching the screen, and it prints the
frame rate it reached.
Screenshots ignore `settings.json`, so the meter and night fade stay out of
them unless you ask: add `--meter` or `--night=on` to the `electron` command
(`npx electron . --sketch=dunes --hide-editor --meter --screenshot=state/dunes.png`).
Live values keep their default (on) whenever the editor shows.

## Layout

- `src/main`: Electron main process, audio capture, state and sketch files.
- `src/shared`: audio analysis (FFT, loudness, impulse, beat, tempo), kept pure.
- `src/preload`: the narrow bridge the renderer may call.
- `src/renderer`: Hydra host, GLSL scene runner, solids compiler, overlay editor.
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

## License

Ao is free software under the GNU Affero General Public License, version 3
only (`AGPL-3.0-only`); see `LICENSE`. It bundles
[hydra-synth](https://github.com/hydra-synth/hydra-synth), also AGPL-3.0,
and the vendored Hydra extensions in `src/renderer/vendor/hydra/`, each
under its own licence (hyper-hydra's under GPL-3.0, extra-shaders-for-hydra's
under AGPL-3.0). `src/renderer/vendor/hydra/SOURCES.md` lists them, and
their licence texts are next to them.
