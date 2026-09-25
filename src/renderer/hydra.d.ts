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

interface HydraSource {
  src: unknown;
  dynamic: boolean;
  init(options: { src: unknown; dynamic?: boolean }): void;
  initScene(code: string, options?: import("./scenes").SceneOptions): void;
}
