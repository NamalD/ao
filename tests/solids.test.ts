import { describe, expect, it } from "vitest";
import { compileSolid, makeSolidShapes, Solid, solidFunctions, solidShapes } from "../src/renderer/solids";

// Methods are installed from the solidFunctions table, so the type has no names for them.
type Chain = any;
const { sphere, box, torus, cylinder, plane } = solidShapes as Record<string, (...args: unknown[]) => Chain>;

describe("solid chains", () => {
  it("installs every function as a shape or a chain method", () => {
    for (const fn of solidFunctions) {
      if (fn.type === "shape") expect(solidShapes[fn.name], fn.name).toBeTypeOf("function");
      else expect((Solid.prototype as Chain)[fn.name], fn.name).toBeTypeOf("function");
    }
    expect(sphere().spikes().spin().color(1, 0, 0)).toBeInstanceOf(Solid);
  });

  it("compiles a chain into a distance function applied inside out", () => {
    const { code } = compileSolid(sphere(1).spikes(0.3).move(1, 0, 0));
    // move rewrites the point first, then the sphere and its spikes see it.
    expect(code).toContain("vec3 p0 = p - vec3(move_x, move_y, move_z);");
    expect(code).toContain("vec4 s1 = vec4(vec3(0.85), length(p0) - sphere_radius);");
    expect(code).toContain("s1.a - spikes_length * aoSpikes(p0, spikes_density, spikes_sharpness, spikes_variety)");
    expect(code).toMatch(/vec4 aoMap\(vec3 p\) \{[\s\S]*return s3;\n\}/);
  });

  it("turns every argument into a uniform, filling in defaults", () => {
    const heat = () => 0.5;
    const { uniforms } = compileSolid(sphere().spikes(heat));
    expect(uniforms).toMatchObject({ sphere_radius: 1, spikes_length: heat, spikes_density: 8, spikes_sharpness: 4, spikes_variety: 0 });
  });

  it("keeps the shader the same when only numbers change, so scrubbing never recompiles", () => {
    const a = compileSolid(sphere(1).spikes(0.3, 8).add(box(1, 2), 0.2));
    const b = compileSolid(sphere(1.7).spikes(() => 0.9, 12).add(box(1, 1), 0.5));
    expect(b.code).toBe(a.code);
    expect(b.uniforms.sphere_radius).toBe(1.7);
  });

  it("names repeated functions' uniforms apart", () => {
    const { code, uniforms } = compileSolid(sphere(1).add(sphere(0.5).move(1)));
    expect(uniforms).toMatchObject({ sphere_radius: 1, sphere_radius_2: 0.5 });
    expect(code).toContain("uniform float sphere_radius_2;");
  });

  it("shares a uniform when an omitted size copies another", () => {
    const { code, uniforms } = compileSolid(box(2));
    expect(code).toContain("vec3(box_width, box_width, box_width)");
    expect(Object.keys(uniforms)).not.toContain("box_height");
  });

  it("passes out's options through as uniforms with defaults", () => {
    const glow = () => 1;
    const { code, uniforms } = compileSolid(torus(), { glow, background: 0.1 });
    expect(uniforms).toMatchObject({ aoCamera: 4, aoGlow: glow, aoBackground: 0.1 });
    expect(code).toContain("uniform vec3 aoBackground;");
  });

  it("bounds the raymarch by how far displacements reach and how steep they are", () => {
    const { code } = compileSolid(sphere().spikes(0.5).scale(2));
    expect(code).toContain("float aoReach() { return ((0.0 + abs(spikes_length)) * abs(scale_amount)); }");
    expect(code).toMatch(/float aoSlope\(\) \{ return \(0\.0 \+ 0\.5 \* abs\(spikes_length \* spikes_density\)/);
  });

  it("saturates the colour the chain had before it", () => {
    const { code, uniforms } = compileSolid(sphere().color(0.4, 0.8, 1).saturate(0.2));
    expect(code).toContain("vec4 s1 = vec4(vec3(color_r, color_g, color_b), s0.a);");
    expect(code).toContain("vec4 s2 = vec4(mix(vec3(dot(s1.rgb, vec3(0.2125, 0.7154, 0.0721))), s1.rgb, saturate_amount), s1.a);");
    expect(uniforms.saturate_amount).toBe(0.2);
  });

  it("repeats endlessly unless given a count", () => {
    expect(compileSolid(sphere().repeat()).uniforms.repeat_count).toBe(0);
    const { code, uniforms } = compileSolid(sphere().repeat(3, 0, 3, 5));
    expect(code).toContain("aoRepeat(p, vec3(repeat_x, repeat_y, repeat_z), repeat_count)");
    expect(uniforms.repeat_count).toBe(5);
  });

  it("mirrors only the axes switched on", () => {
    const { code, uniforms } = compileSolid(sphere(0.5).move(1, 1).mirror(1, 0, 1));
    expect(code).toContain("vec3 p0 = mix(p, abs(p), step(0.5, vec3(mirror_x, mirror_y, mirror_z)));");
    expect(uniforms).toMatchObject({ mirror_x: 1, mirror_y: 0, mirror_z: 1 });
  });

  it("tapers by the width at the height the solid sees, shrinking the distance where it narrows", () => {
    const { code } = compileSolid(cylinder().taper(-0.5));
    expect(code).toContain("vec3 p0 = aoTaper(p, taper_amount);");
    expect(code).toContain("s1.a * min(aoTaperWidth(p0.y, taper_amount), 1.0)");
  });

  it("bounds the raymarch for warps that move the point", () => {
    expect(compileSolid(plane().ripple(0.2, 5)).code)
      .toContain("float aoReach() { return (0.0 + abs(ripple_amount)); }");
    expect(compileSolid(sphere().warp()).code)
      .toContain("float aoSlope() { return (0.0 + 3.0 * abs(warp_amount * warp_scale)); }");
    // Like twist, bend and taper step by the slope alone, however far away.
    for (const chain of [box().bend(), cylinder().taper()]) expect(compileSolid(chain).code).toContain("float aoReach() { return (1e6); }");
  });

  it("pushes the surface by the waveform, cracks and ridges with bounded reach", () => {
    const { code } = compileSolid(sphere().waveform(0.2).cells(0.1).ridges(0.05).onion(4));
    expect(code).toContain("aoWaveform(p)");
    expect(code).toContain("aoCracks(p * cells_scale + iTime * cells_speed)");
    expect(code).toMatch(/aoOnion\(s\d+\.a, onion_count, onion_gap, onion_thickness\)/);
    expect(code).toContain("float aoReach() { return (((0.0 + abs(waveform_amount)) + abs(cells_amount)) + abs(ridges_amount)); }");
  });

  it("pipes a chain through a function, passing the extra arguments", () => {
    const spikey = (s: Chain, length: number) => s.spikes(length).spin(0.5, 0);
    const piped = torus().pipe(spikey, 0.4).add(sphere());
    expect(piped).toBeInstanceOf(Solid);
    expect(compileSolid(piped).code).toBe(compileSolid(spikey(torus(), 0.4).add(sphere())).code);
    expect(compileSolid(piped).uniforms.spikes_length).toBe(0.4);
  });

  it("shades a ray that runs out of steps grazing a spike base, rather than showing the background through it", () => {
    const { code } = compileSolid(sphere().spikes(0.9, 9, 5));
    // Tracks where the ray came closest, then falls back to it only when the
    // loop ran out of steps (not when the ray left the scene past t = 40).
    expect(code).toMatch(/if \(gap < closest\) \{ closest = gap; closestT = t; closestHit = hit; \}/);
    expect(code).toContain("if (!found && t <= 40.0 && closest < 0.02) { found = true; t = closestT; hit = closestHit; }");
  });
});

describe("solid mistakes fail when the line runs", () => {
  it("rejects arguments that aren't numbers or functions", () => {
    expect(() => sphere("1")).toThrow('sphere(radius): expected a number or a function, got "1"');
    expect(() => sphere().spikes([0.1, 0.2])).toThrow("spikes(length): expected a number or a function, got an array");
    expect(() => sphere(NaN)).toThrow("sphere(radius): expected a number or a function, got NaN");
  });

  it("asks for a solid to combine with", () => {
    expect(() => sphere().add(0.5)).toThrow("add: expected a solid such as sphere(), got 0.5");
  });

  it("asks pipe for a function that returns a solid", () => {
    expect(() => sphere().pipe(0.5)).toThrow("pipe: expected a function such as (s) => s.spin(), got 0.5");
    // A braced arrow function without `return` is the usual slip.
    expect(() => sphere().pipe((s: Chain) => { s.spin(); })).toThrow("pipe: expected the function to return a solid, got undefined");
  });

  it("reads the last frame only when asked for trails", () => {
    expect(compileSolid(sphere()).code).not.toContain("aoPrevious");
    const a = compileSolid(sphere(), { trails: 0.8 });
    expect(a.code).toContain("texture(aoPrevious, fragCoord / iResolution.xy)");
    expect(a.code).toContain("uniform float aoTrails;");
    expect(a.uniforms.aoTrails).toBe(0.8);
    // Like every other number, a new trails value doesn't recompile.
    expect(compileSolid(sphere(), { trails: () => 0.5 }).code).toBe(a.code);
  });

  it("asks for a source to render into", () => {
    expect(() => sphere().out({})).toThrow("out: expected a source such as s0, got [object Object]");
  });

  it("renders into the given source with the scale option", () => {
    const calls: unknown[][] = [];
    sphere().out({ initScene: (...args: unknown[]) => calls.push(args) }, { scale: 0.5 });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("void mainImage");
    expect(calls[0][1]).toMatchObject({ scale: 0.5, uniforms: { sphere_radius: 1 } });
  });

  it("renders at an automatic scale unless given one", () => {
    const calls: unknown[][] = [];
    sphere().out({ initScene: (...args: unknown[]) => calls.push(args) });
    expect(calls[0][1]).toMatchObject({ scale: "auto" });
  });

  // Each deck evaluates its sketch with its own shapes, so a bare .out()
  // must reach that deck's s0 and not whichever deck the window points at.
  it("renders a bare out() into the home source of the shapes that started the chain", () => {
    const hits: string[] = [];
    const deck = (name: string) => makeSolidShapes(() => ({ initScene: () => hits.push(name) }));
    const a = deck("a"), b = deck("b");
    (a.sphere() as Chain).spikes().add(b.box()).out();
    (b.torus() as Chain).move(1).out();
    expect(hits).toEqual(["a", "b"]);
  });
});

