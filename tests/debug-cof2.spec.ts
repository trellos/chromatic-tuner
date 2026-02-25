import { test, expect } from "@playwright/test";
test("debug cof wedge positions in wild-tuna", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Wild Tuna" }).click();
  await page.locator("[data-wild-tuna-fullscreen]").click();
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => {
    const get = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { y: r.y, h: r.height, w: r.width, bottom: r.bottom, csH: cs.height, csW: cs.width };
    };
    return {
      vh: window.innerHeight, vw: window.innerWidth,
      modeScreen: get('.mode-screen[data-mode="wild-tuna"]'),
      modeShell: get('.wild-tuna-mode-shell'),
      composite: get('.wild-tuna-composite'),
      drumPane: get('.wild-tuna-pane--drum'),
      circlePane: get('.wild-tuna-pane--circle'),
      fretPane: get('.wild-tuna-pane--fretboard'),
      circleLayout: get('.wild-tuna-pane--circle .circle-mode-layout'),
      cofFrame: get('.cof-frame'),
      cof: get('.wild-tuna-pane--circle .cof'),
      wedgeBottomMax: Math.max(...Array.from(document.querySelectorAll('.wild-tuna-pane--circle .cof-outer .cof-wedge')).map(w => w.getBoundingClientRect().bottom)),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  expect(true).toBe(true);
});
