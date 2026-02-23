import { expect, test } from "@playwright/test";
import {
  getDrumRandomnessForBeat,
  getDrumSoundingBeatIndicesFromFlags,
} from "../src/modes/drum-machine.js";

test("drum randomness: collects sounding beats in order", () => {
  const sounding = getDrumSoundingBeatIndicesFromFlags([
    true,
    false,
    true,
    true,
    false,
  ]);

  expect(sounding).toEqual([0, 2, 3]);
});

test("drum randomness: first sounding beat is always zero", () => {
  const next = getDrumRandomnessForBeat({
    beatIndex: 1,
    soundingBeatIndices: [1, 2, 3],
    target: 0.9,
  });

  expect(next).toBe(0);
});

test("drum randomness: non-sounding beat produces no update", () => {
  const next = getDrumRandomnessForBeat({
    beatIndex: 2,
    soundingBeatIndices: [0, 1, 3],
    target: 0.9,
  });

  expect(next).toBeNull();
});

test("drum randomness: final sounding beat reaches target", () => {
  const next = getDrumRandomnessForBeat({
    beatIndex: 3,
    soundingBeatIndices: [0, 2, 3],
    target: 0.9,
  });

  expect(next).toBeCloseTo(0.9, 8);
});

test("drum randomness: middle sounding beat linearly interpolates by rank", () => {
  const next = getDrumRandomnessForBeat({
    beatIndex: 2,
    soundingBeatIndices: [0, 2, 3],
    target: 0.9,
  });

  expect(next).toBeCloseTo(0.45, 8);
});

test("drum randomness: single sounding beat remains zero", () => {
  const next = getDrumRandomnessForBeat({
    beatIndex: 2,
    soundingBeatIndices: [2],
    target: 0.9,
  });

  expect(next).toBe(0);
});

test("drum randomness: target is clamped to [0, 1]", () => {
  const clampedLow = getDrumRandomnessForBeat({
    beatIndex: 3,
    soundingBeatIndices: [0, 3],
    target: -2,
  });
  const clampedHigh = getDrumRandomnessForBeat({
    beatIndex: 3,
    soundingBeatIndices: [0, 3],
    target: 2,
  });

  expect(clampedLow).toBe(0);
  expect(clampedHigh).toBe(1);
});

