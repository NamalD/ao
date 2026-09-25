import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parecCommand } from "../src/main/capture";
import { findExecutable } from "../src/shared/executable";

describe("capture command", () => {
  it("resolves parec to an absolute executable path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-path-"));
    writeFileSync(join(dir, "parec"), "#!/bin/sh\n", { mode: 0o755 });
    const parec = findExecutable("parec", `relative/bin:${dir}`);
    expect(parec).toBe(join(dir, "parec"));
    const [command, args] = parecCommand("sink.monitor", parec!);
    expect(isAbsolute(command)).toBe(true);
    expect(args).toContain("sink.monitor");
    expect(args).toContain("--format=float32le");
  });

  it("reports a missing or non-executable program instead of a bare name", () => {
    const dir = mkdtempSync(join(tmpdir(), "ao-path-"));
    writeFileSync(join(dir, "parec"), "not executable", { mode: 0o644 });
    expect(findExecutable("parec", dir)).toBeNull();
    expect(findExecutable("parec", "")).toBeNull();
  });
});
