// Dunes: a drone drifting over a desert at golden hour.
// A raymarched GLSL scene (s0) finished with a little Hydra heat shimmer.
// Loudness sets the flight speed, bass thickens the haze, the beat swells
// the sun, highs make the sand glint, and hits flare the drone's light.

// Shared with the scene block below, so it lives on the global object.
globalThis.travel ??= 0
update = (dt) => {
  travel += dt * 0.001 * (2.5 + 5 * ao.loudness)
}

s0.initScene(
  `
uniform float travel;
const vec3 SUN = normalize(vec3(-0.19, 0.1, 0.98));
const vec3 SUN_COLOUR = vec3(1.0, 0.72, 0.45);
const vec2 HEADING = vec2(0.41, 0.91);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0, amp = 0.5;
  mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { sum += amp * noise(p); p = turn * p; amp *= 0.5; }
  return sum;
}

// A dune profile: a long windward slope and a short, steep lee face.
float ridge(float u) {
  float f = fract(u);
  float h = f < 0.8 ? f / 0.8 : (1.0 - f) / 0.2;
  return h * h * (3.0 - 2.0 * h);
}

float height(vec2 p) {
  vec2 w = p + 6.0 * vec2(fbm(p * 0.02), fbm(p * 0.02 + 17.0));
  float h = 3.2 * ridge(w.x * 0.045 + 0.6 * sin(w.y * 0.021));
  h += 1.1 * ridge(w.x * 0.11 + w.y * 0.05 + 1.3 * fbm(p * 0.04));
  return h + 0.6 * fbm(p * 0.08);
}

// Wind ripples only perturb the shading normal; they are too fine to march.
float ripples(vec2 p) {
  return 0.018 * sin(dot(p, vec2(2.7, 1.1)) * 4.0 + 2.5 * noise(p * 1.3));
}

float march(vec3 ro, vec3 rd) {
  float t = 0.5, previous = t;
  for (int i = 0; i < 160; i++) {
    vec3 p = ro + rd * t;
    float d = p.y - height(p.xz);
    if (d < 0.0) {
      // Overshot a crest: bisect back to the surface.
      float a = previous, b = t;
      for (int j = 0; j < 6; j++) {
        float m = 0.5 * (a + b);
        vec3 q = ro + rd * m;
        if (q.y < height(q.xz)) b = m; else a = m;
      }
      return 0.5 * (a + b);
    }
    if (d < 0.001 * t) return t;
    previous = t;
    t += max(0.45 * d, 0.006 * t);
    if (t > 160.0) return -1.0;
  }
  return t;
}

vec3 normalAt(vec2 p, float t) {
  float e = 0.02 + 0.002 * t;
  float detail = 1.0 - smoothstep(10.0, 40.0, t);
  float h = height(p) + detail * ripples(p);
  float hx = height(p + vec2(e, 0)) + detail * ripples(p + vec2(e, 0));
  float hz = height(p + vec2(0, e)) + detail * ripples(p + vec2(0, e));
  return normalize(vec3(h - hx, e, h - hz));
}

float softShadow(vec3 p) {
  float s = 1.0, t = 0.3;
  for (int i = 0; i < 28; i++) {
    vec3 q = p + SUN * t;
    float d = q.y - height(q.xz);
    s = min(s, 8.0 * d / t);
    if (s < 0.0) break;
    t += clamp(d, 0.3, 3.0);
  }
  return clamp(s, 0.0, 1.0);
}

vec3 sky(vec3 rd) {
  float sun = max(dot(rd, SUN), 0.0);
  vec3 col = mix(vec3(1.0, 0.5, 0.24), vec3(0.05, 0.1, 0.3), pow(max(rd.y, 0.0), 0.5));
  col += SUN_COLOUR * pow(sun, 8.0) * (0.35 + 0.3 * aoBeat);
  col += vec3(1.0, 0.8, 0.55) * pow(sun, 64.0) * 0.6;
  return col + vec3(1.0, 0.9, 0.7) * smoothstep(0.9994, 0.9997, sun) * 6.0;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;

  // Fly along HEADING, easing over the dunes rather than through them.
  vec2 xz = HEADING * travel + vec2(HEADING.y, -HEADING.x) * 3.0 * sin(travel * 0.05);
  float ground = max(max(height(xz), height(xz + HEADING * 4.0)), height(xz + HEADING * 9.0));
  vec3 ro = vec3(xz.x, ground + 2.6, xz.y);
  vec3 forward = normalize(vec3(HEADING.x, -0.14, HEADING.y));
  vec3 right = normalize(cross(forward, vec3(0, 1, 0)));
  vec3 up = cross(right, forward);
  float roll = 0.04 * sin(iTime * 0.3);
  vec3 rd = normalize(forward * 1.6 + right * (uv.x + roll * uv.y) + up * (uv.y - roll * uv.x));

  // The drone hangs ahead of the camera and bobs on the air.
  vec3 drone = ro + vec3(HEADING.x, 0.0, HEADING.y) * 7.0
             + vec3(0.0, -0.5 + 0.25 * sin(iTime * 0.9), 0.0) + right * 0.6 * sin(iTime * 0.37);
  float droneGlow = 0.6 + 2.5 * aoImpulse;
  vec3 droneColour = vec3(1.0, 0.55, 0.22);

  float t = march(ro, rd);
  vec3 col;
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = normalAt(p.xz, t);
    float diffuse = max(dot(n, SUN), 0.0);
    float shadow = softShadow(p + n * 0.05);
    vec3 albedo = vec3(0.86, 0.56, 0.33) * (0.92 + 0.16 * noise(p.xz * 0.7));
    col = albedo * (SUN_COLOUR * diffuse * shadow * 3.4
                  + vec3(0.3, 0.38, 0.65) * (0.5 + 0.5 * n.y) * 0.3
                  + vec3(0.9, 0.45, 0.25) * (0.5 - 0.5 * n.y) * 0.2);
    // Sand glints: sparse grains catching the sun.
    float grain = step(0.985, hash(floor(p.xz * 45.0)));
    float glint = pow(max(dot(reflect(rd, n), SUN), 0.0), 40.0) * grain;
    col += SUN_COLOUR * glint * shadow * (0.6 + 4.0 * aoHigh) * (1.0 - smoothstep(4.0, 25.0, t));
    // The drone lights the sand beneath it.
    vec3 toDrone = drone - p;
    float d2 = dot(toDrone, toDrone);
    col += albedo * droneColour * droneGlow * max(dot(n, normalize(toDrone)), 0.0) * 2.0 / (1.0 + d2);
    // Haze thickens with distance, glowing toward the sun.
    float haze = 1.0 - exp(-t * (0.005 + 0.008 * aoBass));
    vec3 hazeColour = mix(vec3(0.75, 0.42, 0.25), vec3(1.2, 0.72, 0.4), pow(max(dot(rd, SUN), 0.0), 6.0));
    col = mix(col, hazeColour, haze);
  } else {
    col = sky(rd);
    t = 1e3;
  }

  // Drone light, depth-tested against the terrain.
  vec3 toDrone = drone - ro;
  float along = dot(toDrone, rd);
  if (along > 0.0 && along < t) {
    float miss = length(toDrone - rd * along);
    col += droneColour * droneGlow * (0.0025 / (miss * miss + 0.0004) + 0.05 * exp(-miss * 3.0));
  }

  col = aces(col * 0.8);
  col = pow(col, vec3(1.0 / 2.2));
  vec2 q = fragCoord / iResolution.xy;
  col *= 0.55 + 0.45 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.15);
  // Dither away 8-bit banding in the long sky gradients.
  col += (hash(fragCoord + fract(iTime) * 91.0) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`,
  { scale: 0.75, uniforms: { travel: () => travel } },
)

src(s0)
  .scale(1.02)
  .modulate(noise(2.5, 0.2), () => 0.0015 + 0.004 * ao.impulse)
  .out()
