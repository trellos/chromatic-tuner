import { expect, test, type Page } from "@playwright/test";
import { switchMode } from "./helpers/mode.js";

async function installAudioDelayAndOscillatorCounter(page: Page) {
  await page.addInitScript(() => {
    const win = window as Window & {
      __oscCount?: number;
      __audioDelayInstalled?: boolean;
    };
    if (win.__audioDelayInstalled) return;
    win.__audioDelayInstalled = true;
    win.__oscCount = 0;

    const patchCtor = (Ctor: typeof AudioContext | undefined) => {
      if (!Ctor || !Ctor.prototype) return;
      const proto = Ctor.prototype as AudioContext & {
        __oscPatched?: boolean;
        createOscillator: AudioContext["createOscillator"];
      };
      if (proto.__oscPatched) return;
      const originalCreateOscillator = proto.createOscillator;
      proto.createOscillator = function (...args: Parameters<AudioContext["createOscillator"]>) {
        win.__oscCount = (win.__oscCount ?? 0) + 1;
        return originalCreateOscillator.apply(this, args);
      };
      proto.__oscPatched = true;
    };

    patchCtor((window as any).AudioContext);
    patchCtor((window as any).webkitAudioContext);

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (!url.includes("assets/audio/")) {
        return originalFetch(input, init);
      }

      return new Promise((resolve, reject) => {
        window.setTimeout(() => {
          originalFetch(input, init).then(resolve, reject);
        }, 450);
      });
    };
  });
}

test("metronome starts with decoded sample playback instead of oscillator fallback", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium");
  await installAudioDelayAndOscillatorCounter(page);
  await page.goto("/");

  await switchMode(page, "Metronome");
  const toggle = page.locator(
    '.mode-screen[data-mode="metronome"] [data-action="toggle"]'
  );
  await toggle.click();
  await expect(toggle).toHaveText("Stop");
  await page.waitForTimeout(700);

  const oscCount = await page.evaluate(() => (window as any).__oscCount ?? 0);
  expect(oscCount).toBe(0);
});

test("drum machine starts with decoded kit playback instead of oscillator fallback", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium");
  await installAudioDelayAndOscillatorCounter(page);
  await page.goto("/");

  await switchMode(page, "Drum Machine");
  const play = page.locator("#drum-play-toggle");
  await play.click();
  await expect(play).toHaveText("Stop");
  await page.waitForTimeout(700);

  const oscCount = await page.evaluate(() => (window as any).__oscCount ?? 0);
  expect(oscCount).toBe(0);
});
