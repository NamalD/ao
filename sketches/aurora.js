// Aurora: a custom GLSL function registered with setFunction, then
// composed like any built-in Hydra source.

setFunction({
  name: "aurora",
  type: "src",
  inputs: [
    { type: "float", name: "speed", default: 0.2 },
    { type: "float", name: "energy", default: 0.5 },
  ],
  glsl: `
    float band = 0.0;
    for (float i = 1.0; i < 5.0; i++) {
      float wave = 0.55 + 0.08 * i * sin(_st.x * (2.0 + i) + time * speed * i)
                 + 0.03 * sin(_st.x * 13.0 * i - time * speed * 3.0);
      band += exp(-abs(_st.y - wave) * (24.0 - 12.0 * energy)) / i;
    }
    vec3 colour = mix(vec3(0.65, 0.3, 1.0), vec3(0.1, 1.0, 0.55), smoothstep(0.1, 0.55, _st.y));
    return vec4(colour * band, 1.0);`,
})

aurora(0.25, () => ao.loudness)
  .modulate(noise(1.5, 0.1), () => 0.02 + 0.05 * ao.bass)
  .add(noise(300, 0.2).thresh(0.92, 0).color(0.5, 0.55, 0.7), 0.4)
  .blend(o0, 0.6)
  .out()
