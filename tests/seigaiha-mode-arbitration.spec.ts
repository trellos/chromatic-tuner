import { expect, test } from "@playwright/test";
import { resolveSeigaihaRandomnessDriver } from "../src/ui/seigaihaBackground.ts";

test("seigaiha arbitration: debug override has highest priority", () => {
  const driver = resolveSeigaihaRandomnessDriver({
    debugOverrideEnabled: true,
    modeRandomness: 0.8,
    lastDetuneAbsCents: 6,
  });

  expect(driver).toBe("debug");
});

test("seigaiha arbitration: mode-driven randomness beats tuner mapping", () => {
  const driver = resolveSeigaihaRandomnessDriver({
    debugOverrideEnabled: false,
    modeRandomness: 0.5,
    lastDetuneAbsCents: 8,
  });

  expect(driver).toBe("mode");
});

test("seigaiha arbitration: tuner is used when no debug/mode source is active", () => {
  const driver = resolveSeigaihaRandomnessDriver({
    debugOverrideEnabled: false,
    modeRandomness: null,
    lastDetuneAbsCents: 4,
  });

  expect(driver).toBe("tuner");
});

test("seigaiha arbitration: no active source resolves to none", () => {
  const driver = resolveSeigaihaRandomnessDriver({
    debugOverrideEnabled: false,
    modeRandomness: null,
    lastDetuneAbsCents: null,
  });

  expect(driver).toBe("none");
});

