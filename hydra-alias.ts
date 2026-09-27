import { fileURLToPath } from "node:url";

/**
 * hydra-synth's exports map omits src/hydra-source.js, which the editor reads
 * to list source methods. Point the bare specifier at the file directly.
 */
export const hydraAlias = {
  "hydra-synth/src/hydra-source.js": fileURLToPath(new URL("./node_modules/hydra-synth/src/hydra-source.js", import.meta.url)),
};
