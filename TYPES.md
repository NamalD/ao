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

`ao.map(level, lo = 0, hi = 1)` returns a function that maps the selected
level into the interval `lo..hi`. Passing the function to Hydra makes the
value update every frame:

```js
osc(20, 0.05, () => 1 + ao.bass)
  .rotate(ao.map("mid", 0, 0.5))
  .out()
```

The accepted `level` values are `"loudness"`, `"impulse"`, `"beat"`,
`"bass"`, `"mid"`, and `"high"`. `ao.fft` is available as an array for
direct indexing; `ao.map` does not map spectrum bands.

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
