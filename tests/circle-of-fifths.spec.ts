import { expect, test } from "@playwright/test";

test("circle mode renders twelve outer wedges and keeps the wheel inside card bounds", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();

  const circleScreen = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  const noteBar = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof-note-bar');
  await expect(circleScreen).toHaveClass(/is-active/);
  await expect(circle.locator(".cof-wedge")).toHaveCount(12);
  await expect(noteBar.locator(".cof-note-cell")).toHaveCount(12);
  await expect(noteBar.locator(".cof-note-cell-label").first()).toHaveText("A");
  await expect(noteBar.locator(".cof-note-cell-label").nth(4)).toHaveText("Db");
  await expect(circle).not.toHaveClass(/has-primary/);

  const [screenBox, circleBox] = await Promise.all([
    circleScreen.boundingBox(),
    circle.boundingBox(),
  ]);
  expect(screenBox).not.toBeNull();
  expect(circleBox).not.toBeNull();
  expect((circleBox?.width ?? 0) <= (screenBox?.width ?? 0) + 1).toBeTruthy();
  expect((circleBox?.height ?? 0) <= (screenBox?.height ?? 0) + 1).toBeTruthy();
});

test("selecting F shows inner corner roman numerals and center chord labels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  await circle.locator('.cof-wedge[data-index="11"] .cof-wedge-path').click({ force: true });

  await expect(circle).toHaveClass(/has-primary/);
  await expect(circle.locator(".cof-secondary-label").nth(0)).toHaveText("Gm");
  await expect(circle.locator(".cof-secondary-label").nth(1)).toHaveText("Am");
  await expect(circle.locator(".cof-secondary-label").nth(2)).toHaveText("Dm");
  await expect(circle.locator(".cof-dim-label")).toHaveText("E°");

  await expect(circle.locator(".cof-secondary-degree-label").nth(0)).toHaveText("ii");
  await expect(circle.locator(".cof-secondary-degree-label").nth(1)).toHaveText("iii");
  await expect(circle.locator(".cof-secondary-degree-label").nth(2)).toHaveText("vi");
  await expect(circle.locator(".cof-dim-degree-label")).toHaveText("vii°");

  const outerDegrees = circle.locator(".cof-degree-label");
  await expect(outerDegrees.nth(11)).toHaveText("I");
  await expect(outerDegrees.nth(10)).toHaveText("IV");
  await expect(outerDegrees.nth(0)).toHaveText("V");
  await expect(outerDegrees.nth(1)).toHaveText("");
  await expect(outerDegrees.nth(9)).toHaveText("");

  const spans = await circle.locator('.cof-secondary-cell').evaluateAll((cells) =>
    cells.map((cell) => Number((cell as SVGGElement).getAttribute('data-span-deg') ?? '0'))
  );
  expect(spans).toEqual([24, 24, 24]);

  const xPositions = await circle.locator(".cof-secondary-label").evaluateAll((labels) =>
    labels.map((label) => Number((label as SVGTextElement).getAttribute("x") ?? "0"))
  );
  expect(xPositions[0]! < xPositions[1]!).toBeTruthy();
  expect(xPositions[1]! < xPositions[2]!).toBeTruthy();
});

test("double-clicking vi enters minor mode and double-clicking III exits to major", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');

  await circle.locator('.cof-wedge[data-index="11"] .cof-wedge-path').click({ force: true }); // F primary
  await expect(circle.locator('.cof-wedge[data-index="3"] .cof-degree-label')).toHaveText(""); // vi hidden on outer

  await circle.locator('.cof-secondary-cell').nth(2).locator('.cof-secondary-path').dblclick({ force: true }); // inner vi wedge
  await expect(circle.locator('.cof-wedge[data-index="11"] .cof-degree-label')).toHaveText("III");
  await expect(circle.locator('.cof-wedge[data-index="10"] .cof-degree-label')).toHaveText("VI");
  await expect(circle.locator('.cof-wedge[data-index="0"] .cof-degree-label')).toHaveText("VII");
  await expect(circle.locator(".cof-secondary-degree-label").nth(0)).toHaveText("iv");
  await expect(circle.locator(".cof-secondary-degree-label").nth(1)).toHaveText("v");
  await expect(circle.locator(".cof-secondary-degree-label").nth(2)).toHaveText("i");
  await expect(circle.locator(".cof-dim-degree-label")).toHaveText("ii°");

  await circle.locator('.cof-wedge[data-index="11"] .cof-wedge-path').dblclick({ force: true }); // now III
  await expect(circle.locator('.cof-wedge[data-index="11"] .cof-degree-label')).toHaveText("I");
  await expect(circle.locator('.cof-wedge[data-index="10"] .cof-degree-label')).toHaveText("IV");
  await expect(circle.locator('.cof-wedge[data-index="0"] .cof-degree-label')).toHaveText("V");
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
    verticalOverflowPx: element.scrollHeight - element.clientHeight,
  }));
  expect(overflow.horizontal).toBeFalsy();
  expect(overflow.verticalOverflowPx).toBeLessThanOrEqual(24);
});

test("clicking a note-bar cell triggers note activity on that cell", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const noteBar = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof-note-bar');
  const cCell = noteBar.locator('.cof-note-cell').filter({ hasText: "C" }).first();
  await cCell.click({ force: true });
  await expect(cCell).toHaveClass(/is-active/);
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


test("mobile swipe can navigate from fretboard to circle of fifths mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "Mobile Safari", "Touch swipe coverage is mobile-specific.");

  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();
  await expect(page.locator('.mode-screen[data-mode="fretboard"]')).toHaveClass(/is-active/);

  await page.locator(".mode-stage").dispatchEvent("touchstart", {
    touches: [{ identifier: 1, clientX: 320, clientY: 360 }],
    changedTouches: [{ identifier: 1, clientX: 320, clientY: 360 }],
  });
  await page.locator(".mode-stage").dispatchEvent("touchmove", {
    touches: [{ identifier: 1, clientX: 80, clientY: 360 }],
    changedTouches: [{ identifier: 1, clientX: 80, clientY: 360 }],
  });
  await page.locator(".mode-stage").dispatchEvent("touchend", {
    touches: [],
    changedTouches: [{ identifier: 1, clientX: 80, clientY: 360 }],
  });

  await expect(page.locator('.mode-screen[data-mode="circle-of-fifths"]')).toHaveClass(/is-active/);
});

test("mobile Safari can switch tuner visual mode between strobe and circle", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "Mobile Safari", "iOS Safari regression coverage is mobile-specific.");

  await page.goto("/");

  const strobe = page.locator("#strobe-visualizer");
  const host = page.locator("[data-tuner-circle-host]");
  await expect(strobe).toBeVisible();
  await expect(host).toBeHidden();

  await page.getByRole("button", { name: "Circle" }).click();
  await expect(host).toBeVisible();
  await expect(strobe).toBeHidden();

  await page.getByRole("button", { name: "Strobe" }).click();
  await expect(strobe).toBeVisible();
  await expect(host).toBeHidden();
});


test("chord mode requires a primary retap, keeps outer-chord taps, and exits on background tap", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  const circlePanel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');

  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').click({ force: true });
  await expect(circle).not.toHaveClass(/is-chord-mode/);

  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').click({ force: true });
  await expect(circle).toHaveClass(/is-chord-mode/);

  const outerLabels = circle.locator(".cof-wedge-label");
  await expect(outerLabels.first()).toContainText("Cmaj");
  await expect(outerLabels.nth(1)).toContainText("Gmaj");

  await circle.locator('.cof-wedge[data-index="1"] .cof-wedge-path').click({ force: true });
  await expect(circle.locator(".cof-wedge.is-primary .cof-wedge-label")).toContainText("Cmaj");

  const svg = circlePanel.locator(".cof-svg");
  const svgBox = await svg.boundingBox();
  expect(svgBox).not.toBeNull();
  await svg.click({
    position: { x: (svgBox?.width ?? 0) / 2, y: (svgBox?.height ?? 0) / 2 },
    force: true,
  });
  await expect(circle).not.toHaveClass(/is-chord-mode/);
  await expect(circle.locator(".cof-wedge.is-primary .cof-wedge-label")).toHaveText("C");
  await expect(outerLabels.first()).toHaveText("C");
});

test("indicator animation triggers for primary note, chord mode, and minor/major mode transitions", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();

  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  const banners = circle.locator(".cof-mode-banner");
  const firstBanner = banners.first();

  const aWedge = circle.locator('.cof-wedge[data-index="3"]');
  await aWedge.focus();
  await aWedge.press("Enter");
  await expect(circle).toHaveClass(/has-primary/);
  await expect(firstBanner).toHaveClass(/cof-mode-banner--indicator/);
  await expect(firstBanner).toHaveClass(/is-scrolling/);

  await aWedge.press("Enter");
  await expect(circle).toHaveClass(/is-chord-mode/);
  await expect(firstBanner).toContainText("CHORD");

  await circle
    .locator('.cof-secondary-cell')
    .nth(2)
    .locator(".cof-secondary-path")
    .dispatchEvent("dblclick");
  await expect(firstBanner).toContainText("minor");

  await circle.locator('.cof-wedge[data-index="3"] .cof-wedge-path').dispatchEvent("dblclick");
  await expect(firstBanner).toContainText("MAJOR");
});

test("note-bar supports keyboard activation with Enter and Space", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();

  const noteBar = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof-note-bar');
  const dbCell = noteBar.locator('.cof-note-cell').filter({ hasText: "Db" }).first();

  await dbCell.evaluate((element) => {
    const target = element as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await expect(dbCell).toHaveClass(/is-active/);
  await page.waitForTimeout(560);
  await expect(dbCell).not.toHaveClass(/is-active/);

  await dbCell.evaluate((element) => {
    const target = element as HTMLElement;
    target.focus();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
  });
  await expect(dbCell).toHaveClass(/is-active/);
});
