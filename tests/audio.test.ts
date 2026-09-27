import { afterEach, describe, expect, it } from "vitest";
import { bandCentres } from "../src/shared/analysis";
import { silentFeatures, SPECTRUM_BANDS } from "../src/shared/features";
import { ao, aoDocs, updateAudio } from "../src/renderer/audio";
import { spectrogram } from "../src/renderer/spectrogram";

function withSpectrum(level: (i: number) => number) {
  updateAudio({ ...silentFeatures(1), bass: 0.25, spectrum: Array.from({ length: SPECTRUM_BANDS }, (_, i) => level(i)) });
}

afterEach(() => updateAudio(silentFeatures()));

describe("ao", () => {
  it("reads the FFT helpers from the latest features", () => {
    const centres = bandCentres();
    withSpectrum((i) => (centres[i] >= 40 && centres[i] <= 100 ? 0.8 : 0.1));
    expect(ao.hz(40, 100)).toBeCloseTo(0.8, 12);
    expect(ao.hz(6000, 12000)).toBeCloseTo(0.1, 12);
    expect(ao.fftAt(0)).toBeCloseTo(0.1, 12);
    expect(ao.peak).toBeGreaterThan(0);
    expect(ao.centroid).toBeGreaterThan(0);
  });

  it("maps level names and functions onto a range, re-reading every call", () => {
    withSpectrum(() => 0.5);
    const bass = ao.map("bass", 1, 3);
    const kick = ao.map(() => ao.hz(40, 100), 0, 2);
    expect(bass()).toBeCloseTo(1.5, 12);
    expect(kick()).toBeCloseTo(1, 12);
    withSpectrum(() => 1);
    expect(kick()).toBeCloseTo(2, 12);
    expect(ao.map("peak")()).toBe(ao.peak);
  });

  it("documents every public member", () => {
    const members = Object.keys(Object.getOwnPropertyDescriptors(ao)).filter((key) => key !== "features");
    expect(Object.keys(aoDocs).sort()).toEqual(members.sort());
    for (const [name, doc] of Object.entries(aoDocs)) {
      expect(doc.signature.startsWith(`ao.${name}`)).toBe(true);
      expect(doc.description.length).toBeGreaterThan(10);
    }
  });

  it("reads the waveform, stereo image and chroma, and feeds the spectrogram", () => {
    const wave = Float32Array.from({ length: 512 }, (_, i) => (i < 256 ? -0.5 : 0.5));
    const chroma = Array.from({ length: 12 }, (_, i) => (i === 7 ? 1 : 0.2));
    const written = spectrogram.written;
    updateAudio({ ...silentFeatures(100), spectrum: new Array(SPECTRUM_BANDS).fill(0.75), wave, balance: -0.4, width: 0.3, chroma, key: 7 });
    expect(ao.wave).toBe(wave);
    expect(ao.waveAt(0)).toBe(-0.5);
    expect(ao.waveAt(1)).toBe(0.5);
    expect(ao.waveAt(0.5)).toBeCloseTo(0, 6);
    expect(ao.balance).toBe(-0.4);
    expect(ao.width).toBe(0.3);
    expect(ao.chroma).toBe(chroma);
    expect(ao.key).toBe(7);
    expect(ao.hue).toBeCloseTo(7 / 12, 12);
    expect(spectrogram.written).toBeGreaterThan(written);
    expect(spectrogram.at(10, 0)).toBe(0.75);
  });
});
