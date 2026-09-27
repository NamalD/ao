import { appendFileSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { sketchRenamed } from "./thumbnails";

export interface StoreOptions {
  /** Once `ao.log` would grow past this many bytes it moves to `ao.log.1`. */
  logLimit?: number;
}

/** Small JSON state files and the sketch directory, rooted at the project. */
export class Store {
  readonly stateDir: string;
  readonly sketchDir: string;
  readonly logPath: string;
  private readonly logLimit: number;
  /** Bytes in `ao.log`, tracked in memory so logging needs no stat per line. */
  private logSize: number;

  constructor(root: string, { logLimit = 1024 * 1024 }: StoreOptions = {}) {
    this.stateDir = join(root, "state");
    this.sketchDir = join(root, "sketches");
    mkdirSync(this.stateDir, { recursive: true });
    mkdirSync(this.sketchDir, { recursive: true });
    this.logPath = join(this.stateDir, "ao.log");
    this.logLimit = logLimit;
    try {
      this.logSize = statSync(this.logPath).size;
    } catch {
      this.logSize = 0;
    }
  }

  read<T>(name: string, fallback: T): T {
    try {
      return { ...fallback, ...JSON.parse(readFileSync(join(this.stateDir, `${name}.json`), "utf8")) };
    } catch {
      return fallback;
    }
  }

  write(name: string, value: unknown): void {
    writeFileSync(join(this.stateDir, `${name}.json`), JSON.stringify(value, null, 2));
  }

  /** Appends a timestamped line, keeping one previous log as `ao.log.1`. */
  log(message: string): void {
    const line = `${new Date().toISOString()}  ${message.trim()}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.logSize > 0 && this.logSize + bytes > this.logLimit) {
      try {
        renameSync(this.logPath, `${this.logPath}.1`);
      } catch {
        // Already moved or deleted from outside: just start a fresh file.
      }
      this.logSize = 0;
    }
    appendFileSync(this.logPath, line);
    this.logSize += bytes;
  }

  listSketches(): string[] {
    return readdirSync(this.sketchDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => basename(f, ".js"))
      .sort();
  }

  sketchPath(name: string): string {
    if (!/^[\w-]+$/.test(name)) throw new Error(`invalid sketch name: ${name}`);
    return join(this.sketchDir, `${name}.js`);
  }

  readSketch(name: string): string {
    return readFileSync(this.sketchPath(name), "utf8");
  }

  writeSketch(name: string, code: string): void {
    writeFileSync(this.sketchPath(name), code);
  }

  /**
   * Saves `code` as `to` and removes `from`, for `:w name`. `to` may end in
   * `.js`. The new file appears whole, and unless `overwrite` is set an
   * existing sketch is never replaced, even one created a moment ago.
   * Returns the new name.
   */
  renameSketch(from: string, to: string, code: string, overwrite = false): string {
    const name = to.replace(/\.js$/, "");
    const source = this.sketchPath(from);
    const target = this.sketchPath(name);
    if (name === from) {
      this.writeSketch(name, code);
      return name;
    }
    // Written beside the target, then moved or linked into place in one step.
    const temp = join(this.sketchDir, `.${name}.${process.pid}.tmp`);
    writeFileSync(temp, code);
    try {
      if (overwrite) renameSync(temp, target);
      else linkSync(temp, target); // fails with EEXIST rather than replacing
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${name} already exists; :w! ${name} replaces it`);
      throw error;
    } finally {
      try { unlinkSync(temp); } catch { /* already moved into place */ }
    }
    try {
      unlinkSync(source);
    } catch (error) {
      // An unsaved sketch whose file is already gone just gains its new name.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // The thumbnail and recent-list entry follow; failing that never undoes the rename.
    try { sketchRenamed(this, from, name); } catch (error) { this.log(`thumbnail rename failed: ${String(error)}`); }
    return name;
  }
}
