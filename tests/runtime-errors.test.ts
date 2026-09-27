import { describe, expect, it, vi } from "vitest";
import { describeError, ErrorReporter, hydraConsoleMessage, installRuntimeErrorReporting } from "../src/renderer/runtime-errors";

describe("hydraConsoleMessage", () => {
  it("recognizes a throwing Hydra argument function", () => {
    expect(hydraConsoleMessage("warn", ["ERROR", new ReferenceError("mids is not defined")]))
      .toBe("Hydra argument: ReferenceError: mids is not defined");
  });

  it("recognizes an argument function that returns something else", () => {
    expect(hydraConsoleMessage("warn", ["function does not return a number", () => "big"]))
      .toBe('Hydra argument does not return a number: () => "big"');
  });

  it("recognizes errors during tick and from update", () => {
    expect(hydraConsoleMessage("warn", ["Error during tick():", new Error("boom")])).toBe("Hydra: boom");
    expect(hydraConsoleMessage("log", [new TypeError("x is undefined")])).toBe("update: TypeError: x is undefined");
  });

  it("ignores everything else", () => {
    expect(hydraConsoleMessage("warn", ["something else"])).toBeNull();
    expect(hydraConsoleMessage("warn", ["ERROR"])).toBeNull();
    expect(hydraConsoleMessage("log", ["loaded script x"])).toBeNull();
    expect(hydraConsoleMessage("log", [new Error("a"), "b"])).toBeNull();
  });
});

describe("describeError", () => {
  it("describes errors and other thrown values on one line", () => {
    expect(describeError(new Error("plain"))).toBe("plain");
    expect(describeError(new RangeError("far"))).toBe("RangeError: far");
    expect(describeError("thrown string")).toBe("thrown string");
  });
});

describe("ErrorReporter", () => {
  it("shows each message once until reset", () => {
    const show = vi.fn();
    const reporter = new ErrorReporter(show);
    expect(reporter.report("a")).toBe(true);
    expect(reporter.report("a")).toBe(false);
    expect(reporter.report("b")).toBe(true);
    reporter.reset();
    expect(reporter.report("a")).toBe(true);
    expect(show.mock.calls).toEqual([["a"], ["b"], ["a"]]);
  });
});

describe("installRuntimeErrorReporting", () => {
  it("reports a per-frame Hydra warning once instead of flooding the console", () => {
    const show = vi.fn();
    const warn = vi.fn(), log = vi.fn(), debug = vi.fn();
    const fakeConsole = { warn, log, debug } as unknown as Console;
    const target = new EventTarget() as unknown as Window;
    installRuntimeErrorReporting(new ErrorReporter(show), target, fakeConsole);
    const error = new Error("boom");
    for (let frame = 0; frame < 60; frame++) fakeConsole.warn("ERROR", error);
    fakeConsole.warn("unrelated");
    expect(show.mock.calls).toEqual([["Hydra argument: boom"]]);
    expect(debug.mock.calls).toEqual([["ERROR", error]]);
    expect(warn.mock.calls).toEqual([["unrelated"]]);
  });

  it("reports uncaught errors and rejections", () => {
    const show = vi.fn();
    const target = new EventTarget() as unknown as Window;
    installRuntimeErrorReporting(new ErrorReporter(show), target, { warn() {}, log() {}, debug() {} } as unknown as Console);
    const error = Object.assign(new Event("error", { cancelable: true }), { error: new TypeError("late") });
    target.dispatchEvent(error);
    const rejection = Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason: "nope" });
    target.dispatchEvent(rejection);
    expect(show.mock.calls).toEqual([["TypeError: late"], ["nope"]]);
    expect(error.defaultPrevented).toBe(true);
  });
});
