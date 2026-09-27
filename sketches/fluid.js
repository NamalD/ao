// Fluid: ink stirred through water by the music, a real fluid simulation.
// Two scene buffers keep state from frame to frame: buffers[0] is the flow
// (velocity, density and curl), buffers[1] the dye it carries. Three stirrers
// wander the water: the bass pushes them harder, hits drop fresh ink in the
// key's colours, mids spin up eddies, and quiet passages let the ink fade.
// Edits keep the water moving; s0.clearScene() empties it.

s0.initScene(
  `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 dye = texture(aoBuffer1, uv).rgb;
  float curl = texture(aoBuffer0, uv).w;
  // Ink saturates rather than clipping; eddies catch a little light.
  vec3 ink = 1.0 - exp(-1.8 * dye);
  vec3 water = vec3(0.01, 0.015, 0.035);
  fragColor = vec4(water + ink * (1.0 + 0.15 * abs(curl)), 1.0);
}`,
  {
    scale: 0.5,
    uniforms: {
      swirl: () => 0.05 + 0.3 * ao.mid,
      push: () => 6 + 30 * ao.bass + 50 * ao.impulse,
      splash: () => 0.03 + 0.3 * ao.impulse,
      fade: () => 0.996 + 0.003 * ao.loudness,
    },
    buffers: [
      // Flow: velocity (xy), density (z) and curl (w), after Guay, Colin and
      // Egli, "Simple and fast fluids" (2011). Units are pixels.
      `
uniform float swirl;
uniform float push;

vec4 at(vec2 p) { return texture(aoBuffer0, p / iResolution.xy); }

vec2 stirrer(float i, float t) {
  t = 0.13 * t + 2.094 * i;
  return iResolution.xy * (0.5 + vec2(0.3 * cos(t), 0.27 * sin(1.37 * t + i)));
}

void mainImage(out vec4 fragColor, in vec2 p) {
  float dt = 0.15 * clamp(iTimeDelta * 60.0, 0.5, 2.0);
  vec4 c = at(p);
  vec4 r = at(p + vec2(1, 0)), l = at(p - vec2(1, 0));
  vec4 u = at(p + vec2(0, 1)), d = at(p - vec2(0, 1));
  vec3 dx = 0.5 * (r.xyz - l.xyz), dy = 0.5 * (u.xyz - d.xyz);
  vec2 slope = vec2(dx.z, dy.z);

  // Density follows the flow, and the flow carries itself along.
  c.z -= dt * dot(vec3(slope, dx.x + dy.y), c.xyz);
  c.xyw = at(p - dt * c.xy).xyw;

  // Viscosity smooths the flow; denser water pushes outwards like pressure.
  c.xy += dt * 0.55 * (r.xy + l.xy + u.xy + d.xy - 4.0 * c.xy) - 0.2 * slope;

  // Vorticity confinement spins up the eddies the grid would smear away.
  c.w = (r.y - l.y) - (u.x - d.x);
  vec2 eddy = vec2(abs(u.w) - abs(d.w), abs(l.w) - abs(r.w));
  c.xy += swirl * c.w * eddy / (length(eddy) + 1e-5);

  // The stirrers push along their paths.
  float radius = 0.06 * iResolution.y;
  for (int i = 0; i < 3; i++) {
    vec2 here = stirrer(float(i), iTime), ahead = stirrer(float(i), iTime + 0.3);
    vec2 toward = normalize(ahead - here + 1e-4);
    c.xy += dt * push * toward * exp(-dot(p - here, p - here) / (radius * radius));
  }

  // Walls: nothing flows through the edges.
  c.xy *= step(vec2(1.5), min(p, iResolution.xy - p));
  c = iFrame == 0 ? vec4(0.0, 0.0, 1.0, 0.0) : clamp(c, vec4(-10, -10, 0.5, -10), vec4(10, 10, 3, 10));
  fragColor = c;
}`,
      // Dye, carried by this frame's flow and fading slowly.
      `
uniform float splash;
uniform float fade;

vec2 stirrer(float i, float t) {
  t = 0.13 * t + 2.094 * i;
  return iResolution.xy * (0.5 + vec2(0.3 * cos(t), 0.27 * sin(1.37 * t + i)));
}

void mainImage(out vec4 fragColor, in vec2 p) {
  float dt = 0.15 * clamp(iTimeDelta * 60.0, 0.5, 2.0);
  vec2 flow = texture(aoBuffer0, p / iResolution.xy).xy;
  vec3 dye = texture(aoBuffer1, (p - dt * flow) / iResolution.xy).rgb * fade;
  float radius = 0.04 * iResolution.y;
  for (int i = 0; i < 3; i++) {
    vec2 here = stirrer(float(i), iTime);
    vec3 hue = 0.5 + 0.5 * cos(6.2832 * (aoKey / 12.0 + 0.2 * float(i) + vec3(0.0, 0.33, 0.67)));
    dye += splash * hue * exp(-dot(p - here, p - here) / (radius * radius));
  }
  fragColor = vec4(dye, 1.0);
}`,
    ],
  },
)

src(s0).out()
