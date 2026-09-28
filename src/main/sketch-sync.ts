import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { basename } from "node:path";
import { findExecutable } from "../shared/executable";

export interface SyncResult {
  /** Names of the sketches committed, empty when nothing had changed. */
  committed: string[];
  /** Why nothing was committed or pushed, if something went wrong. */
  error?: string;
}

/** `Update sketches: aurora, dunes` for the changed `sketches/*.js` paths. */
export function commitMessage(paths: string[]): string {
  const names = [...new Set(paths.map((p) => basename(p).replace(/\.js$/, "")))].sort();
  return `Update sketches: ${names.join(", ")}`;
}

/**
 * Commits every change under `sketches/` in the repository at `root`, leaving
 * anything else staged or modified alone, then pushes in a detached process so
 * closing Ao never waits on the network. Push output is appended to `logPath`.
 */
export function syncSketches(root: string, logPath: string, git = findExecutable("git")): SyncResult {
  if (!git) return { committed: [], error: "git not found on PATH" };
  const run = (...args: string[]) =>
    execFileSync(git, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    run("add", "--all", "--", "sketches");
    const paths = run("diff", "--cached", "--name-only", "--", "sketches").split("\n").filter(Boolean);
    if (paths.length === 0) return { committed: [] };
    // A pathspec commits only the sketches, even if other files are staged.
    run("commit", "--quiet", "-m", commitMessage(paths), "--", "sketches");
    const log = openSync(logPath, "a");
    try {
      spawn(git, ["push", "--quiet"], {
        cwd: root,
        detached: true,
        stdio: ["ignore", log, log],
        // Never block on a credential prompt nobody can see.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      }).unref();
    } finally {
      closeSync(log);
    }
    return { committed: paths.map((p) => basename(p, ".js")) };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    return { committed: [], error: stderr || (error as Error).message };
  }
}
