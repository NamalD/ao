/**
 * Pure helpers for recording the visuals and the system audio to WebM.
 * No Node or DOM imports, so they stay unit-testable.
 */

/** What `recording:start` returns to the renderer. */
export interface RecordingStart {
  id: number;
  path: string;
  /** False when capture isn't delivering audio: record video only. */
  audio: boolean;
  /** Set by `--record-seconds`: stop after this many seconds. */
  stopAfter?: number;
}
export interface RecordingResult { path: string; bytes: number }
/** Sent by the main process: `--record-seconds`, and finishing on quit. */
export type RecordingCommand = "start" | "stop";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** A sketch name reduced to characters that are safe in any file name. */
export function safeSketchName(sketch: string): string {
  const name = sketch.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return name || "untitled";
}

/**
 * `ao-YYYYMMDD-HHMMSS-<sketch>.webm` in local time. A non-zero `attempt`
 * adds `-2`, `-3`, ... for recordings started within the same second.
 */
export function recordingFileName(sketch: string, date: Date, attempt = 0): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const suffix = attempt > 0 ? `-${attempt + 1}` : "";
  return `ao-${day}-${time}-${safeSketchName(sketch)}${suffix}.webm`;
}

/** The best WebM type MediaRecorder supports, preferring VP9 and Opus. */
export function pickMimeType(isSupported: (type: string) => boolean, audio: boolean): string {
  const candidates = audio
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find(isSupported) ?? "";
}

/** `m:ss`, or `h:mm:ss` past an hour, for the recording indicator. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** `--record-seconds=N`: record N seconds once the sketch is up, then quit. */
export function recordSecondsOption(argv: string[]): number | undefined {
  const raw = argv.find((a) => a.startsWith("--record-seconds="))?.split("=")[1];
  const seconds = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
