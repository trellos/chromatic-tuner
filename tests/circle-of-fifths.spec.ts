import { expect, test, type Locator } from "@playwright/test";

async function getDetailPivotDrift(panel: Locator) {
  return panel.evaluate((element) => {
    const detail = element.querySelector(".cof-detail") as SVGGElement | null;
    if (!detail) return { dx: 999, dy: 999, missing: true };
    const matrix = detail.transform.baseVal.consolidate()?.matrix;
    if (!matrix) return { dx: 999, dy: 999, missing: true };
    const cx = 500;
    const cy = 500;
    const x = matrix.a * cx + matrix.c * cy + matrix.e;
    const y = matrix.b * cx + matrix.d * cy + matrix.f;
    return { dx: Math.abs(x - cx), dy: Math.abs(y - cy), missing: false };
  });
}

async function getDetailIiAngle(panel: Locator): Promise<number> {
  const angle = await panel.evaluate((element) => {
    const path = element.querySelector('.cof-secondary-cell[data-degree="ii"] .cof-secondary-path') as
      | SVGGraphicsElement
      | null;
    if (!path) return Number.NaN;
    const box = path.getBBox();
    const ctm = path.getCTM();
    if (!ctm) return Number.NaN;
    const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(ctm);
    const x = point.x;
    const y = point.y;
    const dx = x - 500;
    const dy = y - 500;
    const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    return deg;
  });
  return angle;
}

async function getDetailTransformAngle(panel: Locator): Promise<number> {
  const angle = await panel.evaluate((element) => {
    const detail = element.querySelector(".cof-detail") as SVGGElement | null;
    if (!detail) return Number.NaN;
    const transform = detail.getAttribute("transform") ?? "";
    const match = /rotate\(([-\d.]+)/.exec(transform);
    if (!match) return Number.NaN;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  });
  return angle;
}

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
  const cCell = noteBar.locator('.cof-note-cell[data-semitone="0"]');
  await cCell.dispatchEvent("click");
  await expect(cCell).toHaveClass(/is-active/);
});

test("selecting a primary note adds roman numerals to note-bar diatonic notes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  const noteBar = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof-note-bar');

  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').click({ force: true }); // C primary

  const cCell = noteBar.locator('.cof-note-cell[data-semitone="0"]');
  const dCell = noteBar.locator('.cof-note-cell[data-semitone="2"]');
  const bCell = noteBar.locator('.cof-note-cell[data-semitone="11"]');
  const dbCell = noteBar.locator('.cof-note-cell[data-semitone="1"]');

  await expect(cCell.locator("xpath=preceding-sibling::*[contains(@class,'cof-note-row-degree')]")).toHaveText("I");
  await expect(dCell.locator("xpath=preceding-sibling::*[contains(@class,'cof-note-row-degree')]")).toHaveText("II");
  await expect(bCell.locator("xpath=preceding-sibling::*[contains(@class,'cof-note-row-degree')]")).toHaveText("VII°");
  await expect(dbCell.locator("xpath=preceding-sibling::*[contains(@class,'cof-note-row-degree')]")).toHaveText("");
  await expect(cCell.locator(".cof-note-cell-label")).toHaveText("C");

  const diatonicAlpha = await cCell.evaluate((el) => {
    const bg = window.getComputedStyle(el as HTMLElement).backgroundColor;
    const match = bg.match(/rgba?\(([^)]+)\)/i);
    if (!match) return 0;
    const parts = match[1]?.split(",").map((part) => Number(part.trim())) ?? [];
    return parts.length >= 4 ? (parts[3] ?? 0) : 1;
  });
  expect(diatonicAlpha).toBeGreaterThanOrEqual(0.5);
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
  await expect(circlePanel.locator(".cof-svg")).toHaveAttribute("viewBox", "0 0 1000 1000");

  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').dblclick({ force: true });
  await expect(circlePanel.locator(".cof-svg")).not.toHaveAttribute("viewBox", "0 0 1000 1000");

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
  await expect(circlePanel.locator(".cof-svg")).toHaveAttribute("viewBox", "0 0 1000 1000");
  await expect(circle.locator(".cof-wedge.is-primary .cof-wedge-label")).toHaveText("C");
  await expect(outerLabels.first()).toHaveText("C");
});

test("zoomed chord mode keeps I/IV/V and inner diatonic wedges inside visible svg bounds", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const circlePanel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = circlePanel.locator(".cof");

  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').click({ force: true });
  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').click({ force: true });
  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').dblclick({ force: true });
  await expect(circle).toHaveClass(/is-chord-mode/);
  await expect(circlePanel.locator(".cof-svg")).not.toHaveAttribute("viewBox", "0 0 1000 1000");

  const visibility = await circlePanel.evaluate((panel) => {
    const svg = panel.querySelector(".cof-svg") as SVGSVGElement | null;
    if (!svg) return { ok: false, missing: ["svg"] as string[] };
    const svgRect = svg.getBoundingClientRect();
    const selectors = [
      '.cof-wedge[data-degree="i"] .cof-wedge-path',
      '.cof-wedge[data-degree="iv"] .cof-wedge-path',
      '.cof-wedge[data-degree="v"] .cof-wedge-path',
      '.cof-secondary-cell[data-degree="ii"] .cof-secondary-path',
      '.cof-secondary-cell[data-degree="iii"] .cof-secondary-path',
      '.cof-secondary-cell[data-degree="vi"] .cof-secondary-path',
      '.cof-dim-cell[data-degree="vii"] .cof-dim-path',
    ];
    const missing: string[] = [];
    const clipped: string[] = [];
    for (const selector of selectors) {
      const target = panel.querySelector(selector) as SVGGraphicsElement | null;
      if (!target) {
        missing.push(selector);
        continue;
      }
      const rect = target.getBoundingClientRect();
      const inside =
        rect.left >= svgRect.left - 4 &&
        rect.right <= svgRect.right + 4 &&
        rect.top >= svgRect.top - 4 &&
        rect.bottom <= svgRect.bottom + 4;
      if (!inside) clipped.push(selector);
    }
    return { ok: missing.length === 0 && clipped.length === 0, missing, clipped };
  });

  expect(visibility.ok, `missing=${visibility.missing.join(",")} clipped=${(visibility as any).clipped?.join(",")}`).toBeTruthy();
});

test("zoomed chord mode keeps primary cluster visible on portrait mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const circlePanel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = circlePanel.locator(".cof");

  await circle.locator('.cof-wedge[data-index="7"] .cof-wedge-path').click({ force: true }); // Db
  await circle.locator('.cof-wedge[data-index="7"] .cof-wedge-path').click({ force: true });
  await circle.locator('.cof-wedge[data-index="7"] .cof-wedge-path').dblclick({ force: true });
  await expect(circle).toHaveClass(/is-chord-mode/);
  await expect(circlePanel.locator(".cof-svg")).not.toHaveAttribute("viewBox", "0 0 1000 1000");

  const clippedSelectors = await circlePanel.evaluate((panel) => {
    const svg = panel.querySelector(".cof-svg") as SVGSVGElement | null;
    if (!svg) return ["svg"] as string[];
    const svgRect = svg.getBoundingClientRect();
    const selectors = [
      '.cof-wedge[data-degree="i"] .cof-wedge-path',
      '.cof-wedge[data-degree="iv"] .cof-wedge-path',
      '.cof-wedge[data-degree="v"] .cof-wedge-path',
      '.cof-secondary-cell[data-degree="ii"] .cof-secondary-path',
      '.cof-secondary-cell[data-degree="iii"] .cof-secondary-path',
      '.cof-secondary-cell[data-degree="vi"] .cof-secondary-path',
      '.cof-dim-cell[data-degree="vii"] .cof-dim-path',
    ];
    const clipped: string[] = [];
    selectors.forEach((selector) => {
      const target = panel.querySelector(selector) as SVGGraphicsElement | null;
      if (!target) {
        clipped.push(selector);
        return;
      }
      const rect = target.getBoundingClientRect();
      const inside =
        rect.left >= svgRect.left - 4 &&
        rect.right <= svgRect.right + 4 &&
        rect.top >= svgRect.top - 4 &&
        rect.bottom <= svgRect.bottom + 4;
      if (!inside) clipped.push(selector);
    });
    return clipped;
  });

  expect(clippedSelectors, `clipped=${clippedSelectors.join(",")}`).toEqual([]);
});

test("outer wedge pointer hold toggles holding class for sustain lifecycle", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const wedge = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof-wedge[data-index="0"]');

  await wedge.dispatchEvent("pointerdown", { pointerId: 21, bubbles: true });
  await expect(wedge).toHaveClass(/is-holding/);
  await wedge.dispatchEvent("pointerup", { pointerId: 21, bubbles: true });
  await expect(wedge).not.toHaveClass(/is-holding/);
});

test("double-tapping inside the circle cycles instruments and shows the instrument name indicator", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();

  const circlePanel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const svg = circlePanel.locator(".cof-svg");
  const banner = circlePanel.locator(".cof-mode-banner").first();
  const svgBox = await svg.boundingBox();
  expect(svgBox).not.toBeNull();

  await svg.dblclick({
    position: { x: (svgBox?.width ?? 0) / 2, y: (svgBox?.height ?? 0) / 2 },
    force: true,
  });
  await expect(banner).toContainText("ELECTRIC GUITAR");
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
  const dbCell = noteBar.locator('.cof-note-cell[data-semitone="1"]');

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


test("concentric center drift stays below 0.1px across primary notes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();

  const panel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = panel.locator('.cof');

  for (const index of [0, 3, 7, 9, 11]) {
    await circle.locator(`.cof-wedge[data-index="${index}"] .cof-wedge-path`).click({ force: true });
    const drift = await getDetailPivotDrift(panel);
    expect(drift.missing).toBeFalsy();
    expect(drift.dx).toBeLessThan(0.1);
    expect(drift.dy).toBeLessThan(0.1);
  }
});

test("F chord mode concentric center drift stays below 0.1px through zoom on/off", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();

  const panel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = panel.locator('.cof');
  const svg = panel.locator('.cof-svg');

  for (const index of [11, 0, 10, 9, 7]) {
    const wedgePath = circle.locator(`.cof-wedge[data-index="${index}"] .cof-wedge-path`);
    await wedgePath.click({ force: true });
    await wedgePath.click({ force: true });
    await wedgePath.dblclick({ force: true });
    await expect(circle).toHaveClass(/is-chord-mode/);

    const drift = await getDetailPivotDrift(panel);
    expect(drift.missing).toBeFalsy();
    expect(drift.dx).toBeLessThan(0.1);
    expect(drift.dy).toBeLessThan(0.1);

    await svg.click({ position: { x: 8, y: 8 }, force: true });
    await expect(circle).not.toHaveClass(/is-chord-mode/);
  }
});

test("inner detail rotates to the new primary note", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Circle of Fifths" }).click();
  const panel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = panel.locator('.cof');

  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').click({ force: true }); // C
  await expect(circle.locator('.cof-wedge.is-primary')).toHaveAttribute("data-index", "0");
  const cAngle = await getDetailTransformAngle(panel);
  expect(Number.isFinite(cAngle)).toBeTruthy();

  await circle.locator('.cof-wedge[data-index="11"] .cof-wedge-path').click({ force: true }); // F
  await expect(circle.locator('.cof-wedge.is-primary')).toHaveAttribute("data-index", "11");
  const fAngle = await getDetailTransformAngle(panel);
  expect(Number.isFinite(fAngle)).toBeTruthy();
  const delta = fAngle - cAngle;
  expect(delta).toBeLessThan(-28.5);
  expect(delta).toBeGreaterThan(-31.5);
});


