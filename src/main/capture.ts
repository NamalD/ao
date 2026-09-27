import { ChildProcess, execFileSync, spawn } from "node:child_process";
import { Analyser } from "../shared/analysis";
import { findExecutable } from "../shared/executable";
import { TempoTracker } from "../shared/tempo";
import { AudioFeatures } from "../shared/features";

export const SAMPLE_RATE = 48000;

/**
 * Uses PipeWire's PulseAudio compatibility tools: unlike `pw-record`, parec
 * understands `.monitor` source names and cannot silently fall back to the
 * microphone.
 */
export function parecCommand(target: string, executable: string): [string, string[]] {
  return [executable, ["--device", target, "--format=float32le", `--rate=${SAMPLE_RATE}`,
    "--channels=2", "--raw", "--latency-msec=20"]];
}

function defaultMonitor(pactl: string): string | null {
  try {
    const sink = execFileSync(pactl, ["get-default-sink"], { encoding: "utf8" }).trim();
    return sink ? `${sink}.monitor` : null;
  } catch {
    return null;
  }
}

export interface Capture { stop(): void }

/** Captures the current output device and reports features for every chunk. */
export function startCapture(onFeatures: (f: AudioFeatures) => void,
                             report: (message: string) => void,
                             onPcm?: (samples: Float32Array) => void): Capture {
  const parec = findExecutable("parec");
  const pactl = findExecutable("pactl");
  if (!parec || !pactl) {
    report("parec/pactl are not installed or not on PATH; audio is disabled");
    return { stop() {} };
  }
  const target = defaultMonitor(pactl);
  if (!target) {
    report("could not determine the default PipeWire monitor; audio is disabled");
    return { stop() {} };
  }
  const analyser = new Analyser(SAMPLE_RATE);
  const tempo = new TempoTracker(SAMPLE_RATE);
  const started = performance.now();
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
    onFeatures({ ...analyser.push(samples, (performance.now() - started) / 1000), tempo: tempo.push(samples) });
    onPcm?.(samples);
  });
  child.stderr!.on("data", (d: Buffer) => report(`parec: ${d.toString().trim()}`));
  child.on("error", (e) => report(`capture failed: ${e.message}`));
  child.on("exit", (code, signal) => {
    if (signal !== "SIGTERM") report(`capture stopped (code ${code}, signal ${signal})`);
  });
  report(`capturing ${target}`);
  return { stop: () => child.kill("SIGTERM") };
}

/** A synthetic kick, pad and panned hats signal for screenshots and silent development. */
export function startFakeCapture(onFeatures: (f: AudioFeatures) => void,
                                 onPcm?: (samples: Float32Array) => void): Capture {
  const analyser = new Analyser(SAMPLE_RATE);
  const tempo = new TempoTracker(SAMPLE_RATE);
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
    for (let i = 0; i < frames; i++, n++) {
      const t = n / SAMPLE_RATE;
      const beatPhase = t % 0.5;
      const kick = Math.exp(-beatPhase * 18) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-beatPhase * 30)) * beatPhase);
      const low = 0.12 * Math.sin(2 * Math.PI * 220 * t);
      const high = 0.12 * Math.sin(2 * Math.PI * 330 * t + Math.sin(t));
      const hat = (t % 0.25 < 0.02 ? 0.08 : 0) * (Math.random() * 2 - 1);
      // Kick and low pad stay centred; the upper pad voice drifts across
      // the speakers every 8 s and the hats ping-pong, so balance and width
      // have something to show.
      const pan = 0.8 * Math.sin((2 * Math.PI * t) / 8);
      const right = Math.floor(t / 0.25) % 2 === 1;
      const centre = 0.6 * kick + low;
      samples[i * 2] = centre + (1 - pan) * high + (right ? 0.2 : 1) * hat;
      samples[i * 2 + 1] = centre + (1 + pan) * high + (right ? 1 : 0.2) * hat;
    }
    onFeatures({ ...analyser.push(samples, n / SAMPLE_RATE), tempo: tempo.push(samples) });
    onPcm?.(samples);
  }, (chunk / SAMPLE_RATE) * 1000);
  return { stop: () => clearInterval(timer) };
}
