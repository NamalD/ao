import { describe, expect, it } from "vitest";
import { formatElapsed, pickMimeType, recordingFileName, recordSecondsOption, safeSketchName } from "../src/shared/recording";

describe("recording file names", () => {
  const date = new Date(2026, 8, 7, 5, 4, 3); // local time, 7 Sep 2026 05:04:03

  it("follows ao-YYYYMMDD-HHMMSS-<sketch>.webm in local time", () => {
    expect(recordingFileName("dunes", date)).toBe("ao-20260907-050403-dunes.webm");
  });

  it("numbers recordings started within the same second", () => {
    expect(recordingFileName("dunes", date, 1)).toBe("ao-20260907-050403-dunes-2.webm");
    expect(recordingFileName("dunes", date, 2)).toBe("ao-20260907-050403-dunes-3.webm");
  });

  it("keeps sketch names from escaping the folder or breaking the name", () => {
    expect(safeSketchName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeSketchName("my sketch!")).toBe("my-sketch");
    expect(safeSketchName("")).toBe("untitled");
    expect(safeSketchName("///")).toBe("untitled");
    expect(safeSketchName("x".repeat(200))).toHaveLength(60);
    expect(recordingFileName("a/b", date)).not.toContain("/");
  });
});

describe("pickMimeType", () => {
  it("prefers VP9 with Opus", () => {
    expect(pickMimeType(() => true, true)).toBe("video/webm;codecs=vp9,opus");
  });

  it("falls back to VP8, then plain WebM, then the browser default", () => {
    expect(pickMimeType((t) => !t.includes("vp9"), true)).toBe("video/webm;codecs=vp8,opus");
    expect(pickMimeType((t) => t === "video/webm", true)).toBe("video/webm");
    expect(pickMimeType(() => false, true)).toBe("");
  });

  it("asks for no audio codec when recording video only", () => {
    expect(pickMimeType(() => true, false)).toBe("video/webm;codecs=vp9");
  });
});

describe("formatElapsed", () => {
  it("shows m:ss, and hours once past an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(5_999)).toBe("0:05");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-10)).toBe("0:00");
  });
});

describe("recordSecondsOption", () => {
  it("reads a positive number of seconds", () => {
    expect(recordSecondsOption(["electron", ".", "--record-seconds=12.5"])).toBe(12.5);
  });

  it("ignores missing, empty or invalid values", () => {
    expect(recordSecondsOption(["electron", "."])).toBeUndefined();
    expect(recordSecondsOption(["--record-seconds="])).toBeUndefined();
    expect(recordSecondsOption(["--record-seconds=abc"])).toBeUndefined();
    expect(recordSecondsOption(["--record-seconds=0"])).toBeUndefined();
    expect(recordSecondsOption(["--record-seconds=-3"])).toBeUndefined();
  });
});
