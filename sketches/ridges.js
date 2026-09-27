// Ridges: the last five seconds of spectrum as stacked ridgelines, newest at
// the front, like a certain album cover. aoHistory reads the spectrogram;
// bass rises in the middle, highs at the edges. The lines take their colour
// from the harmony (aoKey), and the beat brightens the front row.

s0.initScene(`
const int LINES = 44;

vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(fract(h + vec3(0., 2., 1.) / 3.) * 6. - 3.) - 1., 0., 1.);
  return v * mix(vec3(1.), k, s);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float u = (uv.x - 0.5) / 0.36;               // -1..1 across the ridges
  vec3 col = vec3(0.02, 0.02, 0.03);
  if (abs(u) < 1.) {
    float x = 0.12 + 0.68 * abs(u);            // spectrum position, bass in the middle
    float taper = smoothstep(1., 0.55, abs(u));
    // Ridges whose peaks can't reach this height are skipped.
    int first = max(0, int(ceil((uv.y - 0.12 - 0.13) / 0.72 * float(LINES - 1))));
    for (int i = first; i < LINES; i++) {
      float age = float(i) / float(LINES - 1);
      float base = 0.12 + 0.72 * age;
      // Three taps soften the 64 bands into smooth hills.
      float level = (aoHistory(x - 0.012, age) + 2. * aoHistory(x, age) + aoHistory(x + 0.012, age)) / 4.;
      float h = base + 0.13 * taper * level * level;
      if (uv.y < h) {                          // hidden behind this ridge
        float edge = smoothstep(2.5 / iResolution.y, 0.0, h - uv.y);
        vec3 tint = hsv(aoKey / 12. + 0.05 * age, 0.5, 1.);
        float bright = (1. - 0.6 * age) * (1. + (i == 0 ? aoBeat : 0.));
        col = mix(col, tint * bright, edge);
        break;
      }
    }
  }
  fragColor = vec4(col, 1.);
}`)

src(s0).out()
