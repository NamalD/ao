// Scope: an oscilloscope trace of the waveform, held still by the trigger.
// aoWaveAt draws the line, the dominant pitch class (aoKey) picks its hue,
// the twelve chroma levels glow as a ring of dots, and stereo balance
// leans the whole display. Hydra adds phosphor afterglow.

s0.initScene(`
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0., 2., 1.) / 3.) * 6. - 3.) - 1., 0., 1.);
  return v * mix(vec3(1.), k, s);
}

// The trace's height at screen x, the waveform spread across the width.
float wave(float x) {
  return 0.6 * aoWaveAt(0.5 + 0.5 * x * iResolution.y / iResolution.x);
}

// Distance from p to the trace, checked against nearby segments.
float trace(vec2 p) {
  float d = 1e3;
  for (int k = -3; k <= 3; k++) {
    float x = p.x + float(k) * 0.006;
    vec2 a = vec2(x, wave(x)), ab = vec2(0.006, wave(x + 0.006) - a.y);
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0., 1.);
    d = min(d, length(p - a - ab * t));
  }
  return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (2. * fragCoord - iResolution.xy) / iResolution.y;
  p.y -= 0.12 * aoBalance * p.x;              // lean towards the louder side
  vec3 tint = hsv(aoKey / 12., 0.65, 1.);
  float d = trace(p);
  float line = smoothstep(0.012, 0.0, d) + 0.25 * exp(-d * 40.) * (0.4 + aoLoudness);
  vec3 col = tint * line;
  // Faint graticule.
  vec2 g = abs(fract(p * 4. + 0.5) - 0.5);
  col += vec3(0.05, 0.07, 0.06) * smoothstep(0.03, 0., min(g.x, g.y));
  // The chroma ring: one dot per pitch class, C at the top, going clockwise.
  vec2 c = p - vec2(0., -0.72);
  for (int i = 0; i < 12; i++) {
    float a = 6.2832 * float(i) / 12.;
    vec2 at = 0.14 * vec2(sin(a), cos(a));
    float glow = 0.12 + aoChroma[i] * aoChroma[i];
    col += hsv(float(i) / 12., 0.65, 1.) * glow * smoothstep(0.025, 0.0, length(c - at) - 0.012 * glow);
  }
  fragColor = vec4(col, 1.);
}`)

src(s0)
  .blend(src(o0).scale(1.003), 0.45) // phosphor persistence
  .out()
