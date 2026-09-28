import { fileURLToPath } from "node:url";

/**
 * hydra-synth's exports map omits src/hydra-source.js, which the editor reads
 * to list source methods, src/lib/array-utils.js, and
 * src/generator-factory.js, which tests/glow.test.ts compiles real chains
 * with. Point the bare
 * specifiers at the files directly.
 */
export const hydraAlias = {
  "hydra-synth/src/hydra-source.js": fileURLToPath(new URL("./node_modules/hydra-synth/src/hydra-source.js", import.meta.url)),
  // Ao phase-locks Hydra's array sequences to the beat (renderer/tempo.ts).
  "hydra-synth/src/lib/array-utils.js": fileURLToPath(new URL("./node_modules/hydra-synth/src/lib/array-utils.js", import.meta.url)),
  "hydra-synth/src/generator-factory.js": fileURLToPath(new URL("./node_modules/hydra-synth/src/generator-factory.js", import.meta.url)),
};
