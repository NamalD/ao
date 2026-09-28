import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitMessage, syncSketches } from "../src/main/sketch-sync";

/** A repo with one committed sketch, pushing to a bare `origin`. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "ao-sync-"));
  const remote = join(dir, "remote.git");
  const root = join(dir, "work");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "master", remote]);
  mkdirSync(join(root, "sketches"), { recursive: true });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("remote", "add", "origin", remote);
  writeFileSync(join(root, "sketches/dunes.js"), "osc().out()\n");
  writeFileSync(join(root, "sketches/aurora.js"), "voronoi().out()\n");
  writeFileSync(join(root, "README.md"), "ao\n");
  git("add", ".");
  git("commit", "-qm", "base");
  git("push", "-q", "-u", "origin", "master");
  return { root, remote, git, log: join(dir, "ao.log") };
}

async function pushed(remote: string, head: string): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    const tip = execFileSync("git", ["rev-parse", "master"], { cwd: remote, encoding: "utf8" }).trim();
    if (tip === head) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("sketch sync", () => {
  it("names each changed sketch once, in order", () => {
    expect(commitMessage(["sketches/zeta.js", "sketches/aurora.js", "sketches/zeta.js"]))
      .toBe("Update sketches: aurora, zeta");
  });

  it("commits new, edited and deleted sketches only, then pushes", async () => {
    const { root, remote, git, log } = repo();
    writeFileSync(join(root, "sketches/dunes.js"), "noise().out()\n");
    writeFileSync(join(root, "sketches/halo.js"), "shape().out()\n");
    unlinkSync(join(root, "sketches/aurora.js"));
    writeFileSync(join(root, "README.md"), "staged elsewhere\n");
    git("add", "README.md");

    const result = syncSketches(root, log);
    expect(result).toEqual({ committed: ["aurora", "dunes", "halo"] });
    expect(git("log", "-1", "--format=%s")).toBe("Update sketches: aurora, dunes, halo");
    expect(git("show", "--name-only", "--format=", "HEAD").split("\n").sort())
      .toEqual(["sketches/aurora.js", "sketches/dunes.js", "sketches/halo.js"]);
    // Other staged work stays staged and uncommitted.
    expect(git("diff", "--cached", "--name-only")).toBe("README.md");
    expect(await pushed(remote, git("rev-parse", "HEAD"))).toBe(true);
  });

  it("does nothing when no sketch changed", () => {
    const { root, git, log } = repo();
    const head = git("rev-parse", "HEAD");
    expect(syncSketches(root, log)).toEqual({ committed: [] });
    expect(git("rev-parse", "HEAD")).toBe(head);
  });

  it("reports a missing git instead of throwing", () => {
    expect(syncSketches(tmpdir(), "/dev/null", null).error).toMatch(/git not found/);
  });
});
