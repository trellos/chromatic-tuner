import { expect, test } from "@playwright/test";

test("circle mode renders twelve outer wedges and keeps the wheel inside card bounds", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();

  const circleScreen = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  await expect(circleScreen).toHaveClass(/is-active/);
  await expect(page.locator(".cof-wedge")).toHaveCount(12);
  await expect(page.locator(".cof.has-primary")).toHaveCount(0);

  const [screenBox, circleBox] = await Promise.all([
    circleScreen.boundingBox(),
    circle.boundingBox(),
  ]);
  expect(screenBox).not.toBeNull();
  expect(circleBox).not.toBeNull();
  expect((circleBox?.width ?? 0) <= (screenBox?.width ?? 0) + 1).toBeTruthy();
  expect((circleBox?.height ?? 0) <= (screenBox?.height ?? 0) + 1).toBeTruthy();
});

test("selecting F places II III VI wedges under Bb F C respectively", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  await page.getByRole("button", { name: "Primary note F", exact: true }).click();

  await expect(page.locator(".cof.has-primary")).toHaveCount(1);
  await expect(page.locator(".cof-secondary-label").nth(0)).toHaveText("Gm");
  await expect(page.locator(".cof-secondary-label").nth(1)).toHaveText("Am");
  await expect(page.locator(".cof-secondary-label").nth(2)).toHaveText("Dm");
  await expect(page.locator(".cof-dim-label")).toHaveText("Edim");

  const spans = await page.locator('.cof-secondary-cell').evaluateAll((cells) =>
    cells.map((cell) => Number((cell as SVGGElement).getAttribute('data-span-deg') ?? '0'))
  );
  expect(spans).toEqual([30, 30, 30]);

  const xPositions = await page.locator(".cof-secondary-label").evaluateAll((labels) =>
    labels.map((label) => Number((label as SVGTextElement).getAttribute("x") ?? "0"))
  );
  expect(xPositions[0]! < xPositions[1]!).toBeTruthy();
  expect(xPositions[1]! < xPositions[2]!).toBeTruthy();
});

test("tuner circle toggle renders wedge-based circle without overflow", async ({ page }) => {
  await page.goto("/");

  const strobe = page.locator("#strobe-visualizer");
  const host = page.locator("[data-tuner-circle-host]");
  await expect(strobe).toBeVisible();
  await expect(host).toBeHidden();

  await page.getByRole("button", { name: "Circle" }).click();
  await expect(host).toBeVisible();
  await expect(strobe).toBeHidden();
  await expect(page.locator('[data-tuner-circle-host] .cof-wedge')).toHaveCount(12);

  const overflow = await host.evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth + 1,
    vertical: element.scrollHeight > element.clientHeight + 1,
  }));
  expect(overflow.horizontal).toBeFalsy();
  expect(overflow.vertical).toBeFalsy();
});

test("circle mode remains visible in portrait mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();

  const circleScreen = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  await expect(circleScreen).toHaveClass(/is-active/);
  await expect(page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof')).toBeVisible();

  const overflow = await circleScreen.evaluate((element) => ({
    needsHorizontalScroll: element.scrollWidth > element.clientWidth + 1,
  }));

  expect(overflow.needsHorizontalScroll).toBeFalsy();
});
