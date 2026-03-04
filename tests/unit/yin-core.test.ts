import { describe, it, expect } from "vitest";
import { yinDetectMain } from "../../src/audio/yin-core.js";

const SR = 44100;
const WINDOW_SIZE = 4096;
const HALF = WINDOW_SIZE / 2;

function makeHannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

function makeBuffers() {
  return {
    diff: new Float32Array(HALF),
    cmnd: new Float32Array(HALF),
    window: makeHannWindow(WINDOW_SIZE),
  };
}

/** Generate a pure sine wave at the given frequency. */
function sineWave(freq: number, sr: number, length: number): Float32Array {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    buf[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return buf;
}

describe("yinDetectMain", () => {
  it("returns null for buffers that are too small", () => {
    const { diff, cmnd, window } = makeBuffers();
    const tiny = new Float32Array(3);
    const result = yinDetectMain(tiny, SR, diff, cmnd, window);
    expect(result.freqHz).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns null for silence (all zeros)", () => {
    const { diff, cmnd, window } = makeBuffers();
    const silence = new Float32Array(WINDOW_SIZE);
    const result = yinDetectMain(silence, SR, diff, cmnd, window);
    expect(result.freqHz).toBeNull();
  });

  it("detects A4 (440 Hz) within ±5 Hz", () => {
    const { diff, cmnd, window } = makeBuffers();
    const signal = sineWave(440, SR, WINDOW_SIZE);
    const result = yinDetectMain(signal, SR, diff, cmnd, window);
    expect(result.freqHz).not.toBeNull();
    expect(Math.abs(result.freqHz! - 440)).toBeLessThan(5);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects E2 (82.4 Hz) within ±5 Hz", () => {
    const { diff, cmnd, window } = makeBuffers();
    const signal = sineWave(82.4, SR, WINDOW_SIZE);
    const result = yinDetectMain(signal, SR, diff, cmnd, window);
    expect(result.freqHz).not.toBeNull();
    expect(Math.abs(result.freqHz! - 82.4)).toBeLessThan(5);
  });

  it("detects C5 (523.25 Hz) within ±5 Hz", () => {
    const { diff, cmnd, window } = makeBuffers();
    const signal = sineWave(523.25, SR, WINDOW_SIZE);
    const result = yinDetectMain(signal, SR, diff, cmnd, window);
    expect(result.freqHz).not.toBeNull();
    expect(Math.abs(result.freqHz! - 523.25)).toBeLessThan(5);
  });

  it("rejects frequencies below 60 Hz (e.g. 30 Hz sine)", () => {
    const { diff, cmnd, window } = makeBuffers();
    const signal = sineWave(30, SR, WINDOW_SIZE);
    const result = yinDetectMain(signal, SR, diff, cmnd, window);
    // 30 Hz is below the detectable range; result must be null or ≥60 Hz
    if (result.freqHz !== null) {
      expect(result.freqHz).toBeGreaterThanOrEqual(60);
    }
  });

  it("returns confidence in [0, 1] range for a valid pitch", () => {
    const { diff, cmnd, window } = makeBuffers();
    const signal = sineWave(440, SR, WINDOW_SIZE);
    const result = yinDetectMain(signal, SR, diff, cmnd, window);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("returns higher confidence for a clean sine than for noise", () => {
    const { diff: d1, cmnd: c1, window: w1 } = makeBuffers();
    const { diff: d2, cmnd: c2, window: w2 } = makeBuffers();
    const clean = sineWave(440, SR, WINDOW_SIZE);
    const noise = Float32Array.from({ length: WINDOW_SIZE }, () => Math.random() * 2 - 1);
    const cleanResult = yinDetectMain(clean, SR, d1, c1, w1);
    const noiseResult = yinDetectMain(noise, SR, d2, c2, w2);
    // Clean sine should have higher confidence (or noise returns null)
    if (noiseResult.freqHz !== null) {
      expect(cleanResult.confidence).toBeGreaterThan(noiseResult.confidence);
    }
  });
});
