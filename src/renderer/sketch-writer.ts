/**
 * Serializes sketch writes and skips redundant ones. Writes land in the order
 * they were requested; saving content that is already on disk, or already
 * queued for it, doesn't write again, so opening a sketch or reloading an
 * external edit costs no disk write and no file-watcher round trip.
 */
export class SketchWriter {
  private pending: Promise<unknown> = Promise.resolve();
  private last = { name: "", code: "", done: Promise.resolve() };

  constructor(private readonly write: (name: string, code: string) => Promise<void>) {}

  /** Records that the disk holds `code` for `name`, e.g. after reading it. */
  known(name: string, code: string): void {
    this.last = { name, code, done: Promise.resolve() };
  }

  /** Forgets what is on disk, e.g. after the file was deleted, so the next save writes. */
  forget(): void {
    this.last = { name: "", code: "", done: Promise.resolve() };
  }

  /**
   * Resolves once `code` is on disk for `name`; rejects if its write failed.
   * Returns without writing when that content is already written or queued.
   */
  save(name: string, code: string): Promise<void> {
    if (this.last.name === name && this.last.code === code) return this.last.done;
    const done = this.pending.then(() => this.write(name, code));
    const entry = { name, code, done };
    this.last = entry;
    this.pending = done.catch(() => {
      // A failed write isn't on disk: let the next save of this content retry.
      if (this.last === entry) this.forget();
    });
    return done;
  }
}
