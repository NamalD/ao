import { describe, expect, it } from "vitest";
import { bandCentres } from "../src/shared/analysis";
import { SPECTRUM_BANDS } from "../src/shared/features";
import {
  centroidPosition, hzLevel, hzToPosition, peakPosition, positionToHz, spectrumAt,
} from "../src/shared/spectrum";

const centres = bandCentres();
const ramp = Array.from({ length: SPECTRUM_BANDS }, (_, i) => i / (SPECTRUM_BANDS - 1));

describe("hzToPosition", () => {
  it("puts every band centre on its texel centre, and inverts", () => {
    centres.forEach((hz, i) => expect(hzToPosition(hz)).toBeCloseTo((i + 0.5) / SPECTRUM_BANDS, 12));
    expect(positionToHz(hzToPosition(440))).toBeCloseTo(440, 9);
  });
});

describe("spectrumAt", () => {
  it("interpolates between band centres like a linear texture lookup", () => {
    const s = [0, 1, 0.5, 0.5];
    expect(spectrumAt(s, 0.125)).toBe(0); // texel 0 centre
    expect(spectrumAt(s, 0.375)).toBe(1); // texel 1 centre
    expect(spectrumAt(s, 0.25)).toBeCloseTo(0.5, 12); // halfway between 0 and 1
    expect(spectrumAt(s, 0.5)).toBeCloseTo(0.75, 12);
  });

  it("clamps at the edges and outside 0..1", () => {
    const s = [0.2, 0.4, 0.6, 0.8];
    expect(spectrumAt(s, 0)).toBe(0.2);
    expect(spectrumAt(s, -3)).toBe(0.2);
    expect(spectrumAt(s, 1)).toBe(0.8);
    expect(spectrumAt(s, 7)).toBe(0.8);
    expect(spectrumAt(s, NaN)).toBe(0.2);
    expect(spectrumAt([], 0.5)).toBe(0);
  });
});

describe("hzLevel", () => {
  it("averages the bands whose centres fall in the range", () => {
    const inside = ramp.filter((_, i) => centres[i] >= 40 && centres[i] <= 100);
    expect(inside.length).toBeGreaterThan(2);
    const mean = inside.reduce((a, b) => a + b, 0) / inside.length;
    expect(hzLevel(ramp, 40, 100)).toBeCloseTo(mean, 12);
    expect(hzLevel(ramp, 100, 40)).toBeCloseTo(mean, 12);
  });

  it("covers everything for an open range, and matches ao.bass's bands below 250 Hz", () => {
    expect(hzLevel(ramp, 0, 1e6)).toBeCloseTo(0.5, 12);
    const bass = ramp.filter((_, i) => centres[i] < 250);
    expect(hzLevel(ramp, 0, 249)).toBeCloseTo(bass.reduce((a, b) => a + b, 0) / bass.length, 12);
  });

  it("reads the interpolated level for a range narrower than a band, or a single frequency", () => {
    expect(hzLevel(ramp, 440)).toBeCloseTo(spectrumAt(ramp, hzToPosition(440)), 12);
    expect(hzLevel(ramp, 440, 445)).toBeCloseTo(spectrumAt(ramp, hzToPosition(Math.sqrt(440 * 445))), 12);
    expect(hzLevel(ramp, centres[10])).toBeCloseTo(ramp[10], 12);
  });
});

describe("peakPosition", () => {
  it("finds the loudest band and glides between neighbours", () => {
    const s = new Array(SPECTRUM_BANDS).fill(0.1);
    s[20] = 0.9;
    expect(peakPosition(s)).toBeCloseTo(20.5 / SPECTRUM_BANDS, 12);
    s[21] = 0.8; // leaning towards band 21
    const x = peakPosition(s);
    expect(x).toBeGreaterThan(20.5 / SPECTRUM_BANDS);
    expect(x).toBeLessThan(21 / SPECTRUM_BANDS);
  });

  it("handles the edges and silence", () => {
    const s = new Array(SPECTRUM_BANDS).fill(0);
    expect(peakPosition(s)).toBe(0);
    s[SPECTRUM_BANDS - 1] = 0.5;
    expect(peakPosition(s)).toBeCloseTo(1 - 0.5 / SPECTRUM_BANDS, 12);
  });
});

describe("centroidPosition", () => {
  it("sits at a lone band, between two equal bands, and is 0 in silence", () => {
    const s = new Array(SPECTRUM_BANDS).fill(0);
    expect(centroidPosition(s)).toBe(0);
    s[8] = 1;
    expect(centroidPosition(s)).toBeCloseTo(8.5 / SPECTRUM_BANDS, 12);
    s[40] = 1;
    expect(centroidPosition(s)).toBeCloseTo(24.5 / SPECTRUM_BANDS, 12);
  });
});
