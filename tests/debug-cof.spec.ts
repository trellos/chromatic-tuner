import { test, expect } from "@playwright/test";
import { switchMode } from "./helpers/mode.js";
test("debug COF overflow measurements", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await switchMode(page, "Circle of Fifths");
  await page.waitForTimeout(300);
  const circleScreen = page.locator('.mode-screen[data-mode="circle-of-fifths"]');
  const result = await circleScreen.evaluate((element) => {
    const cof = element.querySelector('.cof') as HTMLElement | null;
    const frame = element.querySelector('.cof-frame') as HTMLElement | null;
    const layout = element.querySelector('.circle-mode-layout') as HTMLElement | null;
    const cofRect = cof?.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    const layoutRect = layout?.getBoundingClientRect();
    return {
      screenScrollWidth: element.scrollWidth,
      screenClientWidth: element.clientWidth,
      cofWidth: cofRect?.width,
      cofHeight: cofRect?.height,
      cofX: cofRect?.x,
      frameWidth: frameRect?.width,
      layoutWidth: layoutRect?.width,
      layoutScrollWidth: layout?.scrollWidth,
      layoutClientWidth: layout?.clientWidth,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  expect(true).toBe(true);
});
