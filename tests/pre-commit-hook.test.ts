import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A repository using Ao's hooks, whose `make test` fails while `code.txt`
 * says "broken" and records each run in `runs` outside the snapshot.
 */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "ao-hook-"));
  const runs = join(root, "..", `${root.split("/").pop()}-runs`);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  mkdirSync(join(root, ".githooks"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "sketches"));
  for (const hook of ["pre-commit", "pre-merge-commit"]) copyFileSync(resolve(".githooks", hook), join(root, ".githooks", hook));
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  writeFileSync(join(root, "Makefile"), `test:\n\techo run >> ${runs}\n\t! grep -q broken code.txt\n`);
  writeFileSync(join(root, "code.txt"), "fine\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("config", "core.hooksPath", ".githooks");
  const commit = (...files: string[]) => {
    git("add", ...files);
    try {
      git("commit", "-qm", "change");
      return true;
    } catch {
      return false;
    }
  };
  return { root, git, commit, runs };
}

describe("pre-commit hook", () => {
  it("refuses a commit whose staged changes fail make test", () => {
    const { root, commit } = repo();
    writeFileSync(join(root, "code.txt"), "broken\n");
    expect(commit("code.txt")).toBe(false);
  });

  it("tests what is staged, not unstaged edits", () => {
    const { root, git, commit } = repo();
    writeFileSync(join(root, "code.txt"), "fine, staged\n");
    git("add", "code.txt");
    writeFileSync(join(root, "code.txt"), "broken, unstaged\n");
    expect(commit()).toBe(true);
  });

  it("lets a commit of only sketches through without running make test", () => {
    const { root, commit, runs } = repo();
    writeFileSync(join(root, "code.txt"), "broken\n");
    writeFileSync(join(root, "sketches/wip.js"), "osc(\n");
    expect(commit("sketches/wip.js")).toBe(true);
    expect(() => execFileSync("cat", [runs], { stdio: "pipe" })).toThrow();
  });

  it("holds a merge commit to make test", () => {
    const { root, git, commit } = repo();
    git("checkout", "-qb", "feature");
    git("config", "core.hooksPath", "/dev/null");
    writeFileSync(join(root, "code.txt"), "broken\n");
    commit("code.txt");
    git("checkout", "-q", "master");
    git("commit", "-q", "--allow-empty", "-m", "diverge");
    git("config", "core.hooksPath", ".githooks");
    expect(() => git("merge", "--no-ff", "-q", "feature", "-m", "merge")).toThrow();
  });
});
