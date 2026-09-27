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
| `.out(source = s0, options?)` | Raymarches the solid into a Hydra source. |

`out` compiles the chain into a GLSL scene, as `initScene` would load one.
Its options:

```ts
interface SolidOutOptions {
  scale?: number;       // Render size relative to the output; defaults to 1.
  camera?: number | (() => number);                  // Camera distance; 4.
  background?: number | number[] | (() => number | number[]); // Colour; [0.02, 0.02, 0.04].
  glow?: number | (() => number);                    // Rim light; 0.6.
  step?: number | (() => number);                    // Ray step fraction; 0.9.
}
```

Uniforms are named after their function and parameter, such as
`spikes_length`, and a function that throws or returns a non-number reports
that name in the status bar and falls back to `0`.

