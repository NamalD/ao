import type { Bridge } from "../preload/preload";
import { formatElapsed, pickMimeType } from "../shared/recording";
import workletUrl from "./recorder-worklet.ts?worker&url";

/** Encoded chunks go to the main process this often, so memory stays flat. */
const TIMESLICE_MS = 1000;

interface Active {
  id: number;
  recorder: MediaRecorder;
  stream: MediaStream;
  audio: AudioContext | null;
  started: number;
  /** Chunk writes in order; stopping waits for the last one. */
  written: Promise<void>;
  failed: string | null;
}

/**
 * Records the canvas plus the system audio to WebM with one MediaRecorder.
 *
 * Only the canvas is captured, so the editor, status bar and this indicator
 * never appear in the video. The audio is the main process's parec capture,
 * forwarded as PCM while recording and played into a
 * MediaStreamAudioDestinationNode by an AudioWorklet jitter buffer; it never
 * reaches the speakers.
 */
export class Recorder {
  private active: Active | null = null;
  private busy = false;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private clearTimer: ReturnType<typeof setTimeout> | undefined;
  /** The main process's PCM port for recording `id`, until the worklet takes it. */
  private pcmPort: { id: number; port: MessagePort } | null = null;
  readonly indicator = document.createElement("span");

  constructor(private host: Bridge, private canvas: HTMLCanvasElement, private sketch: () => string) {
    this.indicator.id = "recording";
    addEventListener("message", (e) => {
      const id = (e.data as { aoRecordingPcm?: unknown } | null)?.aoRecordingPcm;
      if (e.source !== window || typeof id !== "number" || !e.ports[0]) return;
      this.pcmPort?.port.close();
      this.pcmPort = { id, port: e.ports[0] };
    });
    host.recording.onCommand((command) => {
      if (command === "start" && !this.active) void this.toggle();
      else if (command === "stop" && this.active) void this.toggle();
    });
  }

  /** True from the moment a recording starts until it has stopped: the canvas is being captured. */
  get capturing(): boolean {
    return this.busy || this.active !== null;
  }

  async toggle(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.active) await this.stop();
      else await this.start();
    } catch (e) {
      this.show(`recording failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      this.host.log(`recording failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      this.busy = false;
    }
  }

  private async start(): Promise<void> {
    const { id, path, audio: audioAvailable, stopAfter } = await this.host.recording.start(this.sketch());
    const stream = this.canvas.captureStream(60);
    let audio: AudioContext | null = null;
    let note = audioAvailable ? "" : "no audio capture";
    if (audioAvailable) {
      try {
        audio = await this.audioGraph(stream, id);
      } catch (e) {
        note = "audio unavailable";
        this.host.log(`recording audio failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t), audio !== null);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      // Shader visuals are noisy; the default ~2.5 Mbit/s smears them.
      videoBitsPerSecond: 16_000_000,
      audioBitsPerSecond: 192_000,
    });
    const active: Active = { id, recorder, stream, audio, started: performance.now(), written: Promise.resolve(), failed: null };
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      active.written = active.written.then(async () => {
        if (active.failed) return;
        try {
          await this.host.recording.chunk(id, await e.data.arrayBuffer());
        } catch (err) {
          active.failed = err instanceof Error ? err.message : String(err);
          if (this.active === active) void this.toggle();
        }
      });
    };
    recorder.start(TIMESLICE_MS);
    this.active = active;
    if (stopAfter) setTimeout(() => { if (this.active === active) void this.toggle(); }, stopAfter * 1000);
    this.host.log(`recording ${path} as ${recorder.mimeType}${note ? ` (video only: ${note})` : ""}`);
    clearTimeout(this.clearTimer);
    const tick = () => this.show(`● REC ${formatElapsed(performance.now() - active.started)}${note ? ` · video only (${note})` : ""}`, "live");
    tick();
    this.ticker = setInterval(tick, 500);
  }

  /** Adds the forwarded capture to `stream` as an audio track. */
  private async audioGraph(stream: MediaStream, id: number): Promise<AudioContext> {
    // Match parec's rate so the worklet needs no resampling.
    const context = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
    try {
      await context.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(context, "ao-pcm", { numberOfInputs: 0, outputChannelCount: [2] });
      const destination = context.createMediaStreamDestination();
      node.connect(destination);
      await context.resume();
      // The port may still be in flight; it's sent alongside the start reply.
      const port = await this.takePort(id);
      // PCM goes to the audio thread directly, never through this thread.
      node.port.postMessage({ port }, [port]);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      return context;
    } catch (e) {
      void context.close();
      throw e;
    }
  }

  private async takePort(id: number, timeout = 2000): Promise<MessagePort> {
    for (const until = performance.now() + timeout; performance.now() < until;) {
      const pending = this.pcmPort;
      if (pending?.id === id) {
        this.pcmPort = null;
        return pending.port;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("no audio port from the main process");
  }

  private async stop(): Promise<void> {
    const active = this.active!;
    clearInterval(this.ticker);
    const durationMs = performance.now() - active.started;
    const stopped = new Promise<void>((resolve) => { active.recorder.onstop = () => resolve(); });
    // The last dataavailable fires before stop.
    if (active.recorder.state !== "inactive") active.recorder.stop();
    await stopped;
    await active.written;
    this.active = null;
    for (const track of active.stream.getTracks()) track.stop();
    void active.audio?.close();
    const { path, bytes } = await this.host.recording.stop(active.id, durationMs);
    const size = `${(bytes / 1e6).toFixed(1)} MB`;
    if (active.failed) this.show(`recording stopped: ${active.failed}; kept ${path} (${size})`, "error");
    else this.show(`saved ${path} (${size})`, "saved");
    this.clearTimer = setTimeout(() => this.show("", ""), 10_000);
  }

  private show(text: string, state: "live" | "saved" | "error" | "") {
    this.indicator.textContent = text;
    this.indicator.title = text;
    this.indicator.className = state;
  }
}
