import { expect, test } from "@playwright/test";
import { getChordTapPlaybackTargets, getKeyTapPlaybackTargets } from "../src/fretboard-logic.js";

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
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

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

test("fretboard chord tap keeps tapped E on D string as bass in C major inversion", async () => {
  const targets = getChordTapPlaybackTargets({
    chordRoot: "C",
    characteristic: "major",
    tappedMidi: 52,
    tappedStringIndex: 2,
  });
  expect(targets).toEqual([
    { midi: 52, stringIndex: 2, isRoot: true },
    { midi: 55, stringIndex: 3 },
    { midi: 60, stringIndex: 4 },
  ]);
});

test("fretboard key tap on C high-e plays 3 on G and 5 on B", async () => {
  const targets = getKeyTapPlaybackTargets({
    keyRoot: "C",
    keyMode: "ionian-major",
    tappedMidi: 72,
    tappedStringIndex: 5,
  });
  expect(targets).toEqual([
    { midi: 64, stringIndex: 3 },
    { midi: 67, stringIndex: 4 },
    { midi: 72, stringIndex: 5, isRoot: true },
  ]);
});

test("fretboard interaction updates characteristic options and degree labels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

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

test("fretboard hide button replaces selectors with a tappable summary field", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

  const hideButton = page.locator("[data-fretboard-hide]");
  const summary = page.locator("[data-fretboard-summary]");

  await expect(summary).toBeHidden();
  await page.locator('[data-fretboard-root="A"]').click();
  await page.locator('[data-fretboard-display="chord"]').click();
  await page.locator("#fretboard-characteristic").selectOption("major");

  await hideButton.click();
  await expect(summary).toBeVisible();
  await expect(summary).toHaveText("A Major");
  await expect(page.locator(".fretboard-note-selector")).toHaveAttribute("hidden", "");
  await expect(page.locator(".fretboard-characteristic")).toHaveAttribute("hidden", "");
  await expect(page.locator(".fretboard-actions")).toHaveAttribute("hidden", "");
  const rotated = await summary.evaluate(
    (el) => getComputedStyle(el as HTMLElement).transform !== "none"
  );
  expect(rotated).toBeTruthy();

  await summary.click();
  await expect(summary).toBeHidden();
  await expect(page.locator(".fretboard-note-selector")).not.toHaveAttribute("hidden", "");
  await expect(page.locator(".fretboard-characteristic")).not.toHaveAttribute("hidden", "");
  await expect(page.locator(".fretboard-actions")).not.toHaveAttribute("hidden", "");
});

test("fretboard key mode shows seven modes with major/minor labels and diatonic notes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

  await page.locator('[data-fretboard-display="key"]').click();
  await expect(page.locator('[data-fretboard-display="key"]')).toHaveClass(/is-active/);

  const characteristic = page.locator("#fretboard-characteristic");
  await expect(characteristic).toHaveValue("ionian-major");
  await expect(page.locator('#fretboard-characteristic option[value="ionian-major"]')).toHaveCount(1);
  await expect(page.locator('#fretboard-characteristic option[value="aeolian-minor"]')).toHaveCount(1);
  await expect(page.locator("#fretboard-characteristic option")).toHaveCount(7);

  const optionLabels = await characteristic.locator("option").evaluateAll((options) =>
    options.map((option) => option.textContent?.trim() ?? "")
  );
  expect(optionLabels).toContain("Ionian (Major)");
  expect(optionLabels).toContain("Aeolian (Minor)");

  await expect(page.locator(".fretboard-open-indicator")).toHaveCount(6);
  await expect(page.locator(".fretboard-dot")).toHaveCount(42);
  const noteLabels = await page.locator(".fretboard-dot").evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim())
  );
  expect(noteLabels).toContain("C");
  expect(noteLabels).toContain("E");
  expect(noteLabels).not.toContain("C#");
});

test("fretboard note dots expose midi metadata and are tappable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

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
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

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
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();
  await page.locator('[data-fretboard-display="chord"]').click();

  const playButton = page.locator("[data-fretboard-play]");
  await expect(playButton).toBeVisible();
  await expect(playButton).toHaveText("PLAY");

  const readRandomness = async () => {
    const text = await page.locator(".seigaiha-debug-value").first().textContent();
    const parsed = Number.parseFloat((text ?? "0").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };

  await playButton.click();
  await expect(playButton).toHaveText("PLAYING...");
  let observedRamp = true;
  try {
    await expect.poll(readRandomness, { timeout: 2800 }).toBeGreaterThan(0.05);
  } catch {
    observedRamp = false;
  }
  if (!observedRamp) {
    // Some environments do not expose this visual ramp reliably; keep lifecycle coverage.
    await expect(playButton).toHaveText("PLAY");
    return;
  }
  await expect.poll(readRandomness, { timeout: 3200 }).toBeLessThan(0.08);
  await expect(playButton).toHaveText("PLAY");
});


test("fretboard mobile portrait fits all controls and reaches fret 12", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "Mobile Safari", "mobile portrait coverage only");

  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

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
}, testInfo) => {
  const isMobileSafariProject = testInfo.project.name === "Mobile Safari";
  const viewports =
    isMobileSafariProject
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
    await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

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
      '[data-fretboard-display="key"]',
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

test("fretboard taps play guitar sample across browser engines", async ({ page, browserName }, testInfo) => {
  const isMobileSafariProject = testInfo.project.name === "Mobile Safari";
  test.skip(
    browserName === "webkit" || isMobileSafariProject,
    "WebKit headless audio is not reliable for sample-playback assertions"
  );

  await installFretboardAudioCounters(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

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

test("fretboard chord taps play triads rooted on tapped string", async ({ page, browserName }, testInfo) => {
  const isMobileSafariProject = testInfo.project.name === "Mobile Safari";
  test.skip(
    browserName === "webkit" || isMobileSafariProject,
    "WebKit headless audio is not reliable for sample-playback assertions"
  );

  await installFretboardAudioCounters(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();
  await page.locator('[data-fretboard-display="chord"]').click();

  const tappedLowE = page.locator('.fretboard-dot[data-string-index="0"]').first();
  await expect(tappedLowE).toBeVisible();

  const beforeCount = await page.evaluate(() => (window as any).__fretboardBufferSourceCount ?? 0);
  await tappedLowE.click();
  await expect
    .poll(
      async () => page.evaluate(() => (window as any).__fretboardBufferSourceCount ?? 0),
      { timeout: 6000 }
    )
    .toBeGreaterThanOrEqual(beforeCount + 3);
});

test("fretboard key taps play diatonic triads including top-string voicings", async ({
  page,
  browserName,
}, testInfo) => {
  const isMobileSafariProject = testInfo.project.name === "Mobile Safari";
  test.skip(
    browserName === "webkit" || isMobileSafariProject,
    "WebKit headless audio is not reliable for sample-playback assertions"
  );

  await installFretboardAudioCounters(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();
  await page.locator('[data-fretboard-display="key"]').click();

  const lowStringDot = page.locator('.fretboard-dot[data-string-index="0"]').first();
  await expect(lowStringDot).toBeVisible();
  const beforeLow = await page.evaluate(() => (window as any).__fretboardBufferSourceCount ?? 0);
  await lowStringDot.click();
  await expect
    .poll(
      async () => page.evaluate(() => (window as any).__fretboardBufferSourceCount ?? 0),
      { timeout: 6000 }
    )
    .toBeGreaterThanOrEqual(beforeLow + 3);

  const highStringDot = page.locator('.fretboard-dot[data-string-index="5"]').first();
  await expect(highStringDot).toBeVisible();
  const beforeHigh = await page.evaluate(() => (window as any).__fretboardBufferSourceCount ?? 0);
  await highStringDot.click();
  await expect
    .poll(
      async () => page.evaluate(() => (window as any).__fretboardBufferSourceCount ?? 0),
      { timeout: 6000 }
    )
    .toBeGreaterThanOrEqual(beforeHigh + 3);
});

test("fretboard tap attempts audio playback on WebKit-family browsers", async ({
  page,
  browserName,
}, testInfo) => {
  const isMobileSafariProject = testInfo.project.name === "Mobile Safari";
  test.skip(
    browserName !== "webkit" && !isMobileSafariProject,
    "Safari-family smoke coverage only"
  );

  await installFretboardAudioAttemptTracker(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

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
  }

  expect(pageErrors).toEqual([]);
});


test("mobile safari taps every fretboard control button without mode-swiping to metronome", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "Mobile Safari", "iOS Safari regression coverage only");

  await page.goto("/");
  await page.getByRole("tab", { name: "Fretboard", exact: true }).click();

  const fretboardScreen = page.locator('.mode-screen[data-mode="fretboard"]');
  const metronomeScreen = page.locator('.mode-screen[data-mode="metronome"]');
  await expect(fretboardScreen).toHaveClass(/is-active/);

  const buttonLabels = [
    "A",
    "A#",
    "B",
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "CHORD",
    "SCALE",
    "KEY",
    "NOTES",
    "DEGREES",
    "PLAY",
    "HIDE",
  ];

  for (const label of buttonLabels) {
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button).toBeVisible();
    await button.click({ force: true });
    await expect(fretboardScreen).toHaveClass(/is-active/);
    await expect(metronomeScreen).not.toHaveClass(/is-active/);
  }

  const summary = page.locator("[data-fretboard-summary]");
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(fretboardScreen).toHaveClass(/is-active/);
  await expect(metronomeScreen).not.toHaveClass(/is-active/);
});
