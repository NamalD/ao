import { fileURLToPath } from "node:url";

/**
 * hydra-synth's exports map omits src/hydra-source.js, which the editor reads
 * to list source methods, and src/lib/array-utils.js. Point the bare
 * specifiers at the files directly.
 */
export const hydraAlias = {
  "hydra-synth/src/hydra-source.js": fileURLToPath(new URL("./node_modules/hydra-synth/src/hydra-source.js", import.meta.url)),
  // Ao phase-locks Hydra's array sequences to the beat (renderer/tempo.ts).
  "hydra-synth/src/lib/array-utils.js": fileURLToPath(new URL("./node_modules/hydra-synth/src/lib/array-utils.js", import.meta.url)),
};
