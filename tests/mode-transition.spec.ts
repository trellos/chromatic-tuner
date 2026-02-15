import { expect, test } from "@playwright/test";
import { runModeTransition } from "../src/mode-transition.ts";

test("runModeTransition executes exit -> apply -> enter order", async () => {
  const steps: string[] = [];

  await runModeTransition({
    exitCurrent: async () => {
      steps.push("exit");
    },
    applyUiState: () => {
      steps.push("apply");
    },
    enterNext: async () => {
      steps.push("enter");
    },
  });

  expect(steps).toEqual(["exit", "apply", "enter"]);
});

test("runModeTransition stops before UI apply when exit fails", async () => {
  const steps: string[] = [];
  const errors: string[] = [];

  await runModeTransition({
    exitCurrent: async () => {
      steps.push("exit");
      throw new Error("exit failed");
    },
    applyUiState: () => {
      steps.push("apply");
    },
    enterNext: async () => {
      steps.push("enter");
    },
    onError: (error) => {
      errors.push(error instanceof Error ? error.message : String(error));
    },
  });

  expect(steps).toEqual(["exit"]);
  expect(errors).toEqual(["exit failed"]);
});

test("runModeTransition keeps applied UI state when enter fails", async () => {
  const steps: string[] = [];
  const errors: string[] = [];

  await runModeTransition({
    applyUiState: () => {
      steps.push("apply");
    },
    enterNext: async () => {
      steps.push("enter");
      throw new Error("enter failed");
    },
    onError: (error) => {
      errors.push(error instanceof Error ? error.message : String(error));
    },
  });

  expect(steps).toEqual(["apply", "enter"]);
  expect(errors).toEqual(["enter failed"]);
});
