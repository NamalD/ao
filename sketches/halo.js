// Halo: the spectrum bent into a ring by a GLSL scene. Lows sit at the
// bottom and highs meet at the top, each bar read with aoFFT(x). The ring
// breathes with the bass, flashes on hits, and its colour follows how
// bright the sound is (ao.centroid, passed in as a uniform).

s0.initScene(
  `
uniform float brightness;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  float r = length(p);
  float x = abs(atan(p.x, -p.y)) / 3.14159;  // 0 at the bottom, 1 at the top

  const float BARS = 40.0;
  float cell = (floor(x * BARS) + 0.5) / BARS;
  float inner = 0.42 + 0.06 * aoBass;
  float outer = inner + 0.03 + 0.4 * aoFFT(cell);
  float bar = smoothstep(inner - 0.01, inner, r) * (1.0 - smoothstep(outer - 0.01, outer, r))
            * (1.0 - smoothstep(0.3, 0.4, abs(fract(x * BARS) - 0.5)));

  vec3 colour = 0.55 + 0.45 * cos(6.2832 * (brightness + 0.4 * cell + vec3(0.0, 0.33, 0.67)));
  float ring = 0.004 / abs(r - inner + 0.03) * (0.4 + 1.5 * aoImpulse);
  fragColor = vec4(colour * (bar + ring), 1.0);
}`,
  { uniforms: { brightness: () => 2.0 * ao.centroid } },
)

src(s0)
  .add(src(o0).scale(1.015), 0.7)
  .out()
