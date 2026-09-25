import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** Small JSON state files and the sketch directory, rooted at the project. */
export class Store {
  readonly stateDir: string;
  readonly sketchDir: string;

  constructor(root: string) {
    this.stateDir = join(root, "state");
    this.sketchDir = join(root, "sketches");
    mkdirSync(this.stateDir, { recursive: true });
    mkdirSync(this.sketchDir, { recursive: true });
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

  log(message: string): void {
    appendFileSync(join(this.stateDir, "ao.log"), `${new Date().toISOString()}  ${message.trim()}\n`);
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
