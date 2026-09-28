# Sketch interfaces

Ao evaluates sketch files as JavaScript in a browser context. Hydra's pattern
functions and the objects below are available as globals. This file describes
the Ao specific interfaces; it is documentation, not a TypeScript declaration
file loaded by the sketch editor.

## Audio object: `ao`

The `ao` object contains the most recent audio analysis. Its numeric levels are
normalized to `0..1` and update as audio is captured.

| Property | Type | Meaning |
| --- | --- | --- |
| `ao.time` | `number` | Seconds since capture started. |
| `ao.loudness` | `number` | Smoothed overall level; rises quickly and falls gradually. |
| `ao.impulse` | `number` | Transient envelope that jumps on hits and decays over about 0.3 seconds. |
| `ao.beat` | `number` | Short pulse on a detected onset, decaying over about 0.15 seconds. |
| `ao.bass` | `number` | Average energy below 250 Hz. |
| `ao.mid` | `number` | Average energy from 250 Hz to 2 kHz. |
| `ao.high` | `number` | Average energy above 2 kHz. |
| `ao.energy` | `number` | Section energy: loudness and bass together, smoothed over about 0.25 seconds. Falls in breakdowns, jumps back on the drop. |
| `ao.drop` | `number` | Pulse set to `1` when the energy jumps back after a breakdown (about 0.3 seconds after the drop lands), fading over about 1.5 seconds. `0` until a drop, which needs a breakdown first. |
| `ao.fft` | `number[]` | 64 log-spaced band levels, from about 30 Hz to 16 kHz, low to high. |
| `ao.peak` | `number` | Position of the loudest band, `0..1` from low to high; glides between bands. |
| `ao.centroid` | `number` | Spectral centroid, `0..1`: the level-weighted mean position, a steady measure of brightness. |
| `ao.bpm` | `number` | Tempo in beats per minute, detected (`70..180`) or tapped; `120` until detected. |
| `ao.phase` | `number` | `0..1` through the current beat on the tempo clock, wrapping on each beat. |
| `ao.bar` | `number` | Beat within the 4-beat bar: `0`, `1`, `2` or `3`. Bar `0` is the tapped one, or arbitrary until you tap. |
| `ao.tempoConfidence` | `number` | `0..1`: how sure the detected tempo is; fades while held through silence, `1` while tapped. |

Spectrum positions (`ao.fftAt`, `ao.peak`, `ao.centroid`, and x in `spectrum()` and `history()`) share
one log-frequency axis: `0` is about 30 Hz, `0.5` about 700 Hz, `1` about
16 kHz, and each octave spans about 0.11.

| Method | Returns | Meaning |
| --- | --- | --- |
| `ao.fftAt(x)` | `number` | Spectrum level at position `x` (`0..1`), linearly interpolated, as `spectrum()` shows it at `x`. |
| `ao.hz(lo, hi?)` | `number` | Average level of the bands between `lo` and `hi` Hz. With one argument, or a range narrower than a band, the interpolated level at that frequency. |
| `ao.map(level, lo = 0, hi = 1)` | `() => number` | A function mapping a level onto `lo..hi`, for Hydra arguments. |
| `ao.glide(level, seconds = 1)` | `() => number` | A function following a level, `"bpm"`, or any function, easing each change in so it is within 2% after `seconds`. |
| `ao.ramp(n = 1)` | `number` | `0..1` ramp over every `n` beats, aligned to the bar: `ao.ramp(4)` runs once per bar. `0` for `n <= 0`. |
| `ao.pulse(div = 1)` | `number` | `1` on every `1/div` of a beat, easing to `0` (as `(1 - t)^4`) by the next. `0` for `div <= 0`. |

`ao.beat` and the tempo members differ: `ao.beat` pulses when an onset is
heard, whenever it comes, while `ao.phase`, `ao.bar`, `ao.ramp` and
`ao.pulse` run on a steady clock at `ao.bpm` that keeps going between hits
and through silence. See the README's Tempo section for tap tempo and
Hydra's `bpm`.

Rough frequency ranges for `ao.hz`: kick `40..100`, bass line `60..250`,
snare body `150..300`, voice `300..3000`, snare crack `2000..5000`, hats and
cymbals `6000..12000`.

`ao.map` returns a function, so passing it to Hydra makes the value update
every frame. `level` is a level name or any function returning `0..1`:

```js
osc(20, 0.05, () => 1 + ao.bass)
  .rotate(ao.map("mid", 0, 0.5))
  .scale(ao.map(() => ao.hz(40, 100), 1, 1.5))
  .hue(ao.map("centroid", 0, 1))
  .out()
```

The accepted level names are `"loudness"`, `"impulse"`, `"beat"`, `"bass"`,
`"mid"`, `"high"`, `"energy"`, `"drop"`, `"peak"`, and `"centroid"`.

`ao.glide` fades a value that would otherwise jump, such as `ao.bpm` when the
tempo is re-detected or tapped. It takes the same level names plus `"bpm"`, or
any function. Create it once, outside the argument function, since each glide
remembers where it has got to; it steps by real time, so it keeps the same
pace at any frame rate and can be read more than once a frame:

```js
const bpm = ao.glide("bpm", 2)   // settles two seconds after a tempo change

sphere()
  .ripple(0.1, () => bpm() / 20)
  .out(s0)
```

Glide a frequency or size rather than a `speed` that multiplies elapsed time:
the pattern's position is `speed * time`, so even a slow change in speed
sends it lurching forwards or backwards.

### Waveform, stereo image and chroma

These come with every feature frame, about 50 times a second.

| Member | Type | Meaning |
| --- | --- | --- |
| `ao.wave` | `Float32Array` | The newest ~21 ms of mono waveform (1024 samples at 48 kHz, averaged in pairs): 512 values, `-1..1`. Each frame starts on a rising zero crossing, like an oscilloscope trigger, so a steady tone holds still. |
| `ao.waveAt(x)` | `number` | The waveform at position `x` (`0..1` across `ao.wave`), linearly interpolated, as `waveform()` draws it at `x`. |
| `ao.balance` | `number` | Stereo balance, `-1` (left) .. `0` (centre) .. `1` (right), from the channels' RMS levels, smoothed over ~0.1 s. |
| `ao.width` | `number` | Stereo width, `0` for mono up to `1` for uncorrelated, out-of-phase or hard-panned sound: the side (L−R) level relative to the mid (L+R). |
| `ao.chroma` | `number[]` | 12 pitch-class levels, `0..1`, for C, C#, D, … B, folded across octaves from spectral peaks between 110 Hz and 5 kHz. Normalized so the strongest is near 1 and smoothed; all zero in silence. |
| `ao.key` | `number` | The dominant pitch class, `0` (C) .. `11` (B). Another class must be clearly stronger to take over, so it doesn't flicker; it holds its last value through silence. |
| `ao.hue` | `number` | `ao.key / 12`: a colour hue that follows the harmony rather than the brightness. |

The trigger waits for the signal to dip near its lowest point and then
takes the next rise through zero, found between samples. Tones down to
about 47 Hz stay still; noisy or rapidly changing sound still moves, as on
a real scope. Chroma is a rough guide to the harmony, not a transcription:
harmonics add the fifth and major third of each note, and noise reads as
flat.

```js
shape(3, () => 0.3 + 0.2 * Math.abs(ao.waveAt(0.25)))
  .color(1, 0.4, 0.3).hue(() => ao.hue)
  .scrollX(() => 0.2 * ao.balance)
  .out()
```

## Hydra extensions: `use`

```ts
function use(...names: string[]): Promise<void>;
```

Loads vendored Hydra extensions into the deck running the sketch, so their
functions are available afterwards like Hydra's own. Names are
`"noise"`, `"softpattern"`, `"fractals"`, `"outputs"`, `"gradientmap"` and
`"arithmetics"`, or the vendored file names with or without `.js`
(`"lib-noise"`, `"hydra-fractals.js"`). An unknown name throws an `Error`
listing the available ones, before anything loads.

Loading is synchronous; the returned promise resolves at once, so
`await use(...)` and a bare `use(...)` behave the same. Loading an extension
already loaded on that deck does nothing. Extensions can't be unloaded:
what they add stays on the deck until Ao restarts, while per-sketch state
(output settings from `outputs`, gradient textures from `gradientmap`) is
reset whenever the deck switches sketches. The README's "Hydra extensions"
section lists what each one adds.

```js
await use("gradientmap", "noise")
turb(4, 0.1, 3).lookupX(createGradient([0, 0, 0.1], "teal", "gold")).out()
```

## Audio sources

Hydra generators whose pixels are the sound, plus a chain method that bends
any chain into a ring. Every argument is a number or a function returning
one, as in Hydra. Hydra's `y` runs down the screen: `0` at the top, `1` at
the bottom.

| Function | Meaning |
| --- | --- |
| `spectrum(gain = 1)` | The spectrum as an image: `x` is the spectrum position (`0..1`, low to high), each column as bright as its level × `gain`, the same all the way down. |
| `history(gain = 1)` | The last 256 spectrum frames, one every 20 ms: `x` as in `spectrum`, now at the bottom (`y = 1`) and 5.12 s ago at the top, each as bright as its level × `gain`. |
| `waveform(thickness = 0.01, gain = 1)` | `ao.wave` drawn as a line across the screen: `thickness` as a fraction of the screen height, `gain` 1 letting a full-scale sample reach the top or bottom. Positive samples go up. |
| `.polar(mirror = 0)` | Bends the chain into a ring. `x` runs around the centre, clockwise from the top, and `y` outwards, `0` at the centre and `1` at the top and bottom edges, corrected for the screen's aspect. `mirror` 1 runs `x` from the bottom up both sides to the top, with no seam. |

Levels reach the GPU as bytes, so `spectrum` and `history` step in 1/255ths;
the waveform keeps 16 bits. The spectrogram is kept in the renderer from the
spectra that already arrive: rows fall due at 50 a second by the capture
clock, however the chunks arrive, so `history` spans a steady 5.12 s. A frame
that lands between rows refreshes the newest one, and a late frame fills the
gap by interpolation.

Each call passes its texture to Hydra the way `src(o0)` does, using one of
the GPU's texture units, so one chain can hold about a dozen audio sources.

```js
history(0.8)
  .color(1, 0.5, 0.2)
  .add(waveform(0.005).color(0.4, 1, 0.8))
  .polar()                         // the waterfall wrapped round, now at the rim
  .out()
```

## Solids

Solid shapes are globals that start a chain; each method returns a new solid,
so chains can be stored and reused. Every numeric argument is a number or a
function returning one, read each frame. The view spans about `-2.2..2.2`
vertically at the centre, with `+y` up and `+z` towards the camera.

| Shape | Meaning |
| --- | --- |
| `sphere(radius = 1)` | A ball. |
| `box(width = 1.4, height = width, depth = width)` | A box. |
| `torus(radius = 1, thickness = 0.3)` | A ring lying flat in the x-z plane. |
| `cylinder(radius = 0.6, height = 1.6)` | An upright cylinder. |
| `octahedron(size = 1.2)` | An eight-sided diamond. |
| `plane(height = -1)` | An endless floor. |

| Method | Meaning |
| --- | --- |
| `.move(x = 0, y = 0, z = 0)` | Moves the solid. |
| `.rotate(x = 0, y = 0, z = 0)` | Turns it by fixed angles in radians. |
| `.spin(x = 0, y = 0.5, z = 0)` | Keeps it turning, in radians per second. |
| `.scale(amount = 1)` | Grows or shrinks it. |
| `.repeat(x = 3, y = 0, z = 3)` | Repeats it endlessly with this spacing; `0` doesn't repeat along that axis. |
| `.twist(amount = 1)` | Twists it around the y axis, radians per unit of height. |
| `.spikes(length = 0.3, density = 8, sharpness = 4, variety = 0)` | Sharp spikes out of the surface; `variety` gives each spike its own length, from all alike (`0`) to anywhere between nothing and `length` (`1`). |
| `.wobble(amount = 0.1, frequency = 3, speed = 1)` | A slow liquid swell. |
| `.noise(amount = 0.15, scale = 2, speed = 0.5)` | Lumpy, evolving noise. |
| `.spectrum(amount = 0.4)` | Pushes the surface out by the spectrum, lows at the bottom and highs at the top. |
| `.round(radius = 0.1)` | Rounds edges by growing outwards. |
| `.shell(thickness = 0.05)` | Hollows it into a thin skin. |
| `.color(r = 1, g = 1, b = 1)` | Colours it; values above 1 glow brighter. |
| `.add(solid, smooth = 0)` | Joins another solid; `smooth` melts them together. |
| `.sub(solid, smooth = 0)` | Cuts another solid out. |
| `.intersect(solid, smooth = 0)` | Keeps only the overlap. |
| `.out(source = s0, options?)` | Raymarches the solid into a Hydra source; with none, the `s0` of the deck the sketch runs on. |

`out` compiles the chain into a shader Ao draws for that source; sketches
never see its GLSL. Its options:

```ts
interface SolidOutOptions {
  scale?: number;       // Render size relative to the output; defaults to 1.
  camera?: number | (() => number);                  // Camera distance; 4.
  background?: number | number[] | (() => number | number[]); // Colour; [0.02, 0.02, 0.04].
  glow?: number | (() => number);                    // Rim light; 0.6.
  step?: number | (() => number);                    // Ray step fraction; 0.9.
  trails?: number | (() => number);                  // How much of each frame lingers, 0..1; none.
}
```

Uniforms are named after their function and parameter, such as
`spikes_length`, and a function that throws or returns a non-number reports
that name in the status bar and falls back to `0`.

