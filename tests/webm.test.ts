import { describe, expect, it } from "vitest";
import { encodeDuration, reserveDuration } from "../src/shared/webm";

// A tiny WebM header in MediaRecorder's live layout: EBML, a Segment of
// unknown size, Info (TimecodeScale, MuxingApp), Tracks, then a Cluster.
const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77];
const TIMECODE_SCALE = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40];
const MUXING_APP = [0x4d, 0x80, 0x82, 0x41, 0x6f];
const INFO = [0x15, 0x49, 0xa9, 0x66, 0x80 | (TIMECODE_SCALE.length + MUXING_APP.length), ...TIMECODE_SCALE, ...MUXING_APP];
const TRACKS = [0x16, 0x54, 0xae, 0x6b, 0x83, 0xae, 0x81, 0x00];
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00];
const UNKNOWN_SEGMENT = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

const header = (segment = UNKNOWN_SEGMENT, info = INFO) =>
  Uint8Array.from([...EBML_HEADER, ...segment, ...info, ...TRACKS, ...CLUSTER]);

const float64At = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getFloat64(at);

describe("reserveDuration", () => {
  it("reserves room for a Duration in the Info and grows the Info's size", () => {
    const input = header();
    const result = reserveDuration(input)!;
    expect(result).not.toBeNull();
    const { bytes, slot } = result;
    expect(slot.scale).toBe(1_000_000);
    expect(slot.size).toBe(8);
    // The Info now has an 8-byte size covering its old children plus 11 bytes.
    const infoAt = EBML_HEADER.length + UNKNOWN_SEGMENT.length;
    expect([...bytes.subarray(infoAt, infoAt + 4)]).toEqual([0x15, 0x49, 0xa9, 0x66]);
    expect([...bytes.subarray(infoAt + 4, infoAt + 12)]).toEqual([1, 0, 0, 0, 0, 0, 0, INFO.length - 5 + 11]);
    // An 11-byte Void until stopping replaces it; a player just skips it.
    expect(slot.element).toBe(true);
    expect([...bytes.subarray(slot.offset, slot.offset + 11)]).toEqual([0xec, 0x89, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Everything after the Info is untouched.
    expect([...bytes.subarray(slot.offset + 11)]).toEqual([...TRACKS, ...CLUSTER]);
    expect(bytes.length).toBe(input.length + 7 + 11);
  });

  it("writes the duration in the file's timecode units", () => {
    const { bytes, slot } = reserveDuration(header())!;
    const patched = bytes.slice();
    const duration = encodeDuration(4916.1, slot);
    expect(duration.length).toBe(11); // exactly replaces the Void
    patched.set(duration, slot.offset);
    expect([...patched.subarray(slot.offset, slot.offset + 3)]).toEqual([0x44, 0x89, 0x88]);
    expect(float64At(patched, slot.offset + 3)).toBeCloseTo(4916.1);
    expect(patched.length).toBe(bytes.length);
    expect(float64At(encodeDuration(2000, { offset: 0, size: 8, scale: 1_000, element: false }), 0)).toBe(2_000_000);
    expect(new DataView(encodeDuration(1500, { offset: 0, size: 4, scale: 1e6, element: false }).buffer).getFloat32(0)).toBe(1500);
  });

  it("reuses an existing Duration instead of adding one", () => {
    const duration = [0x44, 0x89, 0x84, 0, 0, 0, 0];
    const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | (TIMECODE_SCALE.length + duration.length), ...TIMECODE_SCALE, ...duration];
    const input = header(UNKNOWN_SEGMENT, info);
    const { bytes, slot } = reserveDuration(input)!;
    expect(bytes).toBe(input);
    expect(slot.size).toBe(4);
    expect(slot.element).toBe(false);
    expect(slot.offset).toBe(EBML_HEADER.length + UNKNOWN_SEGMENT.length + 5 + TIMECODE_SCALE.length + 3);
  });

  it("grows a known Segment size along with the Info", () => {
    const rest = INFO.length + TRACKS.length + CLUSTER.length;
    const known = [0x18, 0x53, 0x80, 0x67, 0x40, rest]; // 2-byte size
    const { bytes } = reserveDuration(header(known))!;
    const segAt = EBML_HEADER.length;
    expect([...bytes.subarray(segAt + 4, segAt + 12)]).toEqual([1, 0, 0, 0, 0, 0, 0, rest + 7 + 11]);
    expect(bytes.length - (segAt + 12)).toBe(rest + 7 + 11);
  });

  it("leaves anything unexpected alone", () => {
    expect(reserveDuration(new Uint8Array([0x1a]))).toBeNull();
    expect(reserveDuration(header().subarray(0, 25))).toBeNull(); // Info cut off
    expect(reserveDuration(new Uint8Array(64))).toBeNull();
    const seekHead = [0x11, 0x4d, 0x9b, 0x74, 0x80];
    expect(reserveDuration(Uint8Array.from([...EBML_HEADER, ...UNKNOWN_SEGMENT, ...seekHead, ...INFO]))).toBeNull();
    // A Cluster before any Info.
    expect(reserveDuration(Uint8Array.from([...EBML_HEADER, ...UNKNOWN_SEGMENT, ...CLUSTER]))).toBeNull();
  });
});
