import { describe, expect, it } from "vitest";
import { compileSolid, makeSolidShapes, Solid, solidFunctions, solidShapes } from "../src/renderer/solids";

// Methods are installed from the solidFunctions table, so the type has no names for them.
type Chain = any;
const { sphere, box, torus } = solidShapes as Record<string, (...args: unknown[]) => Chain>;

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
    expect(code).toContain("s1.a - spikes_length * aoSpikes(p0, spikes_density, spikes_sharpness)");
    expect(code).toMatch(/vec4 aoMap\(vec3 p\) \{[\s\S]*return s3;\n\}/);
  });

  it("turns every argument into a uniform, filling in defaults", () => {
    const heat = () => 0.5;
    const { uniforms } = compileSolid(sphere().spikes(heat));
    expect(uniforms).toMatchObject({ sphere_radius: 1, spikes_length: heat, spikes_density: 8, spikes_sharpness: 4 });
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

