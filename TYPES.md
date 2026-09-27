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
