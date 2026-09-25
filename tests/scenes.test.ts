import { describe, expect, it } from "vitest";
import { formatShaderLog, PRELUDE_LINES } from "../src/renderer/scenes";

describe("formatShaderLog", () => {
  it("reports errors at the scene's own line numbers", () => {
    const log = `ERROR: 0:${PRELUDE_LINES + 3}: 'foo' : undeclared identifier\nERROR: 0:${PRELUDE_LINES + 7}: syntax error`;
    expect(formatShaderLog(log)).toBe("ERROR: 0:3: 'foo' : undeclared identifier\nERROR: 0:7: syntax error");
  });
});
