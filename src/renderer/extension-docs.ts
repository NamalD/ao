/**
 * Hand-written docs for the vendored Hydra extensions (vendor/hydra/): what
 * the files can't say about themselves. Names, types, parameter names and
 * defaults of `setFunction` definitions come from the files (see
 * extension-api.ts); this adds a description for every name, help for each
 * parameter, the signatures of the JS helpers and patched methods, which
 * explorer group each belongs to, and what's known to be broken upstream.
 *
 * Parameter help is keyed by the name as shown, without a leading `_`
 * (arithmetics' `_min` is `min`). A test fails when a file adds a name that
 * isn't here or this names something no file adds.
 */

export interface ExtensionParamDoc {
  name: string;
  default?: number | string | null;
  description?: string;
}

export interface ExtensionFunctionDoc {
  /** One line, or two: what it does. */
  description: string;
  /** Help for parameters read from a setFunction definition, by name. */
  params?: Record<string, string>;
  /** The parameters, for names that aren't setFunction definitions (JS helpers, patched methods). */
  args?: ExtensionParamDoc[];
  /** Overrides the signature built from the parameters. */
  signature?: string;
  /** The explorer group; the extension's first group when absent. */
  group?: string;
  /** Why it doesn't work in Ao, shown with its docs. */
  broken?: string;
}

export interface ExtensionDoc {
  author: string;
  licence: string;
  /** What the extension is, for its explorer intro. */
  intro: string;
  /** Explorer group ids, in order; see extensionGroups. */
  groups: string[];
  functions: Record<string, ExtensionFunctionDoc>;
}

/** Explorer sections for the extensions, in order: at least one per extension. */
export const extensionGroups: { id: string; extension: string; title: string }[] = [
  { id: "ext:noise", extension: "noise", title: "noise · generators" },
  { id: "ext:softpattern", extension: "softpattern", title: "softpattern · patterns" },
  { id: "ext:fractals", extension: "fractals", title: "fractals · folds" },
  { id: "ext:outputs", extension: "outputs", title: "outputs · o0–o3 settings" },
  { id: "ext:gradientmap", extension: "gradientmap", title: "gradientmap · gradients" },
  { id: "ext:arithmetics-generators", extension: "arithmetics", title: "arithmetics · generators" },
  { id: "ext:arithmetics-maths", extension: "arithmetics", title: "arithmetics · colour maths" },
  { id: "ext:arithmetics-numbers", extension: "arithmetics", title: "arithmetics · number ops" },
  { id: "ext:arithmetics-ranges", extension: "arithmetics", title: "arithmetics · ranges" },
];

const speed = "How fast it evolves over time.";

/** arithmetics' unary ops: GLSL's own function applied to every channel. */
const unary = (text: string): ExtensionFunctionDoc => ({
  description: `${text} Applied to every channel, alpha included.`,
  group: "ext:arithmetics-maths",
});

const operand: ExtensionParamDoc = {
  name: "value",
  description: "A number, function or array for every channel, or a texture (a chain, o0–o3, s0–s3) to combine pixel by pixel.",
};
/** arithmetics' wrapped two-operand ops, which take a number or a texture. */
const binary = (description: string, value: ExtensionParamDoc = operand, extra: ExtensionParamDoc[] = []): ExtensionFunctionDoc => ({
  description,
  args: [value, ...extra],
  group: "ext:arithmetics-numbers",
});
const amount: ExtensionParamDoc = { name: "amount", default: 1, description: "With a texture, how much of it: as Hydra's own, 1 is full." };

const mirror = (axis: "X" | "Y", keep: string): ExtensionFunctionDoc => ({
  description: `Folds the image ${axis === "X" ? "left–right" : "top–bottom"} about a mirror line, repeating the fold every \`coverage\`; ${keep}.`,
  params: {
    pos: `Where the mirror line sits, as an offset from the ${axis === "X" ? "vertical" : "horizontal"} centre line.`,
    coverage: `${axis === "X" ? "Width" : "Height"} of one mirrored tile; 1 is the whole screen, 0.5 folds twice.`,
  },
});

const sampling = "Settings apply to both framebuffers of the output and matter when it's sampled, as in feedback with src(o0).";
const wrapBroken = (mode: string) =>
  `At Ao's window sizes this turns the output black: WebGL 1 can't ${mode} textures whose sides aren't powers of two. Use Hydra's .repeat() or fractals' .mirrorWrap() instead.`;
const instead = "Use lengthCenter(), or x().mult(x()).add(y().mult(y())).sqrt().";

export const extensionDocs: Record<string, ExtensionDoc> = {
  noise: {
    author: "Thomas Jourdan",
    licence: "AGPL-3.0",
    intro: "Noise generators from Thomas Jourdan's extra-shaders-for-hydra (`lib-noise.js`): blocky white noise, smooth 0..1 noise, fractal turbulence and domain warping. They start a chain like osc(); Hydra's own noise() is unchanged.",
    groups: ["ext:noise"],
    functions: {
      whitenoise: {
        description: "Blocky random static: one random grey per block.",
        params: { size: "Block size in pixels.", dynamic: "How fast the static changes; 0 freezes it." },
      },
      colornoise: {
        description: "Blocky random static in colour: red, green and blue each random per block.",
        params: { size: "Block size in pixels.", dynamic: "How fast the static changes; 0 freezes it." },
      },
      unoise: {
        description: "Smooth greyscale simplex noise in 0..1, where Hydra's noise() spans −1..1.",
        params: { scale: "Noise frequency; higher gives finer detail.", offset: speed },
      },
      turb: {
        description: "Turbulence: octaves of simplex noise, each twice as fine and half as strong, summed into cloudy fractal noise, roughly −1..1.",
        params: { scale: "Frequency of the first octave.", offset: speed, octaves: "Octaves summed, up to 8; a fraction fades the next one in." },
      },
      uturb: {
        description: "turb() remapped to 0..1, so its dark half shows.",
        params: { scale: "Frequency of the first octave.", offset: speed, octaves: "Octaves summed, up to 8; a fraction fades the next one in." },
      },
      warp: {
        description: "Domain warping, after Inigo Quilez: two turbulence fields push around where a third is read, for marbled, flowing shapes.",
        params: {
          scalei: "Frequency of the inner, warping noise.",
          offset: speed,
          octaves: "Octaves of the outer noise, up to 8.",
          octavesinner: "Octaves of the inner noise, up to 8.",
          scale: "Frequency of the outer noise over the warped coordinates; higher warps harder.",
        },
      },
      cwarp: {
        description: "warp() in 0..1, darkened away from the centre so the pattern gathers in the middle.",
        params: {
          scalei: "Frequency of the inner, warping noise.",
          offset: speed,
          octaves: "Octaves of the outer noise, up to 8.",
          octavesinner: "Octaves of the inner noise, up to 8.",
          scale: "Frequency of the outer noise over the warped coordinates; higher warps harder.",
          focus: "How the darkening grows with distance from the centre (distance^focus is subtracted); lower darkens more.",
        },
      },
      ncontour: {
        description: "Contour lines of layered noise: dark along the level `thresh`, white elsewhere.",
        params: {
          thresh: "Noise level the lines follow.",
          smooth: "Width of the soft edge around each line.",
          octaves: "Noise layers summed, up to 5.",
          scale: "Frequency of the first layer.",
          speed: "How fast the first layer moves.",
          step: "Factor each further layer's frequency grows, and its speed shrinks, by.",
        },
      },
    },
  },
  softpattern: {
    author: "Thomas Jourdan",
    licence: "AGPL-3.0",
    intro: "Soft animated patterns from Thomas Jourdan's extra-shaders-for-hydra (`lib-softpattern.js`): glowing tiles, blobs, rings, colour noise and a flickering sun. They start a chain like osc().",
    groups: ["ext:softpattern"],
    functions: {
      blinking: {
        description: "A grid of glowing tiles, like paper lanterns, each a noise-driven colour fading out towards its edges.",
        params: {
          tiles: "Tiles across and down.",
          scale: "Noise frequency across the grid; higher makes neighbouring tiles differ more.",
          speed: "How fast the colours change.",
          phase: "Offset between the hue, saturation and value noises.",
        },
      },
      blobs: {
        description: "Dark blobs around three points circling the centre at different speeds, merging like metaballs on white.",
        params: {
          speed: "How fast the points circle.",
          tresh: "Blob size: the threshold on the product of the distances to the points.",
          soft: "Softness of the blob edges.",
        },
      },
      concentric: {
        description: "Rings rippling through the centre: sine waves of the distance from it, at several frequencies, added up.",
        params: {
          base: "Ring frequency.",
          octaves: "Frequency multiplier of the next layer of rings (squared for the one after).",
          ampscale: "Strength of the next layer (squared for the one after).",
          speed: "How fast the rings travel.",
        },
      },
      phasenoise: {
        description: "Smooth colour noise: the hue wanders around `base`, and saturation and value follow noises of their own.",
        params: {
          base: "Centre hue, 0..1 around the colour wheel.",
          range: "How far the hue wanders from base.",
          scale: "Noise frequency.",
          speed: "How fast the noise evolves.",
          phase: "Offset between the hue, saturation and value noises.",
        },
      },
      sdfmove: {
        description: "Five dark dots sliding sideways along five rows, glowing into light by distance.",
        params: {
          speed1: "Speed of the middle dot, screens per second; negative reverses it.",
          speed2: "Speed of the second and fourth dots.",
          speed3: "Speed of the outer dots.",
        },
      },
      smoothsun: {
        description: "A soft glowing disc with a noisy, flickering rim.",
        params: {
          threshold: "Radius of the sun.",
          border: "Softness of the rim.",
          speed: "How fast the rim flickers.",
          ampscale: "Strength of each finer layer of rim noise.",
        },
      },
    },
  },
  fractals: {
    author: "geikha (hyper-hydra)",
    licence: "GPL-3.0",
    intro: "Coordinate folds from geikha's hyper-hydra (`hydra-fractals.js`) for fractal feedback: mirrors, a mirrored wrap, and circle inversion. They continue a chain like .kaleid(); feed src(o0) through them to make shapes bloom back from the edges.",
    groups: ["ext:fractals"],
    functions: {
      mirrorX: mirror("X", "one half shows, mirrored onto the other"),
      mirrorY: mirror("Y", "one half shows, mirrored onto the other"),
      mirrorX2: mirror("X", "like mirrorX(), but the other half shows"),
      mirrorY2: {
        ...mirror("Y", "meant to show the other half, like mirrorX2()"),
        description: "Meant as mirrorY() showing the other half, like mirrorX2(); upstream's shader is identical to mirrorY()'s, so it looks the same.",
      },
      mirrorWrap: {
        description: "Folds coordinates outside 0..1 back in, mirroring rather than wrapping, so a zoomed-out or inverted image tiles seamlessly. Put it before .scale() or after .inversion().",
      },
      inversion: {
        description: "Circle inversion around the corner where x and y are 0: coordinates divided by their squared length, so that corner flies out and far points fold in. Follow with .mirrorWrap() to fold the result back on screen.",
      },
    },
  },
  outputs: {
    author: "geikha (hyper-hydra)",
    licence: "GPL-3.0",
    intro: "Output framebuffer settings from geikha's hyper-hydra (`hydra-outputs.js`): o0.setLinear() for smooth feedback, clear(), texture wrapping and more buffers, and oS for all four outputs. Ao puts every output back to Hydra's defaults when a deck switches sketches.",
    groups: ["ext:outputs"],
    functions: {
      setNearest: { description: `Nearest-neighbour sampling, Hydra's default: feedback that scales or turns stays crisp but goes blocky. ${sampling}`, args: [] },
      setLinear: { description: `Linear sampling: feedback that scales or turns stays smooth instead of going blocky. ${sampling}`, args: [] },
      setRepeat: { description: "Meant to tile the output when it's sampled outside 0..1.", args: [], broken: wrapBroken("repeat") },
      setClamp: { description: "Sampling outside 0..1 takes the edge pixels, Hydra's default.", args: [] },
      setMirror: { description: "Meant to mirror the output when it's sampled outside 0..1.", args: [], broken: wrapBroken("mirror") },
      clear: { description: "Clears the output to transparent black, wiping feedback trails.", args: [] },
      setBufferCount: {
        description: "Meant to render the output through `count` framebuffers in turn instead of two. Marked experimental upstream; setBufferCount(2) undoes it.",
        args: [{ name: "count", default: 2, description: "Framebuffers, at least 2." }],
        broken: "With more than two, Hydra 1.4 keeps showing and sampling a stale buffer, so the output looks frozen: Hydra reads outputs through its own two-buffer index, which the extension's renderer never advances.",
      },
      resetBuffers: {
        description: "Back to Hydra's defaults: two buffers, nearest sampling, clamped. Ao does this on every sketch switch.",
        args: [],
      },
      setFbos: {
        description: "Sets texture options regl-style, for both framebuffers or each: { min, mag: 'nearest' or 'linear', wrapS, wrapT: 'clamp', 'repeat' or 'mirror' }. Repeat and mirror turn the output black at Ao's sizes.",
        args: [
          { name: "options", description: "{ min, mag, wrapS, wrapT } for both framebuffers, or the first if a second is given." },
          { name: "options2", description: "Options for the second framebuffer." },
        ],
        signature: "setFbos(options, options2?)",
      },
      oS: {
        description: "All four outputs at once: oS.setLinear(), oS.clear(), oS.setFbos(…) and the other output methods call it on o0–o3.",
        signature: "oS.setLinear(), oS.clear(), …",
      },
    },
  },
  gradientmap: {
    author: "geikha (hyper-hydra)",
    licence: "GPL-3.0",
    intro: "Gradient maps from geikha's hyper-hydra (`hydra-gradientmap.js`): createGradient() paints a gradient texture and .lookupX() recolours a chain by brightness through it. Ao frees the textures when a deck switches sketches.",
    groups: ["ext:gradientmap"],
    functions: {
      lookupX: {
        description: "Gradient map: recolours each pixel by its brightness, read along a row of `tex`, such as a gradient from createGradient().",
        params: {
          tex: "Texture to read, left for dark and right for bright; a createGradient(), an output or a source.",
          yOffset: "Row of tex to read, 0..1.",
          blending: "Mix with the original colour: 1 fully mapped, 0 unchanged.",
        },
      },
      lookupY: {
        description: "lookupX() along a column of `tex`, from its start (y = 0) for dark to its end for bright, so it wants a gradient along y.",
        params: {
          tex: "Texture to read along y; createLinearGradient(Math.PI / 2, …) makes a gradient that way.",
          xOffset: "Column of tex to read, 0..1.",
          blending: "Mix with the original colour: 1 fully mapped, 0 unchanged.",
        },
      },
      createLinearGradient: {
        description: "Paints a gradient texture at an angle and returns it as a source for lookupX() or src(). Colours can alternate with stop positions: \"red\", 0, \"blue\", 0.8.",
        args: [
          { name: "angle", description: "Direction in radians: 0 runs along x, the way lookupX() reads, and Math.PI / 2 along y, the way lookupY() reads." },
          { name: "colors", description: "CSS colours or [r, g, b, a] arrays in 0..1, evenly spaced unless each is followed by its stop, 0..1." },
        ],
        signature: "createLinearGradient(angle, ...colors)",
      },
      createGradient: {
        description: "Paints a left-to-right gradient texture through the colours and returns it as a source, for lookupX() or src().",
        args: [{ name: "colors", description: "CSS colours or [r, g, b, a] arrays in 0..1, evenly spaced unless each is followed by its stop, 0..1." }],
        signature: "createGradient(...colors)",
      },
    },
  },
  arithmetics: {
    author: "geikha (hyper-hydra)",
    licence: "GPL-3.0",
    intro: "Maths on colours from geikha's hyper-hydra (`hydra-arithmetics.js`): GLSL functions as chain methods (.sin(), .pow(2)), number versions of add, sub, mult and div, range mapping, and ramp generators such as x() and lengthCenter(). Build patterns from numbers: x(6).sin().unipolar().",
    groups: ["ext:arithmetics-generators", "ext:arithmetics-maths", "ext:arithmetics-numbers", "ext:arithmetics-ranges"],
    functions: {
      // Colour maths
      abs: unary("Absolute value: folds negative values, such as bipolar() output, up."),
      sign: unary("Sign: −1, 0 or 1."),
      fract: unary("Fractional part: wraps values into 0..1, turning ramps into repeating saws."),
      sin: unary("Sine, of radians."),
      cos: unary("Cosine, of radians."),
      tan: unary("Tangent, of radians."),
      asin: unary("Arcsine, in radians (−π/2..π/2); defined for −1..1."),
      acos: unary("Arccosine, in radians (0..π); defined for −1..1."),
      atan: unary("Arctangent, in radians (−π/2..π/2)."),
      exp: unary("e to the power of the value."),
      log: unary("Natural logarithm; undefined at 0 and below."),
      exp2: unary("2 to the power of the value."),
      log2: unary("Base-2 logarithm; undefined at 0 and below."),
      sqrt: unary("Square root; undefined below 0."),
      inversesqrt: unary("1 / square root; undefined at 0 and below."),
      // Number ops
      mod: binary("Remainder after division (GLSL mod) by a number or texture: wraps values into 0..value.", { ...operand, description: `Divisor: ${operand.description}` }),
      min: binary("The smaller of each channel and the value or texture."),
      max: binary("The larger of each channel and the value or texture."),
      step: binary(
        "GLSL step(channel, value): 1 where the value is at least the channel, else 0. Note the order: .step(0.5) is white where the image is darker than 0.5.",
        { ...operand, description: `Compared with each channel: ${operand.description}` },
      ),
      pow: binary("Raises each channel to a power: above 1 darkens the mids, below 1 lifts them.", { ...operand, description: `Exponent: ${operand.description}` }),
      div: binary("Divides each channel by a number, or by another texture's colour."),
      add: binary("Adds a number to every channel, or another texture as Hydra's .add() does.", operand, [amount]),
      sub: binary("Subtracts a number from every channel, or another texture as Hydra's .sub() does.", operand, [amount]),
      mult: binary("Multiplies every channel by a number, or by another texture as Hydra's .mult() does.", operand, [amount]),
      amp: {
        description: "Multiplies every channel by a number: .mult() for numbers only.",
        args: [{ name: "amount", default: 1, description: "Multiplier: a number, function or array." }],
        group: "ext:arithmetics-numbers",
      },
      amplitude: {
        description: "Another name for amp(): multiplies every channel by a number.",
        args: [{ name: "amount", default: 1, description: "Multiplier: a number, function or array." }],
        group: "ext:arithmetics-numbers",
      },
      offset: {
        description: "Adds a number to every channel: .add() for numbers only.",
        args: [{ name: "amount", default: 1, description: "Amount added: a number, function or array." }],
        group: "ext:arithmetics-numbers",
      },
      off: {
        description: "Another name for offset(): adds a number to every channel.",
        args: [{ name: "amount", default: 1, description: "Amount added: a number, function or array." }],
        group: "ext:arithmetics-numbers",
      },
      // Ranges
      bipolar: {
        description: "Maps 0..1 to −1..1, times amp: ready for .sin() or signed maths.",
        params: { amp: "Multiplier applied after mapping." },
        group: "ext:arithmetics-ranges",
      },
      unipolar: {
        description: "Maps −1..1 to 0..1, times amp: shows the dark half of .sin(), noise() or osc() maths.",
        params: { amp: "Multiplier applied after mapping." },
        group: "ext:arithmetics-ranges",
      },
      range: {
        description: "Maps 0..1 to min..max.",
        params: { min: "What 0 becomes.", max: "What 1 becomes." },
        group: "ext:arithmetics-ranges",
      },
      birange: {
        description: "Maps −1..1 to min..max, for noise() and .sin().",
        params: { min: "What −1 becomes.", max: "What 1 becomes." },
        group: "ext:arithmetics-ranges",
      },
      clamp: {
        description: "Limits every channel to min..max.",
        params: { min: "Lowest value let through.", max: "Highest value let through." },
        group: "ext:arithmetics-ranges",
      },
      // Generators
      x: {
        description: "Horizontal ramp: each pixel's x, 0 at the left edge to 1 at the right, times mult, in every channel.",
        params: { mult: "Multiplier; x(6.28).sin() makes one full wave across the screen." },
        group: "ext:arithmetics-generators",
      },
      y: {
        description: "Vertical ramp: each pixel's y, 0..1 from one edge to the other, times mult, in every channel.",
        params: { mult: "Multiplier." },
        group: "ext:arithmetics-generators",
      },
      length: {
        description: "Distance from the corner where x and y are 0, times mult.",
        params: { mult: "Multiplier." },
        group: "ext:arithmetics-generators",
        broken: `It defines a GLSL function called length, redefining a built-in, which WebGL 1 forbids: strict drivers reject the shader (ANGLE's SwiftShader happens to accept it). ${instead}`,
      },
      distance: {
        description: "Meant as the distance from the point (px, py).",
        params: { px: "The point's x, 0..1.", py: "The point's y, 0..1." },
        group: "ext:arithmetics-generators",
        broken: `Its shader calls length() with two arguments, which isn't GLSL, so it never compiles; Ao reports a shader error. ${instead}`,
      },
      xCenter: {
        description: "Horizontal ramp through the centre: 0.5 − x, times mult, so positive on the left and negative on the right.",
        params: { mult: "Multiplier." },
        group: "ext:arithmetics-generators",
      },
      yCenter: {
        description: "Vertical ramp through the centre: 0.5 − y, times mult.",
        params: { mult: "Multiplier." },
        group: "ext:arithmetics-generators",
      },
      lengthCenter: {
        description: "Distance from the centre, times mult: a radial ramp, 0 in the middle. lengthCenter(40).sin() makes rings.",
        params: { mult: "Multiplier." },
        group: "ext:arithmetics-generators",
      },
      distanceCenter: {
        description: "Meant as the distance from the point (px, py), measured from the centre.",
        params: { px: "The point's x offset.", py: "The point's y offset." },
        group: "ext:arithmetics-generators",
        broken: `Its shader calls length() with two arguments, which isn't GLSL, so it never compiles; Ao reports a shader error. ${instead}`,
      },
    },
  },
};
