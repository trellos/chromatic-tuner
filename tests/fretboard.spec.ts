import { expect, test } from "@playwright/test";

async function assertElementFullyInViewport(
  page: import("@playwright/test").Page,
  selector: string
): Promise<void> {
  const metrics = await page.evaluate((targetSelector) => {
    const element = document.querySelector<HTMLElement>(targetSelector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  }, selector);

  expect(metrics, `Missing element: ${selector}`).not.toBeNull();
  expect(metrics?.width ?? 0, `${selector} has zero width`).toBeGreaterThan(0);
  expect(metrics?.height ?? 0, `${selector} has zero height`).toBeGreaterThan(0);
  expect(metrics?.top ?? 0, `${selector} top clipped`).toBeGreaterThanOrEqual(-1);
  expect(metrics?.left ?? 0, `${selector} left clipped`).toBeGreaterThanOrEqual(-1);
  expect(
    metrics?.right ?? Number.POSITIVE_INFINITY,
    `${selector} right clipped`
  ).toBeLessThanOrEqual((metrics?.viewportWidth ?? 0) + 1);
  expect(
    metrics?.bottom ?? Number.POSITIVE_INFINITY,
    `${selector} bottom clipped`
  ).toBeLessThanOrEqual((metrics?.viewportHeight ?? 0) + 1);
}

async function installFretboardAudioCounters(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.addInitScript(() => {
    const win = window as Window & {
      __fretboardAudioPatchInstalled?: boolean;
      __fretboardBufferSourceCount?: number;
      __fretboardOscillatorCount?: number;
    };
    if (win.__fretboardAudioPatchInstalled) return;

    win.__fretboardAudioPatchInstalled = true;
    win.__fretboardBufferSourceCount = 0;
    win.__fretboardOscillatorCount = 0;

    const patchCtor = (Ctor: typeof AudioContext | undefined) => {
      if (!Ctor?.prototype) return;
      const proto = Ctor.prototype as AudioContext & {
        __fretboardAudioCountersPatched?: boolean;
      };
      if (proto.__fretboardAudioCountersPatched) return;

      const originalCreateBufferSource = proto.createBufferSource;
      const originalCreateOscillator = proto.createOscillator;

      proto.createBufferSource = function (...args) {
        win.__fretboardBufferSourceCount = (win.__fretboardBufferSourceCount ?? 0) + 1;
        return originalCreateBufferSource.apply(this, args);
      };

      proto.createOscillator = function (...args) {
        win.__fretboardOscillatorCount = (win.__fretboardOscillatorCount ?? 0) + 1;
        return originalCreateOscillator.apply(this, args);
      };

      proto.__fretboardAudioCountersPatched = true;
    };

    patchCtor((window as any).AudioContext);
    patchCtor((window as any).webkitAudioContext);
  });
}

async function installFretboardAudioAttemptTracker(
  page: import("@playwright/test").Page
): Promise<void> {
  await page.addInitScript(() => {
    const win = window as Window & {
      __fretboardAttemptPatchInstalled?: boolean;
      __fretboardSampleFetchCount?: number;
      __fretboardAnyAudioNodeCount?: number;
      __fretboardAudioContextCreateCount?: number;
    };
    if (win.__fretboardAttemptPatchInstalled) return;

    win.__fretboardAttemptPatchInstalled = true;
    win.__fretboardSampleFetchCount = 0;
    win.__fretboardAnyAudioNodeCount = 0;
    win.__fretboardAudioContextCreateCount = 0;

    const wrapAudioContextCtor = (key: "AudioContext" | "webkitAudioContext") => {
      const OriginalCtor = (window as any)[key];
      if (!OriginalCtor) return;
      if ((OriginalCtor as any).__fretboardCtorWrapped) return;

      const WrappedCtor = class extends OriginalCtor {
        constructor(...args: any[]) {
          super(...args);
          win.__fretboardAudioContextCreateCount =
            (win.__fretboardAudioContextCreateCount ?? 0) + 1;
        }
      };
      (WrappedCtor as any).__fretboardCtorWrapped = true;
      (window as any)[key] = WrappedCtor;
    };

    wrapAudioContextCtor("AudioContext");
    wrapAudioContextCtor("webkitAudioContext");

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("assets/audio/fretboard/guitar-acoustic-c4.mp3")) {
        win.__fretboardSampleFetchCount = (win.__fretboardSampleFetchCount ?? 0) + 1;
      }
      return originalFetch(input, init);
    };

    const patchCtor = (Ctor: typeof AudioContext | undefined) => {
      if (!Ctor?.prototype) return;
      const proto = Ctor.prototype as AudioContext & {
        __fretboardAttemptPatched?: boolean;
      };
      if (proto.__fretboardAttemptPatched) return;

      const originalCreateBufferSource = proto.createBufferSource;
      const originalCreateOscillator = proto.createOscillator;

      proto.createBufferSource = function (...args) {
        win.__fretboardAnyAudioNodeCount = (win.__fretboardAnyAudioNodeCount ?? 0) + 1;
        return originalCreateBufferSource.apply(this, args);
      };

      proto.createOscillator = function (...args) {
        win.__fretboardAnyAudioNodeCount = (win.__fretboardAnyAudioNodeCount ?? 0) + 1;
        return originalCreateOscillator.apply(this, args);
      };

      proto.__fretboardAttemptPatched = true;
    };

    patchCtor((window as any).AudioContext);
    patchCtor((window as any).webkitAudioContext);
  });
}

test("fretboard mode defaults to C major scale with note labels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const fretboard = page.locator('.mode-screen[data-mode="fretboard"]');
  await expect(fretboard).toHaveClass(/is-active/);
  await expect(page.locator('[data-fretboard-root="C"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-fretboard-display="scale"]')).toHaveClass(/is-active/);
  await expect(page.locator("#fretboard-characteristic")).toHaveValue("major");
  await expect(page.locator('[data-fretboard-annotation="notes"]')).toHaveClass(/is-active/);

  const stringLabels = page.locator(".fretboard-string-labels span");
  await expect(stringLabels).toHaveText(["E", "A", "D", "G", "B", "E"]);

  const openIndicators = page.locator(".fretboard-open-indicator");
  await expect(openIndicators).toHaveCount(6);

  const dots = page.locator(".fretboard-dot");
  await expect(dots).toHaveCount(42);
  const labels = await dots.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim()));
  expect(labels).toContain("C");
  expect(labels).toContain("E");
  expect(labels).toContain("G");
  expect(labels).not.toContain("C#");
});

test("fretboard interaction updates characteristic options and degree labels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  await page.locator('[data-fretboard-display="chord"]').click();
  await expect(page.locator('#fretboard-characteristic option[value="suspended-fourth"]')).toHaveCount(1);

  await page.locator("#fretboard-characteristic").selectOption("suspended-fourth");
  await page.locator('[data-fretboard-annotation="degrees"]').click();
  await expect(page.locator('[data-fretboard-annotation="degrees"]')).toHaveClass(/is-active/);

  const degreeDots = page.locator(".fretboard-dot");
  await expect(page.locator(".fretboard-open-indicator")).toHaveCount(1);
  await expect(degreeDots).toHaveCount(18);
  const degreeLabels = await degreeDots.evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim())
  );
  expect(degreeLabels).toContain("1");
  expect(degreeLabels).toContain("4");
  expect(degreeLabels).toContain("5");
  expect(degreeLabels).not.toContain("3");

  await page.locator('[data-fretboard-root="C"]').click();
  await page.locator('[data-fretboard-display="scale"]').click();
  await page.locator("#fretboard-characteristic").selectOption("major");
  await page.locator('[data-fretboard-annotation="notes"]').click();

  const noteLabels = await page.locator(".fretboard-dot").evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim())
  );
  expect(noteLabels).toContain("C");
  expect(noteLabels).toContain("F");
  expect(noteLabels).not.toContain("C#");
});

test("fretboard note dots expose midi metadata and are tappable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const firstDot = page.locator(".fretboard-dot").first();
  await expect(firstDot).toHaveAttribute("data-midi", /^\d+$/);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await firstDot.click();
  await page.waitForTimeout(150);
  expect(pageErrors).toEqual([]);
});

test("fretboard open-string indicators expose midi metadata and are tappable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const firstOpen = page.locator(".fretboard-open-indicator").first();
  await expect(firstOpen).toHaveAttribute("data-midi", /^\d+$/);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  await firstOpen.click();
  await page.waitForTimeout(150);
  expect(pageErrors).toEqual([]);
});

test("fretboard play button ramps seigaiha randomness and returns to zero", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "debug randomness assertion is Chromium-only");
  await page.goto("/?debug=1");
  await page.getByRole("tab", { name: "Fretboard" }).click();
  await page.locator('[data-fretboard-display="chord"]').click();

  const playButton = page.locator("[data-fretboard-play]");
  await expect(playButton).toBeVisible();
  await expect(playButton).toHaveText("Play");

  const readRandomness = async () => {
    const text = await page.locator(".seigaiha-debug-value").first().textContent();
    const parsed = Number.parseFloat((text ?? "0").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };

  await playButton.click();
  await expect.poll(readRandomness, { timeout: 1200 }).toBeGreaterThan(0.6);
  await expect.poll(readRandomness, { timeout: 2600 }).toBeLessThan(0.08);
  await expect(playButton).toHaveText("Play");
});


test("fretboard mobile portrait fits all controls and reaches fret 12", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "Mobile Safari", "mobile portrait coverage only");

  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const fretboardScreen = page.locator('.mode-screen[data-mode="fretboard"]');
  await expect(fretboardScreen).toHaveClass(/is-active/);

  const overflow = await fretboardScreen.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    hasOverflow: element.scrollHeight > element.clientHeight + 1,
  }));
  expect(overflow.hasOverflow).toBeFalsy();

  await expect(page.locator('.fretboard-controls')).toBeVisible();
  await expect(page.locator('.fretboard-dot[data-fret="12"]').first()).toBeVisible();
  const twelfthInlays = page.locator('.fretboard-inlay[data-fret="12"]');
  await expect(twelfthInlays).toHaveCount(2);
  await expect(twelfthInlays.nth(0)).toBeVisible();
  await expect(twelfthInlays.nth(1)).toBeVisible();
});

test("fretboard UI stays fully visible across desktop and portrait aspect ratios", async ({
  page,
  browserName,
}) => {
  const viewports =
    browserName === "Mobile Safari"
      ? [
          { width: 412, height: 915 },
          { width: 390, height: 844 },
          { width: 320, height: 900 },
        ]
      : [
          { width: 1366, height: 768 },
          { width: 1024, height: 1366 },
          { width: 412, height: 915 },
          { width: 390, height: 844 },
          { width: 320, height: 900 },
        ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("tab", { name: "Fretboard" }).click();

    const fretboardScreen = page.locator('.mode-screen[data-mode="fretboard"]');
    await expect(fretboardScreen).toHaveClass(/is-active/);
    await expect(page.locator(".fretboard-layout")).toBeVisible();
    await expect(page.locator(".fretboard-board")).toBeVisible();
    await expect(page.locator(".fretboard-controls")).toBeVisible();
    await expect(page.locator(".fretboard-dot[data-fret='12']").first()).toBeVisible();

    const twelfthInlays = page.locator('.fretboard-inlay[data-fret="12"]');
    await expect(twelfthInlays).toHaveCount(2);
    await expect(twelfthInlays.nth(0)).toBeVisible();
    await expect(twelfthInlays.nth(1)).toBeVisible();

    const selectors = [
      ".fretboard-board",
      ".fretboard-controls",
      ".fretboard-note-selector",
      '[data-fretboard-display="chord"]',
      '[data-fretboard-display="scale"]',
      "#fretboard-characteristic",
      '[data-fretboard-annotation="notes"]',
      '[data-fretboard-annotation="degrees"]',
      "[data-fretboard-play]",
    ];
    for (const selector of selectors) {
      await assertElementFullyInViewport(page, selector);
    }
  }
});

test("fretboard taps play guitar sample across browser engines", async ({ page, browserName }) => {
  test.skip(
    browserName === "webkit" || browserName === "Mobile Safari",
    "WebKit headless audio is not reliable for sample-playback assertions"
  );

  await installFretboardAudioCounters(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  const firstDot = page.locator(".fretboard-dot").first();
  await expect(firstDot).toBeVisible();

  await firstDot.click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => (window as any).__fretboardBufferSourceCount ?? 0),
      { timeout: 6000 }
    )
    .toBeGreaterThan(0);

  const oscillatorCount = await page.evaluate(
    () => (window as any).__fretboardOscillatorCount ?? 0
  );
  expect(
    oscillatorCount,
    `Fallback oscillator should not be used in ${browserName}`
  ).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("fretboard tap attempts audio playback on WebKit-family browsers", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "webkit" && browserName !== "Mobile Safari",
    "Safari-family smoke coverage only"
  );

  await installFretboardAudioAttemptTracker(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard" }).click();

  const hasAudioApi = await page.evaluate(
    () => Boolean((window as any).AudioContext || (window as any).webkitAudioContext)
  );
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  const firstDot = page.locator(".fretboard-dot").first();
  await expect(firstDot).toBeVisible();
  await firstDot.click();

  await expect
    .poll(
      async () =>
        page.evaluate(() => ({
          fetchCount: (window as any).__fretboardSampleFetchCount ?? 0,
          audioNodeCount: (window as any).__fretboardAnyAudioNodeCount ?? 0,
          contextCreateCount: (window as any).__fretboardAudioContextCreateCount ?? 0,
        })),
      { timeout: 6000 }
    )
    .toEqual(
      expect.objectContaining({
        fetchCount: expect.any(Number),
        audioNodeCount: expect.any(Number),
        contextCreateCount: expect.any(Number),
      })
    );

  const attempt = await page.evaluate(() => ({
    fetchCount: (window as any).__fretboardSampleFetchCount ?? 0,
    audioNodeCount: (window as any).__fretboardAnyAudioNodeCount ?? 0,
    contextCreateCount: (window as any).__fretboardAudioContextCreateCount ?? 0,
  }));

  if (hasAudioApi) {
    expect(
      attempt.fetchCount > 0 ||
        attempt.audioNodeCount > 0 ||
        attempt.contextCreateCount > 0,
      `Expected audio playback attempt on ${browserName}`
    ).toBeTruthy();
  } else {
    expect(attempt.fetchCount).toBe(0);
    expect(attempt.audioNodeCount).toBe(0);
    expect(attempt.contextCreateCount).toBe(0);
  }

  expect(pageErrors).toEqual([]);
});
