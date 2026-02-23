import { expect, test } from "@playwright/test";

test("coexistence: one mode surface can host active Drum + Circle UI objects without collisions", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Drum Machine" }).click();
  await expect(page.locator('.mode-screen[data-mode="drum-machine"]')).toHaveClass(/is-active/);

  const apiAndMountState = await page.evaluate(() => {
    const win = window as typeof window & {
      __tunaUiObjects?: {
        createCircleOfFifthsUi?: (
          container: HTMLElement,
          options?: {
            onPrimaryTap?: () => void;
            onNoteBarTap?: () => void;
          }
        ) => { destroy: () => void };
        createDrumMachineUi?: unknown;
      };
      __testCoexistCounters?: { primary: number; noteBar: number };
      __testCoexistCircle?: { destroy: () => void };
    };
    const api = win.__tunaUiObjects;
    const hasApi =
      typeof api?.createCircleOfFifthsUi === "function" &&
      typeof api?.createDrumMachineUi === "function";
    if (!hasApi || !api?.createCircleOfFifthsUi) {
      return { hasApi: false, mounted: false };
    }

    const screen = document.querySelector<HTMLElement>('.mode-screen[data-mode="drum-machine"]');
    if (!screen) return { hasApi: true, mounted: false };

    document.querySelector<HTMLElement>("[data-test-coexist-circle-host]")?.remove();
    const host = document.createElement("div");
    host.setAttribute("data-test-coexist-circle-host", "1");
    host.style.position = "absolute";
    host.style.right = "12px";
    host.style.bottom = "12px";
    host.style.width = "220px";
    host.style.height = "220px";
    host.style.zIndex = "3";
    screen.appendChild(host);

    const counters = { primary: 0, noteBar: 0 };
    win.__testCoexistCounters = counters;
    win.__testCoexistCircle = api.createCircleOfFifthsUi(host, {
      onPrimaryTap: () => {
        counters.primary += 1;
      },
      onNoteBarTap: () => {
        counters.noteBar += 1;
      },
    });

    return (
      { hasApi: true, mounted: true }
    );
  });

  expect(apiAndMountState).toEqual({ hasApi: true, mounted: true });

  const circleHost = page.locator('[data-test-coexist-circle-host="1"]');
  const testStep = page
    .locator('.mode-screen[data-mode="drum-machine"] .drum-row[data-voice="perc"] .step')
    .nth(1);

  await expect(circleHost.locator(".cof-wedge")).toHaveCount(12);
  await expect(testStep).not.toHaveClass(/is-on/);
  await testStep.click();
  await expect(testStep).toHaveClass(/is-on/);

  const circleCWedge = circleHost.locator('.cof-note-cell').filter({ hasText: "C" }).first();
  await circleCWedge.focus();
  await circleCWedge.press("Enter");

  const counters = await page.evaluate(
    () =>
      (window as typeof window & { __testCoexistCounters?: { primary: number; noteBar: number } })
        .__testCoexistCounters ?? { primary: 0, noteBar: 0 }
  );
  expect(counters.noteBar).toBe(1);
  await expect(testStep).toHaveClass(/is-on/);

  const overflow = await page.locator('.mode-screen[data-mode="drum-machine"]').evaluate((screen) => ({
    horizontal: screen.scrollWidth > screen.clientWidth + 1,
  }));
  expect(overflow.horizontal).toBeFalsy();

  await page.evaluate(() => {
    const win = window as typeof window & {
      __testCoexistCircle?: { destroy: () => void };
      __testCoexistCounters?: unknown;
    };
    win.__testCoexistCircle?.destroy();
    delete win.__testCoexistCircle;
    delete win.__testCoexistCounters;
    document.querySelector<HTMLElement>("[data-test-coexist-circle-host]")?.remove();
  });
});
