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

Spectrum positions (`ao.fftAt`, `ao.peak`, `ao.centroid`, GLSL `aoFFT`) share
one log-frequency axis: `0` is about 30 Hz, `0.5` about 700 Hz, `1` about
16 kHz, and each octave spans about 0.11.

| Method | Returns | Meaning |
| --- | --- | --- |
| `ao.fftAt(x)` | `number` | Spectrum level at position `x` (`0..1`), linearly interpolated like GLSL `aoFFT(x)`. |
| `ao.hz(lo, hi?)` | `number` | Average level of the bands between `lo` and `hi` Hz. With one argument, or a range narrower than a band, the interpolated level at that frequency. |
| `ao.map(level, lo = 0, hi = 1)` | `() => number` | A function mapping a level onto `lo..hi`, for Hydra arguments. |

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
| `iFrame` | `int` | Scene frame counter, starting at zero. |
| `aoLoudness`, `aoImpulse`, `aoBeat` | `float` | Overall level and transient envelopes. |
| `aoBass`, `aoMid`, `aoHigh` | `float` | Average frequency band levels. |
| `aoSpectrum` | `sampler2D` | 64 spectrum levels in a one-row texture. |

The helper `float aoFFT(float x)` samples `aoSpectrum` at normalized position
`x` (`0..1`), from low to high frequency.

The optional `options` object has this shape:

```ts
interface SceneOptions {
  scale?: number; // Render size relative to the output; defaults to 1.
  uniforms?: Record<string, number | number[] | (() => number | number[])>;
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
