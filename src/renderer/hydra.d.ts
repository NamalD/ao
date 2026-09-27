// hydra-synth ships without types; declare only what Ao's host uses.
declare module "hydra-synth" {
  export default class Hydra {
    constructor(options: Record<string, unknown>);
    s: HydraSource[];
    width: number;
    height: number;
    synth: { time: number; speed: number; hush(): void };
    tick(dt: number): void;
    setResolution(width: number, height: number): void;
  }
}

declare module "hydra-synth/src/glsl/glsl-functions.js" {
  interface HydraFunctionInput { name: string; type: string; default?: number | string | null }
  interface HydraFunctionDefinition { name: string; type: string; inputs: HydraFunctionInput[] }
  export default function hydraFunctions(): HydraFunctionDefinition[];
}

declare module "hydra-synth/src/lib/array-utils.js" {
  type ArrayValue = (props: { time: number; bpm: number }) => number;
  const arrayUtils: { init(): void; getValue(arr?: unknown[]): ArrayValue };
  export default arrayUtils;
}

declare module "hydra-synth/src/hydra-source.js" {
  const HydraSource: { prototype: object };
  export default HydraSource;
}

interface HydraSource {
  src: unknown;
  dynamic: boolean;
  init(options: { src: unknown; dynamic?: boolean }): void;
  initScene(code: string, options?: import("./scenes").SceneOptions): void;
}
