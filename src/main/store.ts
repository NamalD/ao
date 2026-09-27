import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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
}
