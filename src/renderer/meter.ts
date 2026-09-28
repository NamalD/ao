import type { AudioFeatures } from "../shared/features";
import { peakPosition, centroidPosition } from "../shared/spectrum";
import { ao } from "./audio";

const LEVELS = ["loudness", "impulse", "beat", "bass", "mid", "high", "energy", "drop"] as const;

// Layout in CSS pixels.
const WIDTH = 264, PAD = 10, ROW = 14, LABEL = 76, VALUE = 30;
const SPECTRUM_TOP = PAD + LEVELS.length * ROW + 8, SPECTRUM_HEIGHT = 44;
const LEGEND = SPECTRUM_TOP + SPECTRUM_HEIGHT + 12;
const HEIGHT = LEGEND + PAD - 2;

/**
 * A small HUD showing the `ao` levels and spectrum, so mappings can be seen
 * rather than guessed. It is DOM over the stage, so it never reaches the
 * rendered visuals, and while hidden it schedules no frames at all.
 */
export class Meter {
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly accent: string;
  private readonly ink: string;
  private readonly centroidColour = "#d7c7ff";
  private frame = 0;
  private drawn: AudioFeatures | undefined;

  constructor(parent: HTMLElement) {
    this.canvas.id = "meter";
    this.canvas.hidden = true;
    this.canvas.style.width = `${WIDTH}px`;
    this.canvas.style.height = `${HEIGHT}px`;
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    const style = getComputedStyle(document.documentElement);
    this.accent = style.getPropertyValue("--accent").trim() || "#8fd8ff";
    this.ink = style.getPropertyValue("--ink").trim() || "#f2f2f7";
  }

  get visible(): boolean {
    return !this.canvas.hidden;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.canvas.hidden = !visible;
    cancelAnimationFrame(this.frame);
    if (!visible) return;
    // The window may have moved to a screen with another pixel ratio.
    const dpr = devicePixelRatio || 1;
    this.canvas.width = Math.round(WIDTH * dpr);
    this.canvas.height = Math.round(HEIGHT * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawn = undefined;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = () => {
    this.frame = requestAnimationFrame(this.tick);
    // Features arrive from the main process; redraw only when they change.
    if (ao.features === this.drawn) return;
    this.drawn = ao.features;
    this.draw(ao.features);
  };

  private draw(f: AudioFeatures): void {
    const { ctx, accent, ink } = this;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.font = `10px "JetBrains Mono", monospace`;
    ctx.textBaseline = "middle";
    const barX = PAD + LABEL, barW = WIDTH - PAD - VALUE - barX;

    LEVELS.forEach((name, i) => {
      const y = PAD + i * ROW + ROW / 2, level = clamp01(f[name] ?? 0);
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.75;
      ctx.fillText(`ao.${name}`, PAD, y);
      ctx.globalAlpha = 0.7;
      ctx.fillText(level.toFixed(2), WIDTH - PAD - VALUE + 6, y);
      ctx.globalAlpha = 0.1;
      ctx.fillRect(barX, y - 3, barW, 6);
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.fillRect(barX, y - 3, barW * level, 6);
    });

    // Spectrum, with the loudest band and the centroid marked on the same axis.
    const spectrum = f.spectrum, bands = spectrum.length || 1;
    const spanW = WIDTH - 2 * PAD, band = spanW / bands, bottom = SPECTRUM_TOP + SPECTRUM_HEIGHT;
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = ink;
    ctx.fillRect(PAD, SPECTRUM_TOP, spanW, SPECTRUM_HEIGHT);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = accent;
    for (let i = 0; i < spectrum.length; i++) {
      const h = SPECTRUM_HEIGHT * clamp01(spectrum[i]);
      ctx.fillRect(PAD + i * band, bottom - h, Math.max(1, band - 1), h);
    }
    const at = (x: number) => PAD + (x * (bands - 1) + 0.5) * band;
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.fillRect(Math.round(at(peakPosition(spectrum))) - 1, SPECTRUM_TOP, 2, SPECTRUM_HEIGHT);
    ctx.fillStyle = this.centroidColour;
    ctx.fillRect(Math.round(at(centroidPosition(spectrum))) - 1, SPECTRUM_TOP, 2, SPECTRUM_HEIGHT);

    // Legend.
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = ink;
    ctx.fillText("ao.fft", PAD, LEGEND);
    ctx.textAlign = "right";
    ctx.fillStyle = this.centroidColour;
    ctx.fillText("▎centroid", WIDTH - PAD, LEGEND);
    const centroidW = ctx.measureText("▎centroid").width;
    ctx.fillStyle = ink;
    ctx.fillText("▎peak", WIDTH - PAD - centroidW - 10, LEGEND);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }
}

const clamp01 = (x: number) => (x > 1 ? 1 : x > 0 ? x : 0);
