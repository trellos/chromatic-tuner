/**
 * UI tests for Wild Tuna JamFlow interactions.
 *
 * Covers:
 *   1. Tapping a flower in Circle of Fifths transitions to Key Zoom mode.
 *   2. Tapping the note bar transitions to Fretboard mode.
 *   3. Circle looper REC button arms recording while in key-zoom mode.
 *   4. Fretboard looper REC button arms recording while in fretboard mode.
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

// ── Tests ────────────────────────────────────────────────────────────────────

test("tapping a flower in Circle of Fifths transitions to Key Zoom mode", async ({ page }) => {
  await enterWildTuna(page);

  // Initially the note bar should have only default (non-diatonic) buttons
  expect(await noteBarHasDiatonicButtons(page)).toBe(false);

  // Tap the centre of the canvas — the C flower is near the top-centre;
  // tap slightly above the midpoint where flowers cluster.
  await tapCanvas(page, (rect) => ({
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.18, // near the top where C flower lives
  }));

  // Allow transition animation to complete
  await page.waitForTimeout(600);

  // After selecting a key the note bar gains diatonic-coloured buttons
  expect(await noteBarHasDiatonicButtons(page)).toBe(true);

  // Circle looper should still be visible (key-zoom is circle instrument)
  expect(await isCircleLooperVisible(page)).toBe(true);
  expect(await isFretboardLooperVisible(page)).toBe(false);
});

test("tapping the note bar transitions to Fretboard mode", async ({ page }) => {
  await enterWildTuna(page);

  // First select a key by tapping the canvas (any flower)
  await tapCanvas(page, (rect) => ({
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.18,
  }));
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

  // Navigate to key-zoom
  await tapCanvas(page, (rect) => ({
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.18,
  }));
  await page.waitForTimeout(600);

  // The circle looper should be visible
  const circleLooperHost = page.locator("[data-wild-tuna-circle-looper]");
  await expect(circleLooperHost).toBeVisible();

  // Find the REC button inside the circle looper
  const recBtn = circleLooperHost.locator(".ui-composite-looper-btn--rec");
  await expect(recBtn).toBeVisible();

  // Start the drum transport first (required for arming to work correctly)
  const drumPlayBtn = page.locator(".drum-play").first();
  await expect(drumPlayBtn).toBeVisible();
  await drumPlayBtn.click();
  await page.waitForTimeout(200);

  // Click REC — looper should transition to armed or recording state
  await recBtn.click();
  await page.waitForTimeout(200);

  // The looper container should now have is-armed or is-recording CSS class
  const looperEl = circleLooperHost.locator(".ui-composite-looper");
  const looperClass = await looperEl.getAttribute("class");
  expect(looperClass).toMatch(/is-armed|is-recording/);

  // Cleanup: stop transport
  await drumPlayBtn.click();
});

test("fretboard looper REC button is accessible and arms recording in fretboard mode", async ({ page }) => {
  await enterWildTuna(page);

  // Navigate to key-zoom then fretboard
  await tapCanvas(page, (rect) => ({
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.18,
  }));
  await page.waitForTimeout(600);

  // Tap note bar to enter fretboard mode
  await page.locator(".jf-note-btn").first().click();
  await page.waitForTimeout(600);

  // Fretboard looper should now be visible
  const fretLooperHost = page.locator("[data-wild-tuna-fretboard-looper]");
  await expect(fretLooperHost).toBeVisible();

  const recBtn = fretLooperHost.locator(".ui-composite-looper-btn--rec");
  await expect(recBtn).toBeVisible();

  // Start drum transport
  const drumPlayBtn = page.locator(".drum-play").first();
  await drumPlayBtn.click();
  await page.waitForTimeout(200);

  // Click REC
  await recBtn.click();
  await page.waitForTimeout(200);

  // Looper should be armed or recording
  const looperEl = fretLooperHost.locator(".ui-composite-looper");
  const looperClass = await looperEl.getAttribute("class");
  expect(looperClass).toMatch(/is-armed|is-recording/);

  // Cleanup
  await drumPlayBtn.click();
});
