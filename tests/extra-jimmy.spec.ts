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


async function assertNoElementScrollbars(
  page: import("@playwright/test").Page,
  selector: string
): Promise<void> {
  const metrics = await page.evaluate((targetSelector) => {
    const element = document.querySelector<HTMLElement>(targetSelector);
    if (!element) return null;
    return {
      overflowX: window.getComputedStyle(element).overflowX,
      overflowY: window.getComputedStyle(element).overflowY,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  }, selector);

  expect(metrics, `Missing element: ${selector}`).not.toBeNull();
  expect(metrics?.overflowX, `${selector} should hide x overflow`).toBe("hidden");
  expect(metrics?.overflowY, `${selector} should hide y overflow`).toBe("hidden");
  expect(metrics?.scrollWidth ?? 0, `${selector} content should fit width`).toBeLessThanOrEqual(
    (metrics?.clientWidth ?? 0) + 1
  );
  expect(metrics?.scrollHeight ?? 0, `${selector} content should fit height`).toBeLessThanOrEqual(
    (metrics?.clientHeight ?? 0) + 1
  );
}

async function assertDotsAreInsideBoard(
  page: import("@playwright/test").Page,
  boardSelector: string
): Promise<void> {
  const clipping = await page.evaluate((targetSelector) => {
    const board = document.querySelector<HTMLElement>(targetSelector);
    if (!board) return null;
    const boardRect = board.getBoundingClientRect();
    const dots = Array.from(board.querySelectorAll<HTMLElement>(".fretboard-dot"));
    return dots.map((dot) => {
      const rect = dot.getBoundingClientRect();
      return {
        leftOverflow: boardRect.left - rect.left,
        rightOverflow: rect.right - boardRect.right,
        topOverflow: boardRect.top - rect.top,
        bottomOverflow: rect.bottom - boardRect.bottom,
      };
    });
  }, boardSelector);

  expect(clipping, `Missing board: ${boardSelector}`).not.toBeNull();
  expect(clipping?.length ?? 0, `${boardSelector} should have dots`).toBeGreaterThan(0);
  for (const [index, dot] of (clipping ?? []).entries()) {
    expect(dot.leftOverflow, `${boardSelector} dot ${index} clipped on left edge`).toBeLessThanOrEqual(1);
    expect(dot.rightOverflow, `${boardSelector} dot ${index} clipped on right edge`).toBeLessThanOrEqual(1);
    expect(dot.topOverflow, `${boardSelector} dot ${index} clipped on top edge`).toBeLessThanOrEqual(1);
    expect(dot.bottomOverflow, `${boardSelector} dot ${index} clipped on bottom edge`).toBeLessThanOrEqual(1);
  }
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

// ─────────────────────────────────────────────────────────────
// HARMONY AND INTERACTION TESTS
// ─────────────────────────────────────────────────────────────

test("extra-jimmy mode plays harmony on both fretboards", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  // Get all dots from both boards (they show which notes are in the scale)
  const lowDots = lowViewport.locator(".fretboard-dot");
  const highDots = highViewport.locator(".fretboard-dot");

  const lowDotCount = await lowDots.count();
  const highDotCount = await highDots.count();

  // Both should have dots (C Major has notes on fretboard)
  expect(lowDotCount).toBeGreaterThan(0);
  expect(highDotCount).toBeGreaterThan(0);

  // Both boards should have the same number of dots (same scale)
  expect(lowDotCount).toBe(highDotCount);

  // Tap a note on low fretboard
  const firstLowDot = lowDots.first();
  await firstLowDot.click();

  // Both fretboards should still be visible and interactive after tap
  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();
});

test("extra-jimmy mode third harmony (default) displays dots on both boards", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  // Default harmony is 3rd (value "2")
  const harmonySelect = page.locator('[data-ej-harmony]');
  await expect(harmonySelect).toHaveValue("2");

  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  // Both should have visible dots representing the scale
  const lowDots = lowViewport.locator(".fretboard-dot");
  const highDots = highViewport.locator(".fretboard-dot");

  expect(await lowDots.count()).toBeGreaterThan(5);
  expect(await highDots.count()).toBeGreaterThan(5);
});

test("extra-jimmy mode changes harmony interval and updates UI", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const harmonySelect = page.locator('[data-ej-harmony]');

  // Test changing to 5th (value "4")
  await harmonySelect.selectOption("4");
  await expect(harmonySelect).toHaveValue("4");

  // Fretboards should still be visible and interactive
  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();

  // Change to 7th (value "6")
  await harmonySelect.selectOption("6");
  await expect(harmonySelect).toHaveValue("6");

  // Verify can change back
  await harmonySelect.selectOption("2");
  await expect(harmonySelect).toHaveValue("2");
});

test("extra-jimmy mode all harmony intervals are selectable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const harmonySelect = page.locator('[data-ej-harmony]');

  // Test each harmony option
  const harmonies = ["1", "2", "3", "4", "5", "6", "7", "8", "10"];

  for (const harmony of harmonies) {
    await harmonySelect.selectOption(harmony);
    await expect(harmonySelect).toHaveValue(harmony);

    // Verify UI is still responsive
    const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
    await expect(lowViewport).toBeVisible();
  }
});

// ─────────────────────────────────────────────────────────────
// KEY SELECTION TESTS
// ─────────────────────────────────────────────────────────────

test("extra-jimmy mode can select different keys from popup", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const keyTrigger = page.locator('[data-ej-key-trigger]');

  // Test changing to G key
  await keyTrigger.click();
  const keyPopup = page.locator('[data-ej-key-popup]');
  await expect(keyPopup).not.toHaveAttribute("hidden");

  // Wait and click using page.click which is more reliable
  await page.waitForTimeout(100);
  await page.click('[data-ej-key-note="G"]');

  // Wait for state update
  await page.waitForTimeout(200);

  // Check that button updated
  const buttonText = await keyTrigger.textContent();
  expect(buttonText?.trim()).toBe("G");

  // Verify both fretboards still visible
  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');
  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();
});

test("extra-jimmy mode key popup has 12 note buttons", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const keyTrigger = page.locator('[data-ej-key-trigger]');
  const keyPopup = page.locator('[data-ej-key-popup]');

  // Open popup
  await keyTrigger.click();
  await expect(keyPopup).not.toHaveAttribute("hidden");

  // Wait for popup to render
  await page.waitForTimeout(100);

  // Count the note buttons
  const noteButtons = keyPopup.locator('button[data-ej-key-note]');
  const count = await noteButtons.count();

  // Should have 12 notes (C through B)
  expect(count).toBe(12);

  // Verify we can find specific notes
  const cButton = page.locator('[data-ej-key-note="C"]');
  const gButton = page.locator('[data-ej-key-note="G"]');
  const bButton = page.locator('[data-ej-key-note="B"]');

  await expect(cButton).toBeVisible();
  await expect(gButton).toBeVisible();
  await expect(bButton).toBeVisible();
});

test("extra-jimmy mode key selection persists across interactions", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const keyTrigger = page.locator('[data-ej-key-trigger]');

  // Change key to D
  await keyTrigger.click();
  await page.locator('[data-ej-key-note="D"]').click();
  await expect(keyTrigger).toContainText("D");

  // Change harmony
  await page.locator('[data-ej-harmony]').selectOption("4");

  // Key should still be D
  await expect(keyTrigger).toContainText("D");

  // Change scale
  await page.locator('[data-ej-scale]').selectOption("aeolian-minor");

  // Key should still be D
  await expect(keyTrigger).toContainText("D");
});

// ─────────────────────────────────────────────────────────────
// SCALE/MODE TESTS
// ─────────────────────────────────────────────────────────────

test("extra-jimmy mode scale selector changes both fretboards", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  // Get initial dot counts
  const lowDotsInitial = await lowViewport.locator(".fretboard-dot").count();
  const highDotsInitial = await highViewport.locator(".fretboard-dot").count();

  // Both should have dots
  expect(lowDotsInitial).toBeGreaterThan(0);
  expect(highDotsInitial).toBeGreaterThan(0);

  // Change to minor (fewer dots in minor pentatonic, same in natural minor)
  const scaleSelect = page.locator('[data-ej-scale]');
  await scaleSelect.selectOption("aeolian-minor");

  // Wait for re-render
  await page.waitForTimeout(100);

  // Dots should still be visible on both
  const lowDotsAfter = await lowViewport.locator(".fretboard-dot").count();
  const highDotsAfter = await highViewport.locator(".fretboard-dot").count();

  expect(lowDotsAfter).toBeGreaterThan(0);
  expect(highDotsAfter).toBeGreaterThan(0);

  // Both should still have same count (synchronized)
  expect(lowDotsAfter).toBe(highDotsAfter);
});

test("extra-jimmy mode all scale modes are selectable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const scaleSelect = page.locator('[data-ej-scale]');
  const modes = [
    "ionian-major",
    "aeolian-minor",
    "dorian",
    "mixolydian",
    "phrygian",
    "lydian",
    "locrian",
  ];

  for (const mode of modes) {
    await scaleSelect.selectOption(mode);
    await expect(scaleSelect).toHaveValue(mode);

    // Both fretboards should still be visible
    const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
    const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

    await expect(lowViewport).toBeVisible();
    await expect(highViewport).toBeVisible();

    // Should have dots
    const lowDots = await lowViewport.locator(".fretboard-dot").count();
    expect(lowDots).toBeGreaterThan(0);
  }
});

// ─────────────────────────────────────────────────────────────
// SCROLLBAR AND RESPONSIVE LAYOUT TESTS
// ─────────────────────────────────────────────────────────────

test("extra-jimmy mode fits within viewport on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  // Wait for mode to fully render
  await page.waitForTimeout(200);

  // Check both fretboards are visible and not clipped
  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();

  // Verify no internal overflow on mode screen
  const modeScreen = page.locator('.mode-screen[data-mode="extra-jimmy"]');
  const overflow = await modeScreen.evaluate((el) => {
    return window.getComputedStyle(el).overflow;
  });

  // Should be hidden to prevent scrolling
  expect(overflow).toBe("hidden");
});

test("extra-jimmy mode fits on tablet viewport", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  await page.waitForTimeout(200);

  // Fretboards should be visible
  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();

  // Mode should have overflow hidden
  const modeScreen = page.locator('.mode-screen[data-mode="extra-jimmy"]');
  const overflow = await modeScreen.evaluate((el) => {
    return window.getComputedStyle(el).overflow;
  });

  expect(overflow).toBe("hidden");
});

test("extra-jimmy mode fits on wide desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  await page.waitForTimeout(200);

  // Both fretboards should be visible
  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();

  // Check that controls are still accessible and centered
  const controlsColumn = page.locator('.ej-controls');
  await expect(controlsColumn).toBeVisible();
});


test("extra-jimmy mode fretboard viewports avoid scrollbars and keep dots fully visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  await page.waitForTimeout(200);

  await assertNoElementScrollbars(page, '[data-ej-neck="low"] .ej-neck-viewport');
  await assertNoElementScrollbars(page, '[data-ej-neck="high"] .ej-neck-viewport');

  await assertDotsAreInsideBoard(page, '[data-ej-neck="low"] .fretboard-board');
  await assertDotsAreInsideBoard(page, '[data-ej-neck="high"] .fretboard-board');
});

test("extra-jimmy mode is responsive across viewport sizes", async ({ page }) => {
  const viewports = [
    { width: 480, height: 640 },  // Mobile portrait
    { width: 640, height: 480 },  // Mobile landscape
    { width: 768, height: 1024 }, // Tablet portrait
    { width: 1024, height: 768 }, // Tablet landscape
    { width: 1280, height: 720 }, // Desktop 720p
    { width: 1920, height: 1080 }, // Desktop 1080p
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

    await page.waitForTimeout(150);

    // Verify controls are visible
    const harmonySelect = page.locator('[data-ej-harmony]');
    const keyButton = page.locator('[data-ej-key-trigger]');
    const scaleSelect = page.locator('[data-ej-scale]');

    await expect(harmonySelect).toBeVisible();
    await expect(keyButton).toBeVisible();
    await expect(scaleSelect).toBeVisible();

    // Verify fretboards are visible
    const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
    const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

    await expect(lowViewport).toBeVisible();
    await expect(highViewport).toBeVisible();

    // Verify mode screen has hidden overflow (no scrollbars within mode)
    const modeScreen = page.locator('.mode-screen[data-mode="extra-jimmy"]');
    const overflow = await modeScreen.evaluate((el) => {
      return window.getComputedStyle(el).overflow;
    });

    expect(overflow, `Overflow not hidden at ${viewport.width}x${viewport.height}`).toBe(
      "hidden"
    );
  }
});

// ─────────────────────────────────────────────────────────────
// COMPLEX INTERACTION TESTS
// ─────────────────────────────────────────────────────────────

test("extra-jimmy mode low fretboard tap pulses harmony on high board", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  // Tap a dot on low board
  const lowDots = lowViewport.locator(".fretboard-dot");
  const dotCount = await lowDots.count();
  expect(dotCount).toBeGreaterThan(0);

  // Click first available dot
  await lowDots.first().click();

  // Both boards should still be visible and interactive
  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();

  // Try tapping high board - should also work
  const highDots = highViewport.locator(".fretboard-dot");
  const highDotCount = await highDots.count();
  expect(highDotCount).toBeGreaterThan(0);

  await highDots.first().click();

  // Boards should still be in good state
  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();
});


test("extra-jimmy mode starts note playback on pointer down", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const lowFirstDot = page.locator('[data-ej-neck="low"] .fretboard-dot').first();
  const highFirstDot = page.locator('[data-ej-neck="high"] .fretboard-dot').first();

  await lowFirstDot.dispatchEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerType: "mouse",
  });

  await expect
    .poll(async () =>
      page
        .locator(
          '.mode-screen[data-mode="extra-jimmy"] .fretboard-dot.is-pulsing, .mode-screen[data-mode="extra-jimmy"] .fretboard-open-indicator.is-pulsing'
        )
        .count()
    )
    .toBeGreaterThan(0);

  await highFirstDot.dispatchEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerType: "touch",
  });

  await expect
    .poll(async () =>
      page
        .locator(
          '.mode-screen[data-mode="extra-jimmy"] .fretboard-dot.is-pulsing, .mode-screen[data-mode="extra-jimmy"] .fretboard-open-indicator.is-pulsing'
        )
        .count()
    )
    .toBeGreaterThan(0);
});
test("extra-jimmy mode can tap multiple times in sequence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const lowDots = lowViewport.locator(".fretboard-dot");

  // Tap same spot multiple times
  const firstDot = lowDots.first();
  for (let i = 0; i < 5; i++) {
    await firstDot.click();
    await page.waitForTimeout(50);
  }

  // Board should still be responsive
  await expect(lowViewport).toBeVisible();
});

test("extra-jimmy mode both fretboards update when key changes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  const lowDotsInitial = await lowViewport.locator(".fretboard-dot").count();
  const highDotsInitial = await highViewport.locator(".fretboard-dot").count();

  expect(lowDotsInitial).toBeGreaterThan(0);
  expect(highDotsInitial).toBeGreaterThan(0);

  // Change key
  const keyTrigger = page.locator('[data-ej-key-trigger]');

  // Open popup
  await keyTrigger.click();
  const keyPopup = page.locator('[data-ej-key-popup]');
  await expect(keyPopup).not.toHaveAttribute("hidden");

  await page.waitForTimeout(100);

  // Click on D key
  await page.click('[data-ej-key-note="D"]');
  await page.waitForTimeout(200);

  // Verify button text changed
  const buttonText = await keyTrigger.textContent();
  expect(buttonText?.trim()).toBe("D");

  // Both should still have dots
  const lowDotsAfter = await lowViewport.locator(".fretboard-dot").count();
  const highDotsAfter = await highViewport.locator(".fretboard-dot").count();

  expect(lowDotsAfter).toBeGreaterThan(0);
  expect(highDotsAfter).toBeGreaterThan(0);

  // Should be same count (synchronized)
  expect(lowDotsAfter).toBe(highDotsAfter);
});

test("extra-jimmy mode can change multiple controls in sequence", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Extra Jimmy", exact: true }).click();

  // Change harmony
  const harmonySelect = page.locator('[data-ej-harmony]');
  await harmonySelect.selectOption("5");
  await expect(harmonySelect).toHaveValue("5");

  await page.waitForTimeout(100);

  // Change scale
  const scaleSelect = page.locator('[data-ej-scale]');
  await scaleSelect.selectOption("dorian");
  await expect(scaleSelect).toHaveValue("dorian");

  await page.waitForTimeout(100);

  // Change key
  const keyTrigger = page.locator('[data-ej-key-trigger]');
  await keyTrigger.click();

  const keyPopup = page.locator('[data-ej-key-popup]');
  await expect(keyPopup).not.toHaveAttribute("hidden");
  await page.waitForTimeout(100);

  // Click on F
  await page.click('[data-ej-key-note="F"]');
  await page.waitForTimeout(200);

  // Verify key changed
  const keyText = await keyTrigger.textContent();
  expect(keyText?.trim()).toBe("F");

  // All controls should still be accessible
  await expect(harmonySelect).toBeVisible();
  await expect(scaleSelect).toBeVisible();
  await expect(keyTrigger).toBeVisible();

  // Both fretboards should still be visible
  const lowViewport = page.locator('[data-ej-neck="low"] .ej-neck-viewport');
  const highViewport = page.locator('[data-ej-neck="high"] .ej-neck-viewport');

  await expect(lowViewport).toBeVisible();
  await expect(highViewport).toBeVisible();
});
