import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/agent-worktree");

describe("agent-worktree create", () => {
  it("branches from the current HEAD, not master", () => {
    const repo = mkdtempSync(join(tmpdir(), "ao-worktree-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "master");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    // The script lives in the repo it manages; ignore the worktrees it creates.
    mkdirSync(join(repo, "scripts"));
    copyFileSync(script, join(repo, "scripts/agent-worktree"));
    writeFileSync(join(repo, ".gitignore"), ".worktrees/\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "feature");
    git("commit", "-q", "--allow-empty", "-m", "feature work");
    const head = git("rev-parse", "HEAD");

    execFileSync("bash", ["scripts/agent-worktree", "create", "probe"], { cwd: repo, stdio: "pipe" });
    expect(git("rev-parse", "agent/probe")).toBe(head);
  });
});
