import { coverRect, isBlankFrame, THUMB_HEIGHT, THUMB_WIDTH } from "../../shared/sketch-library";

export interface ThumbnailCaptureHost {
  /** The sketch on screen now, or "" before the first one opens. */
  current(): string;
  /** Hands the PNG to the main process, which writes state/thumbnails/<name>.png. */
  save(name: string, png: ArrayBuffer): void;
  /** Told after a capture is sent, so the browser can refresh that card. */
  saved?(name: string): void;
}

export interface ThumbnailCaptureOptions {
  /** A sketch must have been on screen this long before its first capture. */
  firstMs?: number;
  /** Then it is captured again this often, to follow edits. */
  everyMs?: number;
}

/**
 * Live thumbnails: once a sketch has been on screen for a few seconds, and
 * then every minute while it stays, a 320×180 frame of the #stage canvas is
 * encoded as PNG and sent to the main process.
 *
 * Only the canvas is read, so the editor, status bar, cards, meter and night
 * layer (all DOM on top of it) can never appear, and capturing needs nothing
 * hidden. Hydra's WebGL canvas has no preserveDrawingBuffer, so its pixels
 * are only readable in the frame they were drawn: the copy runs in a
 * requestAnimationFrame callback queued from a timer, which runs after the
 * render loop's own callback for that frame, before the frame is presented.
 * An all-black frame (a failed run, or a buffer read too late) is never saved.
 * The cost is one small drawImage and PNG encode a minute.
 */
export class ThumbnailCapture {
  private readonly small = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly firstMs: number;
  private readonly everyMs: number;
  private name = "";
  private since = 0;
  private last = 0;
  private busy = false;

  constructor(private readonly stage: HTMLCanvasElement, private readonly host: ThumbnailCaptureHost, options: ThumbnailCaptureOptions = {}) {
    this.firstMs = options.firstMs ?? 4000;
    this.everyMs = options.everyMs ?? 60_000;
    this.small.width = THUMB_WIDTH;
    this.small.height = THUMB_HEIGHT;
    this.context = this.small.getContext("2d", { willReadFrequently: true })!;
    setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    const name = this.host.current();
    const now = performance.now();
    if (name !== this.name) {
      this.name = name;
      this.since = now;
      this.last = 0;
    }
    if (!name || this.busy || document.hidden) return;
    const due = this.last ? now - this.last >= this.everyMs : now - this.since >= this.firstMs;
    if (due) void this.capture(name);
  }

  /** Captures the stage now (in the next frame) for `name`; true if a PNG was sent. */
  async capture(name = this.host.current()): Promise<boolean> {
    if (!name || this.busy) return false;
    this.busy = true;
    try {
      const blob = await new Promise<Blob | null>((resolve) => requestAnimationFrame(() => {
        const { width, height } = this.stage;
        if (!width || !height) return resolve(null);
        const r = coverRect(width, height);
        this.context.clearRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        this.context.drawImage(this.stage, r.x, r.y, r.width, r.height, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
        if (isBlankFrame(this.context.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT).data)) return resolve(null);
        this.small.toBlob(resolve, "image/png");
      }));
      // A blank frame retries soon rather than waiting a whole period.
      this.last = performance.now() - (blob ? 0 : this.everyMs - this.firstMs);
      // The sketch may have changed while the PNG was encoding.
      if (!blob || this.host.current() !== name) return false;
      this.host.save(name, await blob.arrayBuffer());
      this.host.saved?.(name);
      return true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }
}
