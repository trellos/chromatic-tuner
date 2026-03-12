import { expect, test, type Page } from "@playwright/test";
import { switchMode } from "./helpers/mode.js";

// Selectors for all drum controls bar elements.
const DRUM_CONTROL_SELECTORS = [
  { id: "#drum-tempo-value", label: "Tempo value" },
  { id: '.drum-tempo [data-tempo="down"]', label: "Tempo down" },
  { id: '.drum-tempo [data-tempo="up"]', label: "Tempo up" },
  { id: "#drum-step-toggle", label: "Step toggle (8/16)" },
  { id: "#drum-beat-button", label: "Beat picker" },
  { id: "#drum-kit-button", label: "Kit picker" },
  { id: "#drum-share-button", label: "Share button" },
  { id: "#drum-play-toggle", label: "Play/Stop button" },
];

/** Returns offending selector strings for any control clipped outside the viewport. */
async function findClippedDrumControls(page: Page, contextSelector: string): Promise<string[]> {
  return page.evaluate(
    ({ selectors, ctx }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const context = document.querySelector<HTMLElement>(ctx) ?? document;
      const offenders: string[] = [];
      for (const { id, label } of selectors) {
        const el = context.querySelector<HTMLElement>(id);
        if (!el) {
          offenders.push(`${label} (${id}): NOT FOUND`);
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          offenders.push(`${label} (${id}): zero size (${rect.width}×${rect.height})`);
          continue;
        }
        const tol = 2;
        if (rect.left < -tol || rect.right > vw + tol || rect.top < -tol || rect.bottom > vh + tol) {
          offenders.push(
            `${label} (${id}): rect=[${rect.left.toFixed(1)},${rect.top.toFixed(1)},${rect.right.toFixed(1)},${rect.bottom.toFixed(1)}] viewport=${vw}×${vh}`
          );
        }
      }
      return offenders;
    },
    { selectors: DRUM_CONTROL_SELECTORS, ctx: contextSelector }
  );
}

test("drum machine transport, beat/kit menus, tempo, and step toggles are stable", async ({
  page,
}) => {
  await page.goto("/");
  await switchMode(page, "Drum Machine");

  const playButton = page.locator("#drum-play-toggle");
  const beatButton = page.locator("#drum-beat-button");
  const kitButton = page.locator("#drum-kit-button");
  const tempoValue = page.locator("#drum-tempo-value");
  const firstStep = page.locator('.mode-screen[data-mode="drum-machine"] .drum-row[data-voice="perc"] .step').nth(1);

  await expect(playButton).toHaveText("Play");
  await expect(beatButton).toHaveText("Beat: Rock");
  await expect(kitButton).toContainText("Kit: Rock Drums");
  await expect(tempoValue).toHaveText("120");
  await expect(firstStep).not.toHaveClass(/is-on/);

  await beatButton.click();
  await page.locator('#drum-beat-menu [data-beat="breakbeat"]').click();
  await expect(beatButton).toHaveText("Beat: Breakbeat");

  await kitButton.click();
  await page.locator('#drum-kit-menu [data-kit="woodblock"]').click();
  await expect(kitButton).toContainText("Kit: Woodblock Ensemble");

  await page.locator('.mode-screen[data-mode="drum-machine"] [data-tempo="up"]').click();
  await expect(tempoValue).toHaveText("121");
  await page.locator('.mode-screen[data-mode="drum-machine"] [data-tempo="down"]').click();
  await expect(tempoValue).toHaveText("120");

  await firstStep.click();
  await expect(firstStep).toHaveClass(/is-on/);
  await firstStep.click();
  await expect(firstStep).not.toHaveClass(/is-on/);

  await playButton.click();
  await page.waitForTimeout(160);
  const firstToggleText = ((await playButton.textContent()) ?? "").trim();
  if (firstToggleText !== "Stop") return;
  await playButton.click();
  await expect(playButton).toHaveText("Play");
});

const WILD_TUNA_FULLSCREEN_VIEWPORTS = [
  { width: 1280, height: 800, name: "desktop wide" },
  { width: 1024, height: 768, name: "desktop square-ish" },
  { width: 768, height: 1024, name: "tablet portrait" },
  { width: 1024, height: 600, name: "landscape tablet" },
  { width: 390, height: 844, name: "mobile portrait" },
];

test("wild tuna fullscreen: all drum controls are visible and fully in-viewport at various aspect ratios", async ({
  page,
}) => {
  for (const viewport of WILD_TUNA_FULLSCREEN_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await switchMode(page, "Wild Tuna");
    await page.locator("[data-wild-tuna-fullscreen]").click();
    await expect(page.locator("body")).toHaveClass(/wild-tuna-fullscreen/);

    // Wait for drum UI to be injected.
    await expect(page.locator("[data-wild-tuna-drum] .drum-ui")).toBeVisible();

    const offenders = await findClippedDrumControls(page, "[data-wild-tuna-drum]");
    expect(
      offenders,
      `Viewport ${viewport.name} (${viewport.width}×${viewport.height}) has clipped controls:\n${offenders.join("\n")}`
    ).toEqual([]);
  }
});

test("wild tuna fullscreen: drum control bar and note grid are the same width", async ({ page }) => {
  const viewports = [
    { width: 1280, height: 800, name: "desktop wide" },
    { width: 768, height: 1024, name: "tablet portrait" },
    { width: 390, height: 844, name: "mobile portrait" },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await switchMode(page, "Wild Tuna");
    await page.locator("[data-wild-tuna-fullscreen]").click();
    await expect(page.locator("body")).toHaveClass(/wild-tuna-fullscreen/);
    await expect(page.locator("[data-wild-tuna-drum] .drum-ui")).toBeVisible();

    const widths = await page.evaluate(() => {
      const ctx = document.querySelector("[data-wild-tuna-drum]");
      if (!ctx) return null;
      const bar = ctx.querySelector<HTMLElement>(".drum-ui");
      const grid = ctx.querySelector<HTMLElement>(".drum-grids");
      if (!bar || !grid) return null;
      return {
        bar: bar.getBoundingClientRect().width,
        grid: grid.getBoundingClientRect().width,
      };
    });

    expect(widths, `${viewport.name}: drum elements not found`).not.toBeNull();
    expect(
      Math.abs(widths!.bar - widths!.grid),
      `${viewport.name}: drum-ui width (${widths!.bar.toFixed(1)}) should equal drum-grids width (${widths!.grid.toFixed(1)})`
    ).toBeLessThanOrEqual(2);
  }
});

test("drum machine lifecycle stops transport when mode exits and re-enters", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Drum Machine");

  const playButton = page.locator("#drum-play-toggle");
  await playButton.click();
  await page.waitForTimeout(180);

  await switchMode(page, "Circle of Fifths");
  await expect(page.locator('.mode-screen[data-mode="circle-of-fifths"]')).toHaveClass(/is-active/);

  await switchMode(page, "Drum Machine");
  await expect(page.locator('.mode-screen[data-mode="drum-machine"]')).toHaveClass(/is-active/);
  await expect(playButton).toHaveText("Play");
});

test("drum fullscreen toggles cleanly and keeps controls in viewport on desktop and mobile", async ({
  page,
}) => {
  const viewports = [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
  await switchMode(page, "Drum Machine");
    await page.locator("#carousel-toggle").click();

    await expect(page.locator("body")).toHaveClass(/drum-fullscreen/);
    await expect(page.locator("#drum-exit")).toBeVisible();
    await expect(page.locator("#drum-play-toggle")).toBeVisible();
    await expect(page.locator("#drum-beat-button")).toBeVisible();
    await expect(page.locator("#drum-kit-button")).toBeVisible();

    const controlsInViewport = await page.evaluate(() => {
      const selectors = ["#drum-play-toggle", "#drum-beat-button", "#drum-kit-button", "#drum-share-button"];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return selectors.every((selector) => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.left >= -1 && rect.top >= -1 && rect.right <= vw + 1 && rect.bottom <= vh + 1;
      });
    });
    expect(controlsInViewport).toBeTruthy();

    await page.locator("#drum-exit").click();
    await expect(page.locator("body")).not.toHaveClass(/drum-fullscreen/);
  }
});
