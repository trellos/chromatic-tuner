import { expect, test } from "@playwright/test";
import { switchMode } from "./helpers/mode.js";

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
