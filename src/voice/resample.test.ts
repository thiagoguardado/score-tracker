import { describe, expect, it } from "vitest";
import { resamplePcm, WHISPER_SAMPLE_RATE } from "./resample";

describe("PCM resampling", () => {
  it("downsamples 48 kHz microphone PCM to Whisper's 16 kHz input", () => {
    const output = resamplePcm(new Float32Array(48_000).fill(-0.5), 48_000);
    expect(output).toHaveLength(WHISPER_SAMPLE_RATE);
    expect(output[0]).toBeCloseTo(-0.5);
    expect(output.at(-1)).toBeCloseTo(-0.5);
  });

  it("interpolates lower-rate input without changing its sign", () => {
    const output = resamplePcm(new Float32Array([-1, 0, 1]), 8_000);
    expect(output).toHaveLength(6);
    expect(output[0]).toBe(-1);
    expect(output[1]).toBeCloseTo(-0.5);
    expect(output[4]).toBe(1);
  });

  it("rejects invalid source rates", () => {
    expect(() => resamplePcm(new Float32Array([0]), 0)).toThrow("invalid-sample-rate");
  });
});
