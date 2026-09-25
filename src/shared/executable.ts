import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * Resolves a program name to an absolute executable path by searching PATH.
 * Capture commands are always spawned by absolute path so a missing tool is
 * reported clearly instead of depending on how the child process searches.
 */
export function findExecutable(name: string, searchPath = process.env.PATH ?? ""): string | null {
  for (const dir of searchPath.split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching.
    }
  }
  return null;
}
