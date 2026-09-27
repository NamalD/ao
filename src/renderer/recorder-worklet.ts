// Runs on the audio thread: plays the PCM forwarded from the main process's
// capture into the recording's audio track. Loaded with addModule, so it is
// bundled separately (see the `?worker&url` import in recorder.ts).
import { PcmRing } from "../shared/pcm-ring";

// AudioWorkletGlobalScope, which the DOM lib doesn't describe.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor { readonly port: MessagePort }

class PcmPlayer extends AudioWorkletProcessor {
  // Play ~50 ms behind the newest audio; hold at most 250 ms.
  private ring = new PcmRing(Math.round(sampleRate * 0.25), Math.round(sampleRate * 0.05));

  constructor() {
    super();
    // Ao hands over the main process's PCM port; chunks then arrive here
    // directly, whatever the renderer's main thread is doing.
    this.port.onmessage = (e: MessageEvent<{ port: MessagePort }>) => {
      e.data.port.onmessage = (m: MessageEvent<Float32Array>) => this.ring.push(m.data);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0];
    this.ring.pull(left, right ?? new Float32Array(left.length));
    return true;
  }
}

registerProcessor("ao-pcm", PcmPlayer);
