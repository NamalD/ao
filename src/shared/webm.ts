/**
 * MediaRecorder writes WebM as a live stream: the Segment Info has no
 * Duration, so players show no length and can't seek well. Rewriting the
 * file at the end would cost a full copy, so instead the first chunk gets
 * an 11-byte Void element in its Segment Info when it is written, and
 * stopping overwrites it in place with a Duration element of the same size.
 * A recording that is never stopped (Ao killed) keeps the harmless Void
 * rather than a wrong duration. Only the header is touched; clusters are
 * never parsed.
 */

const EBML = 0x1a45dfa3, SEGMENT = 0x18538067, INFO = 0x1549a966, SEEK_HEAD = 0x114d9b74;
const CLUSTER = 0x1f43b675, TIMECODE_SCALE = 0x2ad7b1, DURATION = 0x4489;

export interface DurationSlot {
  /** Byte offset in the file where encodeDuration's bytes go. */
  offset: number;
  /** The float's size. */
  size: 4 | 8;
  /** True when the slot is the reserved Void, replaced by a whole element. */
  element: boolean;
  /** Nanoseconds per timecode tick (TimecodeScale). */
  scale: number;
}

interface Vint { value: number; length: number; unknown: boolean }

/** Reads an EBML variable-size integer; `keepMarker` for element IDs. */
function readVint(bytes: Uint8Array, at: number, keepMarker = false): Vint | null {
  if (at >= bytes.length) return null;
  const first = bytes[at];
  if (first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (length > 8 || at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === (0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i];
    if (bytes[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/** An 8-byte EBML size, which fits every size a header can have. */
function size8(value: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7, v = value; i >= 1; i--, v = Math.floor(v / 256)) out[i] = v % 256;
  return out;
}

function readUint(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[at + i];
  return value;
}

interface Element { id: number; start: number; dataStart: number; size: number; unknown: boolean; sizeLength: number }

function readElement(bytes: Uint8Array, at: number): Element | null {
  const id = readVint(bytes, at, true);
  if (!id) return null;
  const size = readVint(bytes, at + id.length);
  if (!size) return null;
  return { id: id.value, start: at, dataStart: at + id.length + size.length, size: size.value,
           unknown: size.unknown, sizeLength: size.length };
}

/**
 * Given the first chunk of a recording, returns the bytes to write instead,
 * with a Duration placeholder in the Segment Info, and where it lives.
 * Returns null when the header isn't the simple live layout expected, in
 * which case the chunk is written unchanged.
 */
export function reserveDuration(chunk: Uint8Array): { bytes: Uint8Array; slot: DurationSlot } | null {
  const ebml = readElement(chunk, 0);
  if (!ebml || ebml.id !== EBML || ebml.unknown) return null;
  const segment = readElement(chunk, ebml.dataStart + ebml.size);
  if (!segment || segment.id !== SEGMENT) return null;

  for (let at = segment.dataStart; ;) {
    const child = readElement(chunk, at);
    // A SeekHead would hold offsets the insertion shifts; a Cluster means no Info.
    if (!child || child.unknown || child.id === SEEK_HEAD || child.id === CLUSTER) return null;
    const end = child.dataStart + child.size;
    if (end > chunk.length) return null;
    if (child.id !== INFO) { at = end; continue; }

    let scale = 1_000_000;
    for (let c = child.dataStart; c < end;) {
      const field = readElement(chunk, c);
      if (!field || field.dataStart + field.size > end) return null;
      if (field.id === TIMECODE_SCALE) scale = readUint(chunk, field.dataStart, field.size);
      if (field.id === DURATION) {
        if (field.size !== 4 && field.size !== 8) return null;
        return { bytes: chunk, slot: { offset: field.dataStart, size: field.size, scale, element: false } };
      }
      c = field.dataStart + field.size;
    }

    // Void (0xEC) of 9 bytes: as long as a Duration element with a float64.
    const placeholder = Uint8Array.of(0xec, 0x89, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const infoId = chunk.subarray(child.start, child.dataStart - child.sizeLength);
    const infoHeader = new Uint8Array([...infoId, ...size8(child.size + placeholder.length)]);
    const growth = infoHeader.length + placeholder.length - (child.dataStart - child.start);
    // A live Segment has an unknown size; a known one grows with the Info
    // (Segment IDs are always 4 bytes).
    const segmentHeader = segment.unknown ? chunk.subarray(segment.start, segment.dataStart)
      : new Uint8Array([...chunk.subarray(segment.start, segment.start + 4), ...size8(segment.size + growth)]);
    const parts = [
      chunk.subarray(0, segment.start),
      segmentHeader,
      chunk.subarray(segment.dataStart, child.start),
      infoHeader,
      chunk.subarray(child.dataStart, end),
      placeholder,
      chunk.subarray(end),
    ];
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0, slotOffset = 0;
    for (const part of parts) {
      if (part === placeholder) slotOffset = offset;
      bytes.set(part, offset);
      offset += part.length;
    }
    return { bytes, slot: { offset: slotOffset, size: 8, scale, element: true } };
  }
}

/** The bytes to write at `slot.offset` for a recording `ms` long. */
export function encodeDuration(ms: number, slot: DurationSlot): Uint8Array {
  const ticks = (ms * 1e6) / slot.scale;
  const header = slot.element ? [0x44, 0x89, 0x80 | slot.size] : [];
  const out = new Uint8Array(header.length + slot.size);
  out.set(header);
  const view = new DataView(out.buffer, header.length);
  if (slot.size === 8) view.setFloat64(0, ticks);
  else view.setFloat32(0, ticks);
  return out;
}
