import { expect, test } from "@playwright/test";

async function assertElementFullyInViewport(
  page: import("@playwright/test").Page,
  selector: string
): Promise<void> {
  const metrics = await page.evaluate((targetSelector) => {
    const element = document.querySelector<HTMLElement>(targetSelector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }, selector);

  expect(metrics, `Missing element: ${selector}`).not.toBeNull();
  expect(metrics?.width ?? 0, `${selector} has zero width`).toBeGreaterThan(0);
  expect(metrics?.height ?? 0, `${selector} has zero height`).toBeGreaterThan(0);
  expect(metrics?.top ?? 0, `${selector} top clipped`).toBeGreaterThanOrEqual(-1);
  expect(metrics?.left ?? 0, `${selector} left clipped`).toBeGreaterThanOrEqual(-1);
  expect(
    metrics?.right ?? Number.POSITIVE_INFINITY,
    `${selector} right clipped`
  ).toBeLessThanOrEqual((metrics?.viewportWidth ?? 0) + 1);
  expect(
    metrics?.bottom ?? Number.POSITIVE_INFINITY,
    `${selector} bottom clipped`
  ).toBeLessThanOrEqual((metrics?.viewportHeight ?? 0) + 1);
}

test("extra-jimmy mode displays two fretboards with controls", async ({ page }) => {
  await page.goto("/");

  // Navigate to Extra Jimmy mode
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  // Verify mode is active
  const modeScreen = page.locator('.mode-screen[data-mode="extra-jimmy"]');
  await expect(modeScreen).toHaveClass(/is-active/);

  // Verify both fretboard viewports exist
  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();

  // Verify both fretboards have rendered content (board elements)
  const lowBoard = lowViewport.locator(".fretboard-board");
  const highBoard = highViewport.locator(".fretboard-board");

  await expect(lowBoard).toBeVisible();
  await expect(highBoard).toBeVisible();

  // Verify fretboards are not squished - check they have reasonable height
  await assertElementFullyInViewport(page, '[data-ej-neck="low"] .fretboard-board');
  await assertElementFullyInViewport(page, '[data-ej-neck="high"] .fretboard-board');

  // Verify dots are distributed across the fretboards (not all in one spot)
  const lowDots = lowViewport.locator(".fretboard-dot");
  const highDots = highViewport.locator(".fretboard-dot");

  const lowDotCount = await lowDots.count();
  const highDotCount = await highDots.count();

  expect(lowDotCount).toBeGreaterThan(0);
  expect(highDotCount).toBeGreaterThan(0);

  // Verify dots are spread out (check positions are different)
  const lowDotPositions = await lowDots.evaluateAll((dots) =>
    dots.map((dot) => {
      const rect = dot.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    })
  );

  const uniquePositions = new Set(lowDotPositions.map((p) => `${p.x},${p.y}`));
  expect(uniquePositions.size).toBeGreaterThan(1);

  // Verify controls are visible
  await expect(page.locator('[data-ej-harmony]')).toBeVisible();
  await expect(page.locator('[data-ej-key-trigger]')).toBeVisible();
  await expect(page.locator('[data-ej-scale]')).toBeVisible();

  // Verify no per-fretboard controls are visible (they should be hidden)
  const lowControls = page.locator('[data-ej-neck="low"] .fretboard-controls');
  const highControls = page.locator('[data-ej-neck="high"] .fretboard-controls');

  await expect(lowControls).not.toBeVisible();
  await expect(highControls).not.toBeVisible();
});

test("extra-jimmy mode has properly sized fretboards", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  // Verify both boards have decent height (not squished to top)
  const lowBoard = await page.locator('[data-ej-neck="low"] .fretboard-board');
  const highBoard = await page.locator('[data-ej-neck="high"] .fretboard-board');

  const lowBox = await lowBoard.boundingBox();
  const highBox = await highBoard.boundingBox();

  // Both boards should have reasonable height (not tiny)
  expect(lowBox?.height).toBeGreaterThan(100);
  expect(highBox?.height).toBeGreaterThan(100);
});

test("extra-jimmy mode harmony controls work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  // Check harmony selector exists and has default value
  const harmonySelect = page.locator('[data-ej-harmony]');
  await expect(harmonySelect).toHaveValue("2");

  // Change harmony
  await harmonySelect.selectOption("4");
  await expect(harmonySelect).toHaveValue("4");
});

test("extra-jimmy mode key popup works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const keyTrigger = page.locator('[data-ej-key-trigger]');
  const keyPopup = page.locator('[data-ej-key-popup]');

  // Popup should be hidden initially
  await expect(keyPopup).toHaveAttribute("hidden");

  // Click key button to open popup
  await keyTrigger.click();
  await expect(keyPopup).not.toHaveAttribute("hidden");

  // Select a different key
  await page.locator('[data-ej-key-note="G"]').click();

  // Button text should update to G
  await expect(keyTrigger).toContainText("G");
});
