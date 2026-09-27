import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isSketchName, noteRecent, renameRecent } from "../shared/sketch-library";

/**
 * Sketch thumbnails in state/thumbnails/<name>.png, and the recently opened
 * list in state/recent.json, for the sketch browser. Only file operations
 * here, so they are tested against a temporary directory.
 */

/** A thumbnail is small; anything bigger than this is not one. */
const MAX_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RECENT = "recent";

export const thumbnailDir = (stateDir: string) => join(stateDir, "thumbnails");

/** state/thumbnails/<name>.png, refusing any name that isn't a sketch name. */
export function thumbnailPath(stateDir: string, name: string): string {
  if (!isSketchName(name)) throw new Error(`invalid sketch name: ${name}`);
  return join(thumbnailDir(stateDir), `${name}.png`);
}

export const isPng = (bytes: Uint8Array) => bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);

/** The thumbnail's bytes, or null if it has none (or the name is invalid). */
export function readThumbnail(stateDir: string, name: unknown): Buffer | null {
  if (!isSketchName(name)) return null;
  try {
    return readFileSync(thumbnailPath(stateDir, name));
  } catch {
    return null;
  }
}

/** Writes a thumbnail whole (temp file, then rename), after checking it is a small PNG. */
export function writeThumbnail(stateDir: string, name: unknown, png: unknown): void {
  if (!isSketchName(name)) throw new Error(`invalid sketch name: ${String(name)}`);
  const bytes = png instanceof Uint8Array ? png : png instanceof ArrayBuffer ? new Uint8Array(png) : null;
  if (!bytes || !isPng(bytes)) throw new Error("thumbnail is not a PNG");
  if (bytes.length > MAX_BYTES) throw new Error("thumbnail is too large");
  const path = thumbnailPath(stateDir, name);
  mkdirSync(thumbnailDir(stateDir), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, path);
}

/** Names that have a thumbnail. */
export function listThumbnails(stateDir: string): string[] {
  try {
    return readdirSync(thumbnailDir(stateDir))
      .filter((f) => f.endsWith(".png"))
      .map((f) => basename(f, ".png"))
      .filter(isSketchName)
      .sort();
  } catch {
    return [];
  }
}

export function deleteThumbnail(stateDir: string, name: string): void {
  try {
    unlinkSync(thumbnailPath(stateDir, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * After `from` is renamed to `to`: its thumbnail moves along, and a thumbnail
 * `to` had before (a replaced sketch) goes, since it shows other code.
 */
export function moveThumbnail(stateDir: string, from: string, to: string): void {
  if (from === to) return;
  try {
    renameSync(thumbnailPath(stateDir, from), thumbnailPath(stateDir, to));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    deleteThumbnail(stateDir, to);
  }
}

interface JsonState {
  read<T>(name: string, fallback: T): T;
  write(name: string, value: unknown): void;
}

/** Recently opened sketches, most recent first. */
export function readRecent(store: JsonState): string[] {
  const { sketches } = store.read<{ sketches: unknown }>(RECENT, { sketches: [] });
  return Array.isArray(sketches) ? sketches.filter(isSketchName) : [];
}

export function recordOpened(store: JsonState, name: unknown): void {
  if (isSketchName(name)) store.write(RECENT, { sketches: noteRecent(readRecent(store), name) });
}

/** Keeps a renamed sketch's thumbnail and place in the recent list. */
export function sketchRenamed(store: JsonState & { stateDir: string }, from: string, to: string): void {
  if (from === to) return;
  moveThumbnail(store.stateDir, from, to);
  store.write(RECENT, { sketches: renameRecent(readRecent(store), from, to) });
}
