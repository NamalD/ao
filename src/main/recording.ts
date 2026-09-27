import { app, BrowserWindow, ipcMain, MessageChannelMain, MessagePortMain } from "electron";
import { mkdirSync, accessSync, constants } from "node:fs";
import { open, FileHandle } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { RecordingResult, RecordingStart, recordingFileName, recordSecondsOption } from "../shared/recording";
import { DurationSlot, encodeDuration, reserveDuration } from "../shared/webm";

/**
 * Records the canvas and the system audio to WebM.
 *
 * The renderer runs one MediaRecorder over `canvas.captureStream()` plus an
 * audio track fed from the PCM forwarded here. It streams the encoded chunks
 * back every second, and this side appends them to the file as they arrive,
 * so a long recording never sits in memory and a crash loses at most the
 * last second.
 *
 * PCM is only forwarded while a recording with audio is running, over a
 * MessagePort that the renderer hands straight to its AudioWorklet: the audio
 * thread receives it directly, so a heavy sketch stalling the renderer's main
 * thread can't starve the recording's audio.
 */

/** `~/Videos/Ao`, falling back to `~/Videos` and then the temp directory. */
function recordingDir(): string {
  const candidates: string[] = [];
  try { candidates.push(join(app.getPath("videos"), "Ao")); } catch { /* no videos dir */ }
  candidates.push(join(homedir(), "Videos", "Ao"), join(tmpdir(), "Ao"));
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      return dir;
    } catch {
      // Try the next one.
    }
  }
  throw new Error(`no writable folder for recordings (tried ${candidates.join(", ")})`);
}

/** Enough of the stream to hold the WebM header (EBML, Info and Tracks). */
const HEADER_BYTES = 4096;

class Session {
  bytes = 0;
  private written: Promise<void> = Promise.resolve();
  private slot: DurationSlot | null = null;
  /** Chunks held until the header is complete; null once it is written. */
  private head: Uint8Array[] | null = [];
  private headBytes = 0;
  private closed = false;
  /** Carries PCM to the renderer's AudioWorklet; null for video only. */
  pcm: MessagePortMain | null = null;

  constructor(readonly id: number, readonly path: string, private file: FileHandle) {}

  /** Appends one encoded chunk; writes are strictly ordered. */
  write(data: Uint8Array): Promise<void> {
    this.written = this.written.then(async () => {
      if (this.closed) return;
      if (!this.head) return this.append(data);
      // The first blobs can be tiny (even a single byte), so gather the header.
      this.head.push(data.slice());
      this.headBytes += data.length;
      if (this.headBytes >= HEADER_BYTES) await this.flushHead();
    });
    return this.written;
  }

  /** MediaRecorder's WebM has no duration; leave room to write it at stop. */
  private async flushHead(): Promise<void> {
    if (!this.head) return;
    const chunk = Buffer.concat(this.head);
    this.head = null;
    const reserved = reserveDuration(chunk);
    if (reserved) this.slot = reserved.slot;
    await this.append(reserved?.bytes ?? chunk);
  }

  private async append(bytes: Uint8Array): Promise<void> {
    await this.file.write(bytes, 0, bytes.length, this.bytes);
    this.bytes += bytes.length;
  }

  async close(durationMs?: number): Promise<void> {
    await this.written.catch(() => {});
    if (this.closed) return;
    this.closed = true;
    this.pcm?.close();
    this.pcm = null;
    try {
      await this.flushHead();
      if (this.slot && durationMs && durationMs > 0) {
        const value = encodeDuration(durationMs, this.slot);
        await this.file.write(value, 0, value.length, this.slot.offset);
      }
    } finally {
      await this.file.close();
    }
  }
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError("recording chunk must be binary");
}

export interface Recording {
  /** Hand every captured PCM chunk here; forwarded only while recording. */
  pcm(samples: Float32Array): void;
}

/**
 * Registers the recording IPC and the finalize-on-quit handling. Call once,
 * after the window exists.
 */
export function setupRecording(win: () => BrowserWindow | null, log: (message: string) => void,
                               recordSeconds = recordSecondsOption(process.argv)): Recording {
  let nextId = 1;
  let active: Session | null = null;
  let pcmSeen = false;
  let finishing: Promise<void> | null = null;
  const stopped: Array<() => void> = [];

  const send = (channel: string, ...args: unknown[]) => {
    const w = win();
    if (w && !w.isDestroyed()) w.webContents.send(channel, ...args);
  };

  async function finish(session: Session, durationMs?: number): Promise<RecordingResult> {
    if (active === session) active = null;
    await session.close(durationMs);
    const seconds = durationMs ? `, ${(durationMs / 1000).toFixed(1)} s` : "";
    log(`recorded ${session.path} (${(session.bytes / 1e6).toFixed(1)} MB${seconds})`);
    stopped.splice(0).forEach((resolve) => resolve());
    return { path: session.path, bytes: session.bytes };
  }

  ipcMain.handle("recording:start", async (_e, sketch: string): Promise<RecordingStart> => {
    // A reloaded renderer can't stop its old recording; keep what it wrote.
    if (active) await finish(active);
    const dir = recordingDir();
    const now = new Date();
    for (let attempt = 0; ; attempt++) {
      const path = join(dir, recordingFileName(String(sketch ?? ""), now, attempt));
      try {
        const file = await open(path, "wx");
        active = new Session(nextId++, path, file);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST" || attempt > 50) throw e;
      }
    }
    // PCM arriving means capture works; otherwise record the visuals alone.
    const audio = pcmSeen;
    if (audio) {
      const { port1, port2 } = new MessageChannelMain();
      active.pcm = port1;
      win()?.webContents.postMessage("recording:pcm-port", active.id, [port2]);
    }
    log(`recording ${active.path}${audio ? "" : " (video only: no audio capture)"}`);
    return { id: active.id, path: active.path, audio, stopAfter: recordSeconds };
  });

  ipcMain.handle("recording:chunk", (_e, id: number, data: unknown) => {
    if (!active || active.id !== id) throw new Error("no such recording");
    return active.write(toBytes(data));
  });

  ipcMain.handle("recording:stop", async (_e, id: number, durationMs: number) => {
    if (!active || active.id !== id) throw new Error("no such recording");
    const result = await finish(active, Number(durationMs) || undefined);
    if (recordSeconds) app.quit();
    return result;
  });

  /** Asks the renderer to stop and waits for the file, at most `timeout` ms. */
  function finalize(timeout = 5000): Promise<void> {
    if (!active) return Promise.resolve();
    finishing ??= new Promise<void>((resolve) => {
      const session = active!;
      const timer = setTimeout(() => {
        log(`recording: renderer did not finish in time; closing ${session.path} as is`);
        void finish(session).then(() => resolve());
      }, timeout);
      stopped.push(() => { clearTimeout(timer); resolve(); });
      send("recording:command", "stop");
    }).finally(() => { finishing = null; });
    return finishing;
  }

  // Quitting (Ctrl+Q, q, the window's close button) finishes the file first.
  app.on("before-quit", (event) => {
    if (!active) return;
    event.preventDefault();
    void finalize().then(() => app.quit());
  });
  const w = win();
  w?.on("close", (event) => {
    if (!active) return;
    event.preventDefault();
    void finalize().then(() => { if (!w.isDestroyed()) w.close(); });
  });
  if (recordSeconds) {
    w?.webContents.once("did-finish-load", () =>
      setTimeout(() => send("recording:command", "start"), 1500));
  }

  return {
    pcm(samples) {
      pcmSeen = true;
      active?.pcm?.postMessage(samples);
    },
  };
}
