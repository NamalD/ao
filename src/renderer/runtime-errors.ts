/**
 * Runtime errors from sketches: Hydra argument functions, `update`, scene
 * uniforms, timers and promises. Hydra catches its own errors and reports
 * them with console calls every frame, so they reach neither the user nor the
 * log in a useful form. This module turns them into one status message each.
 */

export type ConsoleLevel = "log" | "warn";

function isError(value: unknown): value is Error {
  return value instanceof Error ||
    (typeof value === "object" && value !== null && "message" in value && "name" in value);
}

/** A short, single-line description of a thrown value. */
export function describeError(error: unknown): string {
  if (isError(error)) return error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message;
  return String(error);
}

function describeFunction(fn: unknown): string {
  const source = String(fn).replace(/\s+/g, " ").trim();
  return source.length > 60 ? `${source.slice(0, 57)}...` : source;
}

/**
 * Maps the arguments of a console call to a user-facing message when it is one
 * of hydra-synth's runtime error reports, or null for anything else.
 */
export function hydraConsoleMessage(level: ConsoleLevel, args: readonly unknown[]): string | null {
  const [first, second] = args;
  if (level === "warn") {
    // format-arguments.js: an argument function threw; Hydra uses the default.
    if (first === "ERROR" && args.length === 2) return `Hydra argument: ${describeError(second)}`;
    // format-arguments.js: an argument function returned something else.
    if (first === "function does not return a number") {
      return `Hydra argument does not return a number: ${describeFunction(second)}`;
    }
    // hydra-synth.js: anything else that failed while rendering a frame.
    if (first === "Error during tick():") return `Hydra: ${describeError(second)}`;
    return null;
  }
  // hydra-synth.js logs errors thrown by `update` and `afterUpdate` bare.
  if (args.length === 1 && isError(first)) return `update: ${describeError(first)}`;
  return null;
}

/**
 * Shows each distinct runtime error once. Errors that repeat every frame stay
 * quiet until `reset()`, which a re-run calls so a still-broken sketch reports
 * again.
 */
export class ErrorReporter {
  private seen = new Set<string>();

  constructor(private readonly show: (message: string) => void, private readonly limit = 100) {}

  /** Reports `message` unless it was already reported; returns whether it was new. */
  report(message: string): boolean {
    if (this.seen.has(message)) return false;
    if (this.seen.size >= this.limit) return false;
    this.seen.add(message);
    this.show(message);
    return true;
  }

  reset(): void {
    this.seen.clear();
  }
}

/**
 * Routes Hydra's console error reports, uncaught errors and unhandled
 * rejections through `reporter`, whose status message is also what reaches
 * ao.log. A recognized console report goes on to the DevTools console once,
 * at debug level (with its stack), instead of as a warning every frame.
 */
export function installRuntimeErrorReporting(reporter: ErrorReporter, target: Window = window,
                                             log: Console = console): void {
  const debug = log.debug.bind(log);
  for (const level of ["log", "warn"] as const) {
    const original = log[level].bind(log);
    log[level] = (...args: unknown[]) => {
      const message = hydraConsoleMessage(level, args);
      if (message === null) original(...args);
      else if (reporter.report(message)) debug(...args);
    };
  }
  target.addEventListener("error", (event) => {
    // Ao logs the error itself, once; stop Chromium printing it every time.
    event.preventDefault();
    reporter.report(describeError(event.error ?? event.message));
  });
  target.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    reporter.report(describeError(event.reason));
  });
}
