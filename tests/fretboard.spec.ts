import { expect, test } from "@playwright/test";

test("fretboard mode defaults to C major scale with note labels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const fretboard = page.locator('.mode-screen[data-mode="fretboard"]');
  await expect(fretboard).toHaveClass(/is-active/);
  await expect(page.locator('[data-fretboard-root="C"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-fretboard-display="scale"]')).toHaveClass(/is-active/);
  await expect(page.locator("#fretboard-characteristic")).toHaveValue("major");
  await expect(page.locator('[data-fretboard-annotation="notes"]')).toHaveClass(/is-active/);

  const stringLabels = page.locator(".fretboard-string-labels span");
  await expect(stringLabels).toHaveText(["E", "A", "D", "G", "B", "E"]);

  const openIndicators = page.locator(".fretboard-open-indicator");
  await expect(openIndicators).toHaveCount(6);

  const dots = page.locator(".fretboard-dot");
  await expect(dots).toHaveCount(42);
  const labels = await dots.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));
  expect(labels).toContain("C");
  expect(labels).toContain("E");
  expect(labels).toContain("G");
  expect(labels).not.toContain("C#");
});

test("fretboard interaction updates characteristic options and degree labels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  await page.locator('[data-fretboard-display="chord"]').click();
  await expect(page.locator('#fretboard-characteristic option[value="suspended-fourth"]')).toHaveCount(1);

  await page.locator("#fretboard-characteristic").selectOption("suspended-fourth");
  await page.locator('[data-fretboard-annotation="degrees"]').click();
  await expect(page.locator('[data-fretboard-annotation="degrees"]')).toHaveClass(/is-active/);

  const degreeDots = page.locator(".fretboard-dot");
  await expect(page.locator(".fretboard-open-indicator")).toHaveCount(1);
  await expect(degreeDots).toHaveCount(18);
  const degreeLabels = await degreeDots.evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim())
  );
  expect(degreeLabels).toContain("1");
  expect(degreeLabels).toContain("4");
  expect(degreeLabels).toContain("5");
  expect(degreeLabels).not.toContain("3");

  await page.locator('[data-fretboard-root="C"]').click();
  await page.locator('[data-fretboard-display="scale"]').click();
  await page.locator("#fretboard-characteristic").selectOption("major");
  await page.locator('[data-fretboard-annotation="notes"]').click();

  const noteLabels = await page.locator(".fretboard-dot").evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim())
  );
  expect(noteLabels).toContain("C");
  expect(noteLabels).toContain("F");
  expect(noteLabels).not.toContain("C#");
});

test("fretboard note dots expose midi metadata and are tappable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const firstDot = page.locator(".fretboard-dot").first();
  await expect(firstDot).toHaveAttribute("data-midi", /^\d+$/);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await firstDot.click();
  await page.waitForTimeout(150);
  expect(pageErrors).toEqual([]);
});

test("fretboard open-string indicators expose midi metadata and are tappable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const firstOpen = page.locator(".fretboard-open-indicator").first();
  await expect(firstOpen).toHaveAttribute("data-midi", /^\d+$/);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await firstOpen.click();
  await page.waitForTimeout(150);
  expect(pageErrors).toEqual([]);
});

test("fretboard play button ramps seigaiha randomness and returns to zero", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "debug randomness assertion is Chromium-only");
  await page.goto("/?debug=1");
  await page.getByRole("tab", { name: "Fretboard" }).click();
  await page.locator('[data-fretboard-display="chord"]').click();

  const playButton = page.locator("[data-fretboard-play]");
  await expect(playButton).toBeVisible();
  await expect(playButton).toHaveText("Play");

  const readRandomness = async () => {
    const text = await page.locator(".seigaiha-debug-value").first().textContent();
    const parsed = Number.parseFloat((text ?? "0").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };

  await playButton.click();
  await expect.poll(readRandomness, { timeout: 1200 }).toBeGreaterThan(0.6);
  await expect.poll(readRandomness, { timeout: 2600 }).toBeLessThan(0.08);
  await expect(playButton).toHaveText("Play");
});


test("fretboard mobile portrait fits all controls and reaches fret 12", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "Mobile Safari", "mobile portrait coverage only");

  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const fretboardScreen = page.locator('.mode-screen[data-mode="fretboard"]');
  await expect(fretboardScreen).toHaveClass(/is-active/);

  const overflow = await fretboardScreen.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    hasOverflow: element.scrollHeight > element.clientHeight + 1,
  }));
  expect(overflow.hasOverflow).toBeFalsy();

  await expect(page.locator('.fretboard-controls')).toBeVisible();
  await expect(page.locator('.fretboard-dot[data-fret="12"]').first()).toBeVisible();
  const twelfthInlays = page.locator('.fretboard-inlay[data-fret="12"]');
  await expect(twelfthInlays).toHaveCount(2);
  await expect(twelfthInlays.nth(0)).toBeVisible();
  await expect(twelfthInlays.nth(1)).toBeVisible();
});
