import { contextBridge, ipcRenderer } from "electron";
import type { ChallengeRecord, ChallengeResult } from "../shared/challenges";
import type { AudioFeatures } from "../shared/features";
import type { Settings } from "../shared/settings";
import type { RecordingCommand, RecordingResult, RecordingStart } from "../shared/recording";

/** The only bridge between the renderer and the machine. */
const bridge = {
  listSketches: (): Promise<string[]> => ipcRenderer.invoke("sketches:list"),
  readSketch: (name: string): Promise<string> => ipcRenderer.invoke("sketches:read", name),
  writeSketch: (name: string, code: string): Promise<void> => ipcRenderer.invoke("sketches:write", name, code),
  renameSketch: (from: string, to: string, code: string, overwrite: boolean): Promise<string> =>
    ipcRenderer.invoke("sketches:rename", from, to, code, overwrite),
  lastSketch: (): Promise<string> => ipcRenderer.invoke("state:last-sketch"),
  setLastSketch: (name: string) => ipcRenderer.send("state:set-last-sketch", name),
  toggleFullscreen: () => ipcRenderer.send("window:fullscreen"),
  quit: () => ipcRenderer.send("app:quit"),
  log: (message: string) => ipcRenderer.send("log", message),
  settings: (): Promise<Settings> => ipcRenderer.invoke("settings:read"),
  updateSettings: (patch: { meter?: boolean; night?: Partial<Settings["night"]> }) => ipcRenderer.send("settings:update", patch),
  finishChallenge: (result: ChallengeResult): Promise<ChallengeRecord> => ipcRenderer.invoke("challenge:finish", result),
  onAudio: (fn: (f: AudioFeatures) => void) => ipcRenderer.on("audio", (_e, f) => fn(f)),
  onSketchChanged: (fn: (name: string) => void) => ipcRenderer.on("sketches:changed", (_e, n) => fn(n)),
  onStatus: (fn: (message: string) => void) => ipcRenderer.on("status", (_e, m) => fn(m)),
  // The main process picks the file; the renderer only streams encoded chunks.
  recording: {
    start: (sketch: string): Promise<RecordingStart> => ipcRenderer.invoke("recording:start", sketch),
    chunk: (id: number, data: ArrayBuffer): Promise<void> => ipcRenderer.invoke("recording:chunk", id, data),
    stop: (id: number, durationMs: number): Promise<RecordingResult> => ipcRenderer.invoke("recording:stop", id, durationMs),
    onCommand: (fn: (command: RecordingCommand) => void) => ipcRenderer.on("recording:command", (_e, c) => fn(c)),
  },
};

export type Bridge = typeof bridge;

// The recording's PCM port goes to the page, which hands it to its
// AudioWorklet. contextBridge can't carry MessagePorts, so this uses
// Electron's documented window.postMessage route.
ipcRenderer.on("recording:pcm-port", (e, id: number) => window.postMessage({ aoRecordingPcm: id }, "*", e.ports));
contextBridge.exposeInMainWorld("aoHost", bridge);
