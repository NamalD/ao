/**
 * A jitter buffer for interleaved stereo PCM, used by the recorder's
 * AudioWorklet. Chunks arrive over IPC at irregular times; the audio thread
 * pulls a fixed 128 frames per quantum. The ring first fills to `target`
 * frames, then plays; on underrun it outputs silence and refills to `target`
 * rather than crackling on every quantum. If it ever holds more than its
 * capacity (a burst after a stall, or clock drift between the capture device
 * and the AudioContext), the oldest audio is dropped back down to `target`,
 * which keeps the latency bounded.
 */
export class PcmRing {
  private left: Float32Array;
  private right: Float32Array;
  private read = 0;
  private size = 0;
  private priming = true;
  /** Times the buffer ran dry after it had started playing. */
  underruns = 0;
  /** Frames discarded to keep the latency bounded. */
  dropped = 0;

  constructor(readonly capacity: number, readonly target: number) {
    if (!(target > 0 && target <= capacity)) throw new RangeError("need 0 < target <= capacity");
    this.left = new Float32Array(capacity);
    this.right = new Float32Array(capacity);
  }

  get buffered(): number { return this.size; }

  /** Appends interleaved stereo frames (L, R, L, R, ...). */
  push(interleaved: Float32Array): void {
    let frames = interleaved.length >> 1;
    let from = 0;
    if (frames > this.capacity) {
      // Only the newest `capacity` frames can ever play.
      this.dropped += frames - this.capacity;
      from = (frames - this.capacity) * 2;
      frames = this.capacity;
    }
    if (this.size + frames > this.capacity) {
      // Keep the newest `target` frames: first drop buffered audio, then the
      // start of this chunk.
      let excess = this.size + frames - this.target;
      excess -= this.discard(excess);
      this.dropped += excess;
      from += excess * 2;
      frames -= excess;
    }
    let write = (this.read + this.size) % this.capacity;
    for (let i = 0; i < frames; i++) {
      this.left[write] = interleaved[from + i * 2];
      this.right[write] = interleaved[from + i * 2 + 1];
      if (++write === this.capacity) write = 0;
    }
    this.size += frames;
  }

  /** Fills both channels, padding with silence; returns the frames of audio. */
  pull(left: Float32Array, right: Float32Array): number {
    const want = left.length;
    if (this.priming && this.size < this.target) {
      left.fill(0);
      right.fill(0);
      return 0;
    }
    this.priming = false;
    const frames = Math.min(want, this.size);
    for (let i = 0; i < frames; i++) {
      left[i] = this.left[this.read];
      right[i] = this.right[this.read];
      if (++this.read === this.capacity) this.read = 0;
    }
    this.size -= frames;
    if (frames < want) {
      left.fill(0, frames);
      right.fill(0, frames);
      this.underruns++;
      this.priming = true;
    }
    return frames;
  }

  /** Drops up to `frames` of the oldest buffered audio; returns how many. */
  private discard(frames: number): number {
    const n = Math.min(frames, this.size);
    this.read = (this.read + n) % this.capacity;
    this.size -= n;
    this.dropped += n;
    return n;
  }
}
