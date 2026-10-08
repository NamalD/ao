import { ChildProcess, execFileSync, spawn } from "node:child_process";
import { findExecutable } from "../shared/executable";
import { AudioFeatures } from "../shared/features";
import type { SectionEvent } from "../shared/sections";
import { Engine, Synthetic, parecCommand } from "./listen";

export const SAMPLE_RATE = 48000;
export { parecCommand };

export interface Capture {
  stop(): void;
  /** Autopilot turned on: its detector relearns the music from here. */
  resetSections(): void;
}

export type FeaturesHandler = (features: AudioFeatures, event: SectionEvent | null) => void;

function defaultMonitor(pactl: string): string | null {
  try {
    const sink = execFileSync(pactl, ["get-default-sink"], { encoding: "utf8" }).trim();
    return sink ? `${sink}.monitor` : null;
  } catch {
    return null;
  }
}

function deliver(engine: Engine, samples: Float32Array, onFeatures: FeaturesHandler, onPcm?: (samples: Float32Array) => void): void {
  engine.push(samples);
  onFeatures(engine.features(), engine.takeSection());
  onPcm?.(samples);
}

/** Captures the current output device and reports features for every chunk. */
export function startCapture(onFeatures: FeaturesHandler,
                             report: (message: string) => void,
                             onPcm?: (samples: Float32Array) => void): Capture {
  const parec = findExecutable("parec");
  const pactl = findExecutable("pactl");
  if (!parec || !pactl) {
    report("parec/pactl are not installed or not on PATH; audio is disabled");
    return { stop() {}, resetSections() {} };
  }
  const target = defaultMonitor(pactl);
  if (!target) {
    report("could not determine the default PipeWire monitor; audio is disabled");
    return { stop() {}, resetSections() {} };
  }
  const engine = new Engine(SAMPLE_RATE);
  let pending: Buffer = Buffer.alloc(0);
  const [command, args] = parecCommand(target, parec);
  const child: ChildProcess = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const usable = pending.length - (pending.length % 8);
    if (usable === 0) return;
    // Copy so the float view is aligned regardless of the chunk's offset.
    const samples = new Float32Array(new Uint8Array(pending.subarray(0, usable)).buffer);
    pending = pending.subarray(usable);
    deliver(engine, samples, onFeatures, onPcm);
  });
  child.stderr!.on("data", (d: Buffer) => report(`parec: ${d.toString().trim()}`));
  child.on("error", (e) => report(`capture failed: ${e.message}`));
  child.on("exit", (code, signal) => {
    if (signal !== "SIGTERM") report(`capture stopped (code ${code}, signal ${signal})`);
  });
  report(`capturing ${target}`);
  return { stop: () => child.kill("SIGTERM"), resetSections: () => engine.resetSections() };
}

/** A synthetic kick, pad and panned hats signal for screenshots and silent development. */
export function startFakeCapture(onFeatures: FeaturesHandler,
                                 onPcm?: (samples: Float32Array) => void): Capture {
  const engine = new Engine(SAMPLE_RATE);
  const synthetic = new Synthetic(SAMPLE_RATE);
  const chunk = 960;
  const started = performance.now();
  let n = 0;
  const timer = setInterval(() => {
    // Timers run late; generate by elapsed time so the signal keeps real-time
    // pace, as a recording of it needs.
    const due = Math.floor(((performance.now() - started) / 1000) * SAMPLE_RATE) - n;
    if (due <= 0) return;
    const frames = Math.min(due, SAMPLE_RATE);
    const samples = new Float32Array(frames * 2);
    synthetic.fill(samples);
    n += frames;
    deliver(engine, samples, onFeatures, onPcm);
  }, (chunk / SAMPLE_RATE) * 1000);
  return { stop: () => clearInterval(timer), resetSections: () => engine.resetSections() };
}
