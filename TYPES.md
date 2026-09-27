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
| `ao.fft` | `number[]` | 64 log-spaced band levels, from about 30 Hz to 16 kHz, low to high. |
| `ao.peak` | `number` | Position of the loudest band, `0..1` from low to high; glides between bands. |
| `ao.centroid` | `number` | Spectral centroid, `0..1`: the level-weighted mean position, a steady measure of brightness. |
| `ao.bpm` | `number` | Tempo in beats per minute, detected (`70..180`) or tapped; `120` until detected. |
| `ao.phase` | `number` | `0..1` through the current beat on the tempo clock, wrapping on each beat. |
| `ao.bar` | `number` | Beat within the 4-beat bar: `0`, `1`, `2` or `3`. Bar `0` is the tapped one, or arbitrary until you tap. |
| `ao.tempoConfidence` | `number` | `0..1`: how sure the detected tempo is; fades while held through silence, `1` while tapped. |

Spectrum positions (`ao.fftAt`, `ao.peak`, `ao.centroid`, GLSL `aoFFT`) share
one log-frequency axis: `0` is about 30 Hz, `0.5` about 700 Hz, `1` about
16 kHz, and each octave spans about 0.11.

| Method | Returns | Meaning |
| --- | --- | --- |
| `ao.fftAt(x)` | `number` | Spectrum level at position `x` (`0..1`), linearly interpolated like GLSL `aoFFT(x)`. |
| `ao.hz(lo, hi?)` | `number` | Average level of the bands between `lo` and `hi` Hz. With one argument, or a range narrower than a band, the interpolated level at that frequency. |
| `ao.map(level, lo = 0, hi = 1)` | `() => number` | A function mapping a level onto `lo..hi`, for Hydra arguments. |
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
`"mid"`, `"high"`, `"peak"`, and `"centroid"`.

### Waveform, stereo image and chroma

These come with every feature frame, about 50 times a second.

| Member | Type | Meaning |
| --- | --- | --- |
| `ao.wave` | `Float32Array` | The newest ~21 ms of mono waveform (1024 samples at 48 kHz, averaged in pairs): 512 values, `-1..1`. Each frame starts on a rising zero crossing, like an oscilloscope trigger, so a steady tone holds still. |
| `ao.waveAt(x)` | `number` | The waveform at position `x` (`0..1` across `ao.wave`), linearly interpolated like GLSL `aoWaveAt(x)`. |
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

## GLSL scene interface

`s0.initScene(source, options)` attaches a Shadertoy-style GLSL ES 3.0
fragment shader to a Hydra source. The shader defines
`void mainImage(out vec4 fragColor, in vec2 fragCoord)` and receives these
uniforms from Ao:

| Uniform | GLSL type | Meaning |
| --- | --- | --- |
| `iResolution` | `vec3` | Render width, height, and depth (`1`). |
| `iTime` | `float` | Elapsed scene time in seconds. |
| `iTimeDelta` | `float` | Time since the previous frame in seconds. |
| `iFrame` | `int` | Scene frame counter, starting at zero; it keeps counting across edits and restarts when the buffers clear. |
| `aoLoudness`, `aoImpulse`, `aoBeat` | `float` | Overall level and transient envelopes. |
| `aoBass`, `aoMid`, `aoHigh` | `float` | Average frequency band levels. |
| `aoBpm` | `float` | Tempo in beats per minute, as `ao.bpm`. |
| `aoPhase` | `float` | `0..1` through the current beat, as `ao.phase`. |
| `aoBar` | `float` | Beat within the bar, `0.0` to `3.0`, as `ao.bar`. |
| `aoSpectrum` | `sampler2D` | 64 spectrum levels in a one-row texture. |

The helper `float aoFFT(float x)` samples `aoSpectrum` at normalized position
`x` (`0..1`), from low to high frequency.

The optional `options` object has this shape:

```ts
interface SceneOptions {
  scale?: number; // Render size relative to the output; defaults to 1.
  uniforms?: Record<string, number | number[] | (() => number | number[])>;
  buffers?: string[]; // Up to four GLSL state passes; see below.
}
```

Custom uniforms must also be declared in the shader with matching GLSL names
and types. A value can be a number, an array for a vector, or a function that
returns either so it can change each frame.

```js
s0.initScene(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, aoFFT(uv.x), 1.0);
}`, { scale: 0.75, uniforms: { swirl: () => ao.mid } })
```

The `swirl` example must declare `uniform float swirl;` in the shader if it is
used there.

### Buffers and the previous frame

Each string in `buffers` is a GLSL pass with its own `mainImage`. Every
frame the buffers run in order, then the scene; each draws into a
half-float RGBA texture (`RGBA16F`) at the scene's render size that keeps
its output. Custom `uniforms` reach every pass, and a function uniform is
read once a frame however many passes use it.

| Uniform | GLSL type | Meaning |
| --- | --- | --- |
| `aoBuffer0` .. `aoBuffer3` | `sampler2D` | The buffers: this frame's output for buffers earlier in the list, the previous frame's for the pass itself and later ones. Buffers a scene doesn't have read as transparent black. |
| `iChannel0` .. `iChannel3` | `sampler2D` | Aliases for `aoBuffer0` .. `aoBuffer3`, as in Shadertoy. |
| `aoPrevious` | `sampler2D` | This pass's own output from the previous frame. The scene itself may read it too. |

Textures filter linearly and clamp at the edges. Buffer passes keep alpha
and may write values outside `0..1`, up to half float's ±65504; a
component that comes out NaN is stored as `0`. The scene's own output is
still shown opaque.

State lasts until the number of buffers changes, `s0.clearScene()` is
called, or the deck switches sketches. Re-running `initScene` with edited
code keeps it and `iFrame` keeps counting, so seed state with
`iFrame == 0` or from an empty buffer. When the output or `scale` resizes
the scene, the state is stretched to the new size.

### Waveform, spectrogram, stereo and chroma in scenes

| Uniform or helper | GLSL type | Meaning |
| --- | --- | --- |
| `aoWave` | `sampler2D` | `ao.wave` as a 512 × 1 texture, values `-1..1`. |
| `aoWaveAt(x)` | `float` | The waveform at `x` (`0..1`), `-1..1`. |
| `aoSpectrogram` | `sampler2D` | The last 256 spectrum frames as a 64 × 256 ring, one row every 20 ms. |
| `aoSpectrogramRow` | `float` | The row holding the newest frame. |
| `aoHistory(x, age)` | `float` | Band level at spectrum position `x` (`0..1`, like `aoFFT`) as it was `age` ago: `0` newest, `1` oldest. Hides the ring's wrap. |
| `aoBalance`, `aoWidth` | `float` | `ao.balance` and `ao.width`. |
| `aoChroma[12]` | `float[12]` | `ao.chroma`, indexed C = 0 .. B = 11. |
| `aoKey` | `float` | `ao.key`, `0..11`; `aoKey / 12.` is `ao.hue`. |

The spectrogram is kept in the renderer from the spectra that already
arrive: rows fall due at 50 a second by the capture clock, however the
chunks arrive, so `aoHistory`'s `age` spans a steady 5.12 s (`age` 0.1 is
about half a second ago). A frame that lands between rows refreshes the
newest one, and a late frame fills the gap by interpolation.

```js
s0.initScene(`
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float level = aoHistory(uv.x, uv.y);  // waterfall: newest at the bottom
  float trace = smoothstep(0.01, 0., abs(uv.y - 0.5 - 0.4 * aoWaveAt(uv.x)));
  vec3 tint = 0.5 + 0.5 * cos(6.2832 * (aoKey / 12. + vec3(0., .33, .67)));
  fragColor = vec4(tint * level + trace, 1.);
}`)
src(s0).out()
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
| `.spikes(length = 0.3, density = 8, sharpness = 4)` | Sharp spikes out of the surface. |
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

`out` compiles the chain into a GLSL scene, as `initScene` would load one.
Its options:

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

