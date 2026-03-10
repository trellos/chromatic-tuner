import { test, expect } from "@playwright/test";
import { switchMode } from "./helpers/mode.js";
test("debug wild-tuna layout", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Wild Tuna");
  await page.locator("[data-wild-tuna-fullscreen]").click();
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const modeScreen = document.querySelector('.mode-screen[data-mode="wild-tuna"]') as HTMLElement;
    const composite = document.querySelector('.wild-tuna-composite') as HTMLElement;
    const drumPane = document.querySelector('.wild-tuna-pane--drum') as HTMLElement;
    const circlePane = document.querySelector('.wild-tuna-pane--circle') as HTMLElement;
    const fretPane = document.querySelector('.wild-tuna-pane--fretboard') as HTMLElement;
    const drumMock = document.querySelector('.wild-tuna-pane--drum .drum-mock') as HTMLElement;
    const cof = document.querySelector('.wild-tuna-pane--circle .cof') as HTMLElement;
    const fretboard = document.querySelector('.wild-tuna-pane--fretboard .fretboard-board') as HTMLElement;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      modeScreen: modeScreen ? { x: modeScreen.getBoundingClientRect().x, y: modeScreen.getBoundingClientRect().y, w: modeScreen.getBoundingClientRect().width, h: modeScreen.getBoundingClientRect().height } : null,
      composite: composite ? { y: composite.getBoundingClientRect().y, h: composite.getBoundingClientRect().height } : null,
      drumPane: drumPane ? { y: drumPane.getBoundingClientRect().y, h: drumPane.getBoundingClientRect().height } : null,
      circlePane: circlePane ? { y: circlePane.getBoundingClientRect().y, h: circlePane.getBoundingClientRect().height } : null,
      fretPane: fretPane ? { y: fretPane.getBoundingClientRect().y, h: fretPane.getBoundingClientRect().height } : null,
      drumMock: drumMock ? { x: drumMock.getBoundingClientRect().x, y: drumMock.getBoundingClientRect().y, w: drumMock.getBoundingClientRect().width, h: drumMock.getBoundingClientRect().height } : null,
      cof: cof ? { w: cof.getBoundingClientRect().width, h: cof.getBoundingClientRect().height } : null,
      fretboard: fretboard ? { w: fretboard.getBoundingClientRect().width, h: fretboard.getBoundingClientRect().height } : null,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  expect(true).toBe(true);
});

test("debug wild-tuna header and stage", async ({ page }) => {
  await page.goto("/");
  await switchMode(page, "Wild Tuna");
  await page.locator("[data-wild-tuna-fullscreen]").click();
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const header = document.querySelector('.app-header') as HTMLElement;
    const stage = document.querySelector('.mode-stage') as HTMLElement;
    const app = document.querySelector('.app') as HTMLElement;
    const modeScreen = document.querySelector('.mode-screen[data-mode="wild-tuna"]') as HTMLElement;
    const body = document.body;
    return {
      headerDisplay: getComputedStyle(header).display,
      headerRect: header?.getBoundingClientRect(),
      stageRect: stage?.getBoundingClientRect(),
      appRect: app?.getBoundingClientRect(),
      modeScreenWidth: getComputedStyle(modeScreen).width,
      bodyClasses: body.className,
      modeScreenClasses: modeScreen.className,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  expect(true).toBe(true);
});
