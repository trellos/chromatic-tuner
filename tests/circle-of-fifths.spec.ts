import { expect, test, type Locator, type Page } from "@playwright/test";
import { switchMode } from "./helpers/mode.js";

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

async function tapOutsideCircleRadius(svg: Locator): Promise<void> {
  await svg.evaluate((node) => {
    const svgEl = node as SVGSVGElement;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const viewBoxTokens = (svgEl.getAttribute("viewBox") ?? "0 0 1000 1000")
      .split(/\s+/)
      .map((token) => Number(token));
    const viewBox = {
      x: Number.isFinite(viewBoxTokens[0]) ? (viewBoxTokens[0] as number) : 0,
      y: Number.isFinite(viewBoxTokens[1]) ? (viewBoxTokens[1] as number) : 0,
      width: Number.isFinite(viewBoxTokens[2]) ? (viewBoxTokens[2] as number) : 1000,
      height: Number.isFinite(viewBoxTokens[3]) ? (viewBoxTokens[3] as number) : 1000,
    };
    const candidates = [
      { clientX: rect.left + 8, clientY: rect.top + 8 },
      { clientX: rect.right - 8, clientY: rect.top + 8 },
      { clientX: rect.left + 8, clientY: rect.bottom - 8 },
      { clientX: rect.right - 8, clientY: rect.bottom - 8 },
      { clientX: rect.left + rect.width / 2, clientY: rect.top + 8 },
      { clientX: rect.left + rect.width / 2, clientY: rect.bottom - 8 },
      { clientX: rect.left + 8, clientY: rect.top + rect.height / 2 },
      { clientX: rect.right - 8, clientY: rect.top + rect.height / 2 },
    ];
    const toSvg = (clientX: number, clientY: number) => ({
      x: viewBox.x + ((clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width,
      y: viewBox.y + ((clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height,
    });
    let chosen = candidates[0] ?? { clientX: rect.left + 8, clientY: rect.top + 8 };
    let maxDistance = -1;
    candidates.forEach((candidate) => {
      const point = toSvg(candidate.clientX, candidate.clientY);
      const distance = Math.hypot(point.x - 500, point.y - 500);
      if (distance > maxDistance) {
        maxDistance = distance;
        chosen = candidate;
      }
    });
    svgEl.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: chosen.clientX,
        clientY: chosen.clientY,
      })
    );
  });
}

async function clickOuterZone(
  page: Page,
  panel: Locator,
  wedgeIndex: number,
  zone: "note" | "chord"
): Promise<void> {
  const point = await panel.evaluate(
    (element, { index, tapZone }) => {
      const root = element as HTMLElement;
      const svg = root.querySelector<SVGSVGElement>(".cof-svg");
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const centerDeg = index * 30;
      const angleDeg = centerDeg + (tapZone === "note" ? -10 : 10);
      const angleRad = ((angleDeg - 90) * Math.PI) / 180;
      const radius = 385;
      const svgX = 500 + radius * Math.cos(angleRad);
      const svgY = 500 + radius * Math.sin(angleRad);
      return {
        clientX: rect.left + (svgX / 1000) * rect.width,
        clientY: rect.top + (svgY / 1000) * rect.height,
      };
    },
    { index: wedgeIndex, tapZone: zone }
  );
  if (!point) return;
  await page.mouse.click(point.clientX, point.clientY);
}

async function dispatchOuterZoneClick(
  panel: Locator,
  wedgeIndex: number,
  zone: "note" | "chord"
): Promise<void> {
  await panel.evaluate(
    (element, { index, tapZone }) => {
      const root = element as HTMLElement;
      const svg = root.querySelector<SVGSVGElement>(".cof-svg");
      const wedge = root.querySelector<SVGGElement>(`.cof-wedge[data-index="${index}"]`);
      if (!svg || !wedge) return;
      const rect = svg.getBoundingClientRect();
      const centerDeg = index * 30;
      const angleDeg = centerDeg + (tapZone === "note" ? -10 : 10);
      const angleRad = ((angleDeg - 90) * Math.PI) / 180;
      const radius = 385;
      const svgX = 500 + radius * Math.cos(angleRad);
      const svgY = 500 + radius * Math.sin(angleRad);
      const clientX = rect.left + (svgX / 1000) * rect.width;
      const clientY = rect.top + (svgY / 1000) * rect.height;
      wedge.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        })
      );
    },
    { index: wedgeIndex, tapZone: zone }
  );
}

test("circle mode renders twelve outer wedges and keeps the wheel inside card bounds", async ({
  page,
}) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

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

test("note-bar flat labels keep lowercase b", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");
  const noteBarLabels = page.locator(
    '.mode-screen[data-mode="circle-of-fifths"] .cof-note-cell-label'
  );
  await expect(noteBarLabels.nth(1)).toHaveText("Bb");
  await expect(noteBarLabels.nth(4)).toHaveText("Db");
  await expect(noteBarLabels.nth(6)).toHaveText("Eb");
  await expect(noteBarLabels.nth(11)).toHaveText("Ab");
  await expect(noteBarLabels.nth(4)).toHaveCSS("text-transform", "none");
  const flatTexts = await noteBarLabels.evaluateAll((nodes) =>
    nodes
      .map((node) => node.textContent ?? "")
      .filter((text) => text.includes("b"))
  );
  expect(flatTexts).toEqual(["Bb", "Db", "Eb", "Ab"]);
});

test("selecting F shows current inner chord labels and roman numerals", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  await clickOuterZone(page, circle, 11, "chord");

  await expect(circle).toHaveClass(/has-primary/);
  await expect(circle.locator(".cof-secondary-label").nth(0)).toHaveText("Gm");
  await expect(circle.locator(".cof-secondary-label").nth(1)).toHaveText("Am");
  await expect(circle.locator(".cof-secondary-label").nth(2)).toHaveText("Dm");
  await expect(circle.locator(".cof-dim-label")).toHaveText("E°");
  await expect(circle.locator(".cof-secondary-degree-label").nth(0)).toHaveText("ii");
  await expect(circle.locator(".cof-secondary-degree-label").nth(1)).toHaveText("iii");
  await expect(circle.locator(".cof-secondary-degree-label").nth(2)).toHaveText("vi");
  await expect(circle.locator(".cof-dim-degree-label")).toHaveText("vii°");
});

test("outer wedge tap zones emit current note/chord behavior and keep IV/V from moving primary", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const win = window as typeof window & {
      __tunaUiObjects?: {
        createCircleOfFifthsUi?: (
          container: HTMLElement,
          options?: {
            onOuterTap?: (note: {
              index: number;
              zone: "note" | "chord";
              movesPrimary: boolean;
            }) => void;
          }
        ) => { setPrimaryByLabel: (label: string | null) => void; destroy: () => void };
      };
      __testCircleUi?: { setPrimaryByLabel: (label: string | null) => void; destroy: () => void } | undefined;
      __testCircleTapEvents?: Array<{ index: number; zone: "note" | "chord"; movesPrimary: boolean }>;
    };
    win.__testCircleUi?.destroy();
    document.querySelector("[data-test-circle-host]")?.remove();
    const host = document.createElement("div");
    host.setAttribute("data-test-circle-host", "1");
    document.body.appendChild(host);
    win.__testCircleTapEvents = [];
    win.__testCircleUi = win.__tunaUiObjects?.createCircleOfFifthsUi?.(host, {
      onOuterTap: (note) => {
        win.__testCircleTapEvents?.push({
          index: note.index,
          zone: note.zone,
          movesPrimary: note.movesPrimary,
        });
      },
    });
    win.__testCircleUi?.setPrimaryByLabel("C");
  });

  const circle = page.locator('[data-test-circle-host] .cof');
  await expect(circle.locator(".cof-wedge.is-primary")).toHaveAttribute("data-index", "0");

  await page.locator('[data-test-circle-host] .cof-wedge[data-index="1"]').focus();
  await page.keyboard.press("Enter");
  await expect(circle.locator(".cof-wedge.is-primary")).toHaveAttribute("data-index", "0");

  await page.locator('[data-test-circle-host] .cof-wedge[data-index="11"]').focus();
  await page.keyboard.press("Enter");
  await expect(circle.locator(".cof-wedge.is-primary")).toHaveAttribute("data-index", "0");

  await page.locator('[data-test-circle-host] .cof-wedge[data-index="3"]').focus();
  await page.keyboard.press("Enter");
  await expect(circle.locator(".cof-wedge.is-primary")).toHaveAttribute("data-index", "3");

  await dispatchOuterZoneClick(circle, 2, "note");
  await expect(circle.locator(".cof-wedge.is-primary")).toHaveAttribute("data-index", "3");

  const tapEvents = await page.evaluate(() => {
    const win = window as typeof window & {
      __testCircleTapEvents?: Array<{ index: number; zone: "note" | "chord"; movesPrimary: boolean }>;
      __testCircleUi?: { destroy: () => void };
    };
    const events = [...(win.__testCircleTapEvents ?? [])];
    win.__testCircleUi?.destroy();
    delete win.__testCircleUi;
    delete win.__testCircleTapEvents;
    document.querySelector("[data-test-circle-host]")?.remove();
    return events;
  });

  expect(tapEvents).toEqual([
    { index: 1, zone: "chord", movesPrimary: false },
    { index: 11, zone: "chord", movesPrimary: false },
    { index: 3, zone: "chord", movesPrimary: true },
    { index: 2, zone: "note", movesPrimary: false },
  ]);
});

test("background tap outside the circle clears the primary selection", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

  const panel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = panel.locator(".cof");
  await clickOuterZone(page, circle, 0, "chord");
  await expect(circle).toHaveClass(/has-primary/);

  await tapOutsideCircleRadius(panel.locator(".cof-svg"));
  await expect(circle).not.toHaveClass(/has-primary/);
  await expect(circle.locator(".cof-wedge.is-primary")).toHaveCount(0);
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
  await switchMode(page, "Circle of Fifths");
  const noteBar = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof-note-bar');
  const cCell = noteBar.locator('.cof-note-cell[data-semitone="0"]');
  await cCell.dispatchEvent("pointerdown", { pointerId: 77, bubbles: true });
  await expect(cCell).toHaveClass(/is-active/);
  await cCell.dispatchEvent("pointerup", { pointerId: 77, bubbles: true });
  await expect(cCell).not.toHaveClass(/is-active/);
});

test("selecting a primary note adds current roman numerals to note-bar diatonic notes", async ({
  page,
}) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");
  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  const noteBar = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof-note-bar');

  await clickOuterZone(page, circle, 0, "chord");

  const cCell = noteBar.locator('.cof-note-cell[data-semitone="0"]');
  const dCell = noteBar.locator('.cof-note-cell[data-semitone="2"]');
  const bCell = noteBar.locator('.cof-note-cell[data-semitone="11"]');
  const dbCell = noteBar.locator('.cof-note-cell[data-semitone="1"]');

  await expect(cCell.locator("xpath=preceding-sibling::*[contains(@class,'cof-note-row-degree')]")).toHaveText("I");
  await expect(dCell.locator("xpath=preceding-sibling::*[contains(@class,'cof-note-row-degree')]")).toHaveText("II");
  await expect(bCell.locator("xpath=preceding-sibling::*[contains(@class,'cof-note-row-degree')]")).toHaveText("VII°");
  await expect(dbCell.locator("xpath=preceding-sibling::*[contains(@class,'cof-note-row-degree')]")).toHaveText("");
});


test("inner diminished ring keeps a visible gap from the middle ring", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");
  const circle = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof');
  await circle.locator('.cof-wedge[data-index="0"] .cof-wedge-path').click({ force: true });

  const gap = await circle.evaluate((element) => {
    const middle = element.querySelector(
      '.cof-secondary-cell[data-degree="ii"] .cof-secondary-path'
    ) as SVGPathElement | null;
    const inner = element.querySelector('.cof-dim-cell .cof-dim-path') as SVGPathElement | null;
    const parseRadii = (d: string | null): { outer: number; inner: number } | null => {
      if (!d) return null;
      const matches = [...d.matchAll(/A\s*([-\d.]+)\s+([-\d.]+)/g)];
      if (matches.length < 2) return null;
      const outer = Number(matches[0]?.[1] ?? Number.NaN);
      const innerR = Number(matches[1]?.[1] ?? Number.NaN);
      if (!Number.isFinite(outer) || !Number.isFinite(innerR)) return null;
      return { outer, inner: innerR };
    };
    const middleR = parseRadii(middle?.getAttribute("d") ?? null);
    const innerR = parseRadii(inner?.getAttribute("d") ?? null);
    if (!middleR || !innerR) return Number.NaN;
    return middleR.inner - innerR.outer;
  });

  expect(Number.isFinite(gap)).toBeTruthy();
  expect(gap).toBeGreaterThan(2);
});

test("lesser-degree note rectangles stay visible but more muted than I/IV/V", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");
  const panel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  await panel.locator('.cof-wedge[data-index="0"] .cof-wedge-path').click({ force: true }); // C major

  const metrics = await panel.evaluate((element) => {
    const parseColor = (color: string): { r: number; g: number; b: number; a: number } | null => {
      const nums = color.match(/[-\d.]+/g)?.map((token) => Number(token)) ?? [];
      if (nums.length < 3) return null;
      const [r, g, b] = nums;
      const a = nums.length >= 4 ? (nums[3] ?? 1) : 1;
      if (![r, g, b, a].every((value) => Number.isFinite(value))) return null;
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a };
    };
    const read = (semitone: string) => {
      const cell = element.querySelector(`.cof-note-cell[data-semitone="${semitone}"]`) as HTMLElement | null;
      if (!cell) return { hasCell: false, alpha: 0, lum: 0, raw: "" };
      const raw = getComputedStyle(cell).backgroundColor;
      const parsed = parseColor(raw);
      if (!parsed) return { hasCell: true, alpha: Number.NaN, lum: Number.NaN, raw };
      const { r, g, b, a: alpha } = parsed;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return { hasCell: true, alpha, lum, raw };
    };
    return {
      tonic: read("0"), // C (I)
      lesser: read("2"), // D (II)
    };
  });

  expect(metrics.tonic.hasCell).toBeTruthy();
  expect(metrics.lesser.hasCell).toBeTruthy();
  expect(metrics.tonic.raw).not.toBe("transparent");
  expect(metrics.lesser.raw).not.toBe("transparent");
  expect(metrics.tonic.raw).not.toBe("rgba(0, 0, 0, 0)");
  expect(metrics.lesser.raw).not.toBe("rgba(0, 0, 0, 0)");
  expect(metrics.lesser.raw).not.toBe(metrics.tonic.raw);
  if (Number.isFinite(metrics.tonic.alpha) && Number.isFinite(metrics.lesser.alpha)) {
    expect(metrics.tonic.alpha).toBeGreaterThan(0.5);
    expect(metrics.lesser.alpha).toBeGreaterThan(0.45);
  }
});

test("circle mode remains visible in portrait mobile without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

  const circleScreen = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  await expect(circleScreen).toHaveClass(/is-active/);
  await expect(page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof')).toBeVisible();

  const overflow = await circleScreen.evaluate((element) => ({
    needsHorizontalScroll: element.scrollWidth > element.clientWidth + 1,
  }));

  expect(overflow.needsHorizontalScroll).toBeFalsy();
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










test("double-tapping inside the circle cycles instruments and shows the instrument name indicator", async ({
  page,
}) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

  const circlePanel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const svg = circlePanel.locator(".cof-svg");
  const banner = circlePanel.locator(".cof-mode-banner").first();
  const instrumentLabel = circlePanel.locator(".cof-instrument-label");
  const svgBox = await svg.boundingBox();
  expect(svgBox).not.toBeNull();
  await expect(instrumentLabel).toContainText("ACOUSTIC GUITAR");

  await svg.dblclick({
    position: { x: (svgBox?.width ?? 0) / 2, y: (svgBox?.height ?? 0) / 2 },
    force: true,
  });
  await expect(banner).toContainText("ELECTRIC GUITAR");
  await expect(instrumentLabel).toContainText("ELECTRIC GUITAR");
});


test("outer wedge pointerdown applies tap activation before pointerup", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

  const panel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const circle = panel.locator('.cof');
  const wedgePath = panel.locator('.cof-wedge[data-index="0"] .cof-wedge-path');

  const pressPoint = await panel.locator('.cof-svg').evaluate((svgNode) => {
    const svg = svgNode as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.58,
      y: rect.top + rect.height * 0.15,
    };
  });

  await wedgePath.dispatchEvent("pointerdown", {
    bubbles: true,
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerId: 701,
    pointerType: "touch",
    clientX: pressPoint.x,
    clientY: pressPoint.y,
  });

  await expect(circle).toHaveClass(/has-primary/);

  await wedgePath.dispatchEvent("pointerup", {
    bubbles: true,
    button: 0,
    buttons: 0,
    isPrimary: true,
    pointerId: 701,
    pointerType: "touch",
    clientX: pressPoint.x,
    clientY: pressPoint.y,
  });
});






test("note-bar supports keyboard activation with Enter and Space", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

  const noteBar = page.locator('.mode-screen[data-mode="circle-of-fifths"] .cof-note-bar');
  const dbCell = noteBar.locator('.cof-note-cell[data-semitone="1"]');
  const dbRow = dbCell.locator("xpath=ancestor::*[contains(@class,'cof-note-row')]");
  const dbTrail = dbRow.locator(".cof-note-trail");

  await dbCell.focus();
  await dbCell.press("Enter");
  await expect.poll(async () => dbTrail.count(), { timeout: 1200 }).toBeGreaterThan(0);
  await page.waitForTimeout(560);
  await expect(dbCell).not.toHaveClass(/is-active/);

  await dbCell.focus();
  await dbCell.press(" ");
  await expect.poll(async () => dbTrail.count(), { timeout: 1200 }).toBeGreaterThan(0);
});


test("concentric center drift stays below 0.1px across primary notes", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

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







test("double-tapping inside cycles through all circle instruments", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");

  const panel = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const svg = panel.locator(".cof-svg");
  const instrumentLabel = panel.locator(".cof-instrument-label");
  const svgBox = await svg.boundingBox();
  expect(svgBox).not.toBeNull();

  const expected = [
    "ACOUSTIC GUITAR",
    "ELECTRIC GUITAR",
    "SPANISH GUITAR",
    "PIPE ORGAN",
    "HOUSE ORGAN",
    "ACOUSTIC GUITAR",
  ];

  await expect(instrumentLabel).toContainText(expected[0] ?? "");
  for (const next of expected.slice(1)) {
    await svg.dblclick({
      position: { x: (svgBox?.width ?? 0) / 2, y: (svgBox?.height ?? 0) / 2 },
      force: true,
    });
    await expect(instrumentLabel).toContainText(next);
  }
});
