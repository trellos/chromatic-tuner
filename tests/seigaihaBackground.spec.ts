import { expect, test } from "@playwright/test";
import {
  generateTraditionalSeigaihaSvg,
  quantizeSeigaihaRandomnessForCache,
  resolveSeigaihaInterpolationForTest,
} from "../src/ui/seigaihaBackground.js";

test("seigaiha generator is deterministic for same seed/options", () => {
  const first = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    accentInkColor: "#7c3aed",
    randomness: 0.37,
    seed: 1337,
  });
  const second = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    accentInkColor: "#7c3aed",
    randomness: 0.37,
    seed: 1337,
  });

  expect(first.tileWidth).toBe(second.tileWidth);
  expect(first.tileHeight).toBe(second.tileHeight);
  expect(first.svg).toBe(second.svg);
});

test("seigaiha generator changes output when seed changes", () => {
  const first = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    accentInkColor: "#7c3aed",
    randomness: 0.37,
    seed: 1337,
  });
  const second = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    accentInkColor: "#7c3aed",
    randomness: 0.37,
    seed: 1338,
  });

  expect(first.svg).not.toBe(second.svg);
});

test("seigaiha randomness endpoints clamp to textbook and max states", () => {
  const belowZero = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    randomness: -5,
    seed: 1337,
  });
  const zero = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    randomness: 0,
    seed: 1337,
  });
  const aboveOne = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    randomness: 5,
    seed: 1337,
  });
  const one = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    randomness: 1,
    seed: 1337,
  });

  expect(belowZero.svg).toBe(zero.svg);
  expect(aboveOne.svg).toBe(one.svg);
});

test("seigaiha cache quantization is stable and bounded", () => {
  const nearA = quantizeSeigaihaRandomnessForCache(0.1009);
  const nearB = quantizeSeigaihaRandomnessForCache(0.101);
  const clampedLow = quantizeSeigaihaRandomnessForCache(-2);
  const clampedHigh = quantizeSeigaihaRandomnessForCache(3);

  expect(nearA).toBe(nearB);
  expect(clampedLow).toBe(0);
  expect(clampedHigh).toBe(1);
});

test("seigaiha interpolation resolves adjacent frame keys and blend weights", () => {
  const nearQuarter = resolveSeigaihaInterpolationForTest(0.26, 96);
  const atOne = resolveSeigaihaInterpolationForTest(1, 96);
  const belowZero = resolveSeigaihaInterpolationForTest(-1, 96);

  expect(nearQuarter.keyB).toBeGreaterThanOrEqual(nearQuarter.keyA);
  expect(nearQuarter.blendA + nearQuarter.blendB).toBeCloseTo(1, 6);
  expect(atOne.keyA).toBe(1);
  expect(atOne.keyB).toBe(1);
  expect(atOne.blendA).toBe(1);
  expect(atOne.blendB).toBe(0);
  expect(belowZero.keyA).toBe(0);
  expect(belowZero.keyB).toBeGreaterThanOrEqual(0);
});

