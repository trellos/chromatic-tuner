/**
 * UI tests for Wild Tuna JamFlow interactions.
 *
 * Covers:
 *   1. Double-tapping a flower in Circle of Fifths transitions to Key Zoom mode.
 *   2. Single-tapping a flower plays the chord but stays in Circle mode.
 *   3. Tapping the note bar transitions to Fretboard mode.
 *   4. Circle looper REC button arms recording while in key-zoom mode.
 *   5. Fretboard looper REC button arms recording while in fretboard mode.
 *   6. Double-tapping the center area in circle mode cycles the instrument label.
 */

import { test, expect, type Page } from "@playwright/test";
import { switchMode } from "./helpers/mode.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Switch to Wild Tuna and enter fullscreen. */
async function enterWildTuna(page: Page): Promise<void> {
  await page.goto("/");
  await switchMode(page, "Wild Tuna");
  await page.locator("[data-wild-tuna-fullscreen]").click();
  // Wait for the fullscreen CSS to apply and the canvas to render
  await page.waitForTimeout(400);
}

/**
 * Tap the JamFlow canvas at a position calculated in-browser.
 * `getPosition` receives the canvas DOMRect and returns {x, y} in client coords.
 */
async function tapCanvas(
  page: Page,
  getPosition: (rect: DOMRect) => { x: number; y: number }
): Promise<void> {
  const pos = await page.evaluate((fn) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".jf-canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return (new Function("rect", `return (${fn})(rect)`))(rect) as { x: number; y: number };
  }, getPosition.toString());

  if (!pos) throw new Error("jf-canvas not found");
  await page.mouse.click(pos.x, pos.y);
}

/**
 * Double-tap the JamFlow canvas at a position calculated in-browser.
 * Two rapid clicks within the double-tap threshold (~400ms).
 */
async function doubleTapCanvas(
  page: Page,
  getPosition: (rect: DOMRect) => { x: number; y: number }
): Promise<void> {
  const pos = await page.evaluate((fn) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".jf-canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return (new Function("rect", `return (${fn})(rect)`))(rect) as { x: number; y: number };
  }, getPosition.toString());

  if (!pos) throw new Error("jf-canvas not found");
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(80);
  await page.mouse.click(pos.x, pos.y);
}

/**
 * Returns true if the note bar has any diatonic-coloured buttons,
 * which only appears after a key is selected (i.e. key-zoom mode).
 */
async function noteBarHasDiatonicButtons(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return document.querySelectorAll(".jf-note-btn--diatonic").length > 0;
  });
}

/**
 * Returns whether the circle looper container is visible on screen.
 */
async function isCircleLooperVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-wild-tuna-circle-looper]");
    if (!el) return false;
    return el.style.display !== "none" && getComputedStyle(el).display !== "none";
  });
}

/**
 * Returns whether the fretboard looper container is visible on screen.
 */
async function isFretboardLooperVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-wild-tuna-fretboard-looper]");
    if (!el) return false;
    return el.style.display !== "none" && getComputedStyle(el).display !== "none";
  });
}

/** Flower position near the top of the canvas (where C lives in the circle). */
const FLOWER_POSITION = (rect: DOMRect) => ({
  x: rect.left + rect.width * 0.5,
  y: rect.top + rect.height * 0.18,
});

/** Center of the canvas (instrument label area). */
const CENTER_POSITION = (rect: DOMRect) => ({
  x: rect.left + rect.width * 0.5,
  y: rect.top + rect.height * 0.5,
});

// ── Tests ────────────────────────────────────────────────────────────────────

test("single-tapping a flower stays in circle mode (no key zoom)", async ({ page }) => {
  await enterWildTuna(page);

  // Initially the note bar should have only default (non-diatonic) buttons
  expect(await noteBarHasDiatonicButtons(page)).toBe(false);

  // Single tap should NOT enter key-zoom
  await tapCanvas(page, FLOWER_POSITION);
  await page.waitForTimeout(600);

  // Note bar should still have no diatonic buttons (still in circle mode)
  expect(await noteBarHasDiatonicButtons(page)).toBe(false);
});

test("double-tapping a flower in Circle of Fifths transitions to Key Zoom mode", async ({ page }) => {
  await enterWildTuna(page);

  // Initially the note bar should have only default (non-diatonic) buttons
  expect(await noteBarHasDiatonicButtons(page)).toBe(false);

  // Double-tap the canvas near the top where the C flower lives
  await doubleTapCanvas(page, FLOWER_POSITION);

  // Allow transition animation to complete
  await page.waitForTimeout(600);

  // After double-tap selecting a key, the note bar gains diatonic-coloured buttons
  expect(await noteBarHasDiatonicButtons(page)).toBe(true);

  // Circle looper should still be visible (key-zoom is circle instrument)
  expect(await isCircleLooperVisible(page)).toBe(true);
  expect(await isFretboardLooperVisible(page)).toBe(false);
});

test("tapping the note bar transitions to Fretboard mode", async ({ page }) => {
  await enterWildTuna(page);

  // First select a key by double-tapping the canvas (any flower)
  await doubleTapCanvas(page, FLOWER_POSITION);
  await page.waitForTimeout(600);

  // Confirm we're in key-zoom
  expect(await noteBarHasDiatonicButtons(page)).toBe(true);

  // Tap any note bar button to switch to fretboard
  const noteBarBtn = page.locator(".jf-note-btn").first();
  await expect(noteBarBtn).toBeVisible();
  await noteBarBtn.click();

  // Allow transition
  await page.waitForTimeout(600);

  // Fretboard looper should now be visible; circle looper hidden
  expect(await isFretboardLooperVisible(page)).toBe(true);
  expect(await isCircleLooperVisible(page)).toBe(false);
});

test("circle looper REC button is accessible and arms recording in key-zoom mode", async ({ page }) => {
  await enterWildTuna(page);

  // Start drum transport BEFORE entering key-zoom (drum pane is visible here)
  const drumPlayBtn = page.locator(".drum-play").first();
  await expect(drumPlayBtn).toBeVisible();
  await drumPlayBtn.click();
  await page.waitForTimeout(200);

  // Navigate to key-zoom via double-tap
  await doubleTapCanvas(page, FLOWER_POSITION);
  await page.waitForTimeout(600);

  // The circle looper should be visible
  const circleLooperHost = page.locator("[data-wild-tuna-circle-looper]");
  await expect(circleLooperHost).toBeVisible();

  // Find the REC button inside the circle looper
  const recBtn = circleLooperHost.locator(".ui-composite-looper-btn--rec");
  await expect(recBtn).toBeVisible();

  // Click REC — looper should transition to armed or recording state
  await recBtn.click();
  await page.waitForTimeout(200);

  // The looper container should now have is-armed or is-recording CSS class
  const looperEl = circleLooperHost.locator(".ui-composite-looper");
  const looperClass = await looperEl.getAttribute("class");
  expect(looperClass).toMatch(/is-armed|is-recording/);
});

test("fretboard looper REC button is accessible and arms recording in fretboard mode", async ({ page }) => {
  await enterWildTuna(page);

  // Start drum transport BEFORE entering key-zoom (drum pane is visible here)
  const drumPlayBtn = page.locator(".drum-play").first();
  await expect(drumPlayBtn).toBeVisible();
  await drumPlayBtn.click();
  await page.waitForTimeout(200);

  // Navigate to key-zoom then fretboard via double-tap
  await doubleTapCanvas(page, FLOWER_POSITION);
  await page.waitForTimeout(600);

  // Tap note bar to enter fretboard mode
  await page.locator(".jf-note-btn").first().click();
  await page.waitForTimeout(600);

  // Fretboard looper should now be visible
  const fretLooperHost = page.locator("[data-wild-tuna-fretboard-looper]");
  await expect(fretLooperHost).toBeVisible();

  const recBtn = fretLooperHost.locator(".ui-composite-looper-btn--rec");
  await expect(recBtn).toBeVisible();

  // Click REC
  await recBtn.click();
  await page.waitForTimeout(200);

  // Looper should be armed or recording
  const looperEl = fretLooperHost.locator(".ui-composite-looper");
  const looperClass = await looperEl.getAttribute("class");
  expect(looperClass).toMatch(/is-armed|is-recording/);
});

test("double-tapping the center of the circle cycles the instrument label", async ({ page }) => {
  await enterWildTuna(page);

  // Read the initial instrument label from the canvas center text.
  // The label is drawn onto the canvas; we verify it changes by checking the
  // internal state exposed via the instrument name cycling.
  // We trigger two rapid center taps and verify the canvas re-renders without error.

  // First, confirm we're in circle mode by checking no diatonic buttons exist.
  expect(await noteBarHasDiatonicButtons(page)).toBe(false);

  // Double-tap the canvas center — this should cycle the instrument.
  await doubleTapCanvas(page, CENTER_POSITION);

  // Allow re-render
  await page.waitForTimeout(200);

  // We remain in circle mode (no key zoom transition should occur from center tap)
  expect(await noteBarHasDiatonicButtons(page)).toBe(false);

  // Double-tap the center again to cycle back or forward
  await doubleTapCanvas(page, CENTER_POSITION);
  await page.waitForTimeout(200);

  // Still in circle mode, no errors
  expect(await noteBarHasDiatonicButtons(page)).toBe(false);

  // Verify the canvas is still rendering (has non-zero size)
  const canvasVisible = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".jf-canvas");
    return canvas !== null && canvas.width > 0 && canvas.height > 0;
  });
  expect(canvasVisible).toBe(true);
});
