import { contextBridge, ipcRenderer } from "electron";
import type { AudioFeatures } from "../shared/features";

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
  onAudio: (fn: (f: AudioFeatures) => void) => ipcRenderer.on("audio", (_e, f) => fn(f)),
  onSketchChanged: (fn: (name: string) => void) => ipcRenderer.on("sketches:changed", (_e, n) => fn(n)),
  onStatus: (fn: (message: string) => void) => ipcRenderer.on("status", (_e, m) => fn(m)),
};

export type Bridge = typeof bridge;
contextBridge.exposeInMainWorld("aoHost", bridge);
