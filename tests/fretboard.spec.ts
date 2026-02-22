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
  await expect(page.locator('#fretboard-characteristic option[value="suspended-fourth"]')).toBeVisible();

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
