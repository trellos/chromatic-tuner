import { test, expect, type Page } from '@playwright/test';

const MODE_TABS = [
  { label: 'Chromatic Tuner', id: 'tuner' },
  { label: 'Metronome', id: 'metronome' },
  { label: 'Drum Machine', id: 'drum-machine' },
] as const;

type PageIssueTracker = {
  pageErrors: string[];
  failedRequests: string[];
};

test("seigaiha background: single static traditional layer", async ({ page }) => {
  await page.goto("/");

  const bg = await page.evaluate(() => {
    const style = getComputedStyle(document.body, "::before");
    return {
      image: style.backgroundImage,
      pos: style.backgroundPosition,
    };
  });

  const urlCount = (bg.image.match(/url\(/g) ?? []).length;
  expect(urlCount).toBe(1);
  expect(bg.pos).toContain("0px 0px");
});

test("seigaiha debug override starts disabled and shows editable detune mapping", async ({
  page,
}) => {
  await page.goto("/?debug=1");

  const tunerSection = page.locator('.seigaiha-debug-section[data-debug-section="tuner"]');
  const metronomeSection = page.locator(
    '.seigaiha-debug-section[data-debug-section="metronome"]'
  );
  const drumSection = page.locator(
    '.seigaiha-debug-section[data-debug-section="drum-machine"]'
  );
  const overrideToggle = page.locator("#seigaiha-override-toggle");
  const slider = page.locator("#seigaiha-randomness-slider");
  const fps = page.locator(".seigaiha-debug-fps");
  const smoothingMs = page.locator("#seigaiha-smoothing-ms");
  await expect(tunerSection).toBeVisible();
  await expect(metronomeSection).toBeHidden();
  await expect(drumSection).toBeHidden();
  await expect(overrideToggle).toBeVisible();
  await expect(overrideToggle).not.toBeChecked();
  await expect(slider).toBeDisabled();
  await expect(fps).toBeVisible();
  await expect(fps).toContainText("FPS");
  await expect(smoothingMs).toBeVisible();

  const centsInputs = page.locator(
    '.seigaiha-debug-section[data-debug-section="tuner"] .seigaiha-debug-table:not(.seigaiha-debug-table--compact) tbody tr td:first-child input[type="number"]'
  );
  const randomnessInputs = page.locator(
    '.seigaiha-debug-section[data-debug-section="tuner"] .seigaiha-debug-table:not(.seigaiha-debug-table--compact) tbody tr td:nth-child(2) input[type="number"]'
  );
  await expect(centsInputs).toHaveCount(3);
  await expect(randomnessInputs).toHaveCount(3);
  await expect(centsInputs.nth(0)).toHaveValue("2");
  await expect(centsInputs.nth(1)).toHaveValue("4");
  await expect(centsInputs.nth(2)).toHaveValue("10");
  await expect(randomnessInputs.nth(0)).toHaveValue("0");
  await expect(randomnessInputs.nth(1)).toHaveValue("0.2");
  await expect(randomnessInputs.nth(2)).toHaveValue("0.5");
});

test("seigaiha debug shows metronome params only in metronome mode", async ({
  page,
}) => {
  await page.goto("/?debug=1");
  await page.getByRole("tab", { name: "Metronome" }).click();

  const tunerSection = page.locator('.seigaiha-debug-section[data-debug-section="tuner"]');
  const metronomeSection = page.locator(
    '.seigaiha-debug-section[data-debug-section="metronome"]'
  );
  const drumSection = page.locator(
    '.seigaiha-debug-section[data-debug-section="drum-machine"]'
  );

  await expect(tunerSection).toBeHidden();
  await expect(metronomeSection).toBeVisible();
  await expect(drumSection).toBeHidden();
  await expect(metronomeSection.getByText("NA")).toBeVisible();
  await expect(metronomeSection.getByText("I44")).toBeVisible();
  await expect(metronomeSection.getByText("I34")).toBeVisible();
  await expect(metronomeSection.getByText("I68")).toBeVisible();
  await expect(metronomeSection.getByText("UP")).toBeVisible();
  await expect(metronomeSection.getByText("DN")).toBeVisible();
});

test("seigaiha debug shows drum target only in drum machine mode", async ({
  page,
}) => {
  await page.goto("/?debug=1");
  await page.getByRole("tab", { name: "Drum Machine" }).click();

  const tunerSection = page.locator('.seigaiha-debug-section[data-debug-section="tuner"]');
  const metronomeSection = page.locator(
    '.seigaiha-debug-section[data-debug-section="metronome"]'
  );
  const drumSection = page.locator(
    '.seigaiha-debug-section[data-debug-section="drum-machine"]'
  );
  const drumTargetInput = page.locator("#seigaiha-drum-target");

  await expect(tunerSection).toBeHidden();
  await expect(metronomeSection).toBeHidden();
  await expect(drumSection).toBeVisible();
  await expect(drumTargetInput).toHaveValue("0.90");

  await drumTargetInput.fill("0.77");
  await drumTargetInput.blur();
  await expect(drumTargetInput).toHaveValue("0.77");
});

function trackPageIssues(page: Page): PageIssueTracker {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    failedRequests.push(
      `${request.method()} ${request.url()} (${failure?.errorText ?? 'unknown'})`
    );
  });

  return { pageErrors, failedRequests };
}

async function assertNoOffscreenText(page: Page): Promise<void> {
  const offenders = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const results: string[] = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const content = node.textContent?.trim();
      if (!content) continue;

      const parent = node.parentElement;
      if (!parent) continue;

      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (parent.closest('[aria-hidden="true"]')) continue;

      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());

      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0) continue;

        const overlapsViewportVertically = rect.bottom > 0 && rect.top < viewportHeight;
        if (!overlapsViewportVertically) continue;

        const left = Math.round(rect.left * 100) / 100;
        const right = Math.round(rect.right * 100) / 100;

        if (left < -1 || right > viewportWidth + 1) {
          const sample = content.length > 60 ? `${content.slice(0, 57)}...` : content;
          results.push(`"${sample}" left=${left} right=${right} viewport=${viewportWidth}`);
        }
      }
    }

    return results;
  });

  expect(offenders, `Found text clipping:\n${offenders.join('\n')}`).toEqual([]);
}



test('seigaiha background covers the full viewport height to the bottom edge', async ({ page }) => {
  await page.goto('/');

  const coverage = await page.evaluate(() => {
    const viewport = window.visualViewport;
    const visualBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);

    const bodyBottom = document.body.getBoundingClientRect().bottom;
    const htmlBottom = document.documentElement.getBoundingClientRect().bottom;
    const before = getComputedStyle(document.body, '::before');

    return {
      bodyGap: visualBottom - bodyBottom,
      htmlGap: visualBottom - htmlBottom,
      beforePosition: before.position,
      beforeInset: before.inset,
      beforeImage: before.backgroundImage,
    };
  });

  expect(coverage.beforePosition).toBe('fixed');
  expect(coverage.beforeInset).toBe('0px');
  expect(coverage.beforeImage).toContain('url(');
  expect(coverage.bodyGap).toBeLessThanOrEqual(1.5);
  expect(coverage.htmlGap).toBeLessThanOrEqual(1.5);
});



test('drum machine share URL opens directly in drum mode and restores pattern', async ({ page }) => {
  const payload = {
    version: 1,
    bpm: 133,
    kit: 'latin',
    steps: '1000000010000000000000000001000000000000000000000000000000001000',
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  await page.goto(`/?track=${encoded}`);

  const drumScreen = page.locator('.mode-screen[data-mode="drum-machine"]');
  await expect(drumScreen).toHaveClass(/is-active/);
  await expect(page.locator('#drum-tempo-value')).toHaveText('133');
  await expect(page.locator('#drum-kit-label')).toHaveText('Latin Percussion');

  const selectedSteps = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.mode-screen[data-mode="drum-machine"] .drum-row .step.is-on')).map(
      (step) => {
        const row = step.closest('.drum-row');
        const steps = Array.from(row?.querySelectorAll('.step') ?? []);
        return `${row?.getAttribute('data-voice')}:${steps.indexOf(step as HTMLButtonElement)}`;
      }
    )
  );

  expect(selectedSteps).toEqual(['kick:0', 'kick:8', 'snare:12', 'perc:15']);
});

test('app loads and key UI is visible with no runtime/network failures', async ({ page }) => {
  const issues = trackPageIssues(page);

  await page.goto('/');
  await expect(page.locator('.app')).toBeVisible();

  await expect(page.locator('h1.hero-title')).toHaveText('TUNA');
  await expect(page.getByRole('tab', { name: 'Chromatic Tuner' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Metronome' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Drum Machine' })).toBeVisible();

  await page.waitForTimeout(150);

  expect(issues.pageErrors, `Page errors:\n${issues.pageErrors.join('\n')}`).toEqual([]);
  expect(
    issues.failedRequests,
    `Failed requests:\n${issues.failedRequests.join('\n')}`
  ).toEqual([]);
});



test('tuner exposes audio diagnostics for CI smoke checks', async ({ page }) => {
  await page.goto('/');

  await page.waitForFunction(() => Boolean((window as any).__tunerAudioDiagnostics));
  const diagnostics = await page.evaluate(() => (window as any).__tunerAudioDiagnostics);

  expect(diagnostics).toEqual(
    expect.objectContaining({
      isIOS: expect.any(Boolean),
      awaitingAudioUnlock: expect.any(Boolean),
      contextState: expect.any(String),
      hasWorkletNode: expect.any(Boolean),
    })
  );

  const audioLikelyAvailable =
    diagnostics.hasWorkletNode ||
    diagnostics.contextState === 'running' ||
    diagnostics.awaitingAudioUnlock;
  expect(audioLikelyAvailable).toBeTruthy();
});
test('mode switches keep stage size stable', async ({ page }) => {
  await page.goto('/');

  const stage = page.locator('.mode-stage');
  await expect(stage).toBeVisible();

  const baseline = await stage.boundingBox();
  expect(baseline).not.toBeNull();

  const tolerancePx = 2;

  for (const mode of MODE_TABS) {
    await page.getByRole('tab', { name: mode.label }).click();
    await expect(page.locator(`.mode-screen[data-mode="${mode.id}"]`)).toHaveClass(/is-active/);

    const afterSwitch = await stage.boundingBox();
    expect(afterSwitch).not.toBeNull();

    expect(Math.abs((afterSwitch?.width ?? 0) - (baseline?.width ?? 0))).toBeLessThanOrEqual(
      tolerancePx
    );
    expect(Math.abs((afterSwitch?.height ?? 0) - (baseline?.height ?? 0))).toBeLessThanOrEqual(
      tolerancePx
    );
  }
});

test('no visible text is clipped off-screen in each mode', async ({ page }) => {
  await page.goto('/');

  for (const mode of MODE_TABS) {
    await page.getByRole('tab', { name: mode.label }).click();
    await expect(page.locator(`.mode-screen[data-mode="${mode.id}"]`)).toHaveClass(/is-active/);
    await assertNoOffscreenText(page);
  }
});

test('tuner mode does not need scrollbars in current project viewport', async ({ page }, testInfo) => {
  await page.goto('/');

  await page.getByRole('tab', { name: 'Chromatic Tuner' }).click();
  const tunerScreen = page.locator('.mode-screen[data-mode="tuner"]');
  await expect(tunerScreen).toHaveClass(/is-active/);

  const overflow = await tunerScreen.evaluate((element) => {
    const needsVerticalScroll = element.scrollHeight > element.clientHeight + 1;
    const needsHorizontalScroll = element.scrollWidth > element.clientWidth + 1;

    return {
      needsVerticalScroll,
      needsHorizontalScroll,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });

  expect(
    overflow,
    `${testInfo.project.name} should not require tuner scrolling`
  ).toMatchObject({
    needsVerticalScroll: false,
    needsHorizontalScroll: false,
  });
});



test('drum machine fullscreen layout is aspect-ratio aware on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('tab', { name: 'Drum Machine' }).click();
  const drumScreen = page.locator('.mode-screen[data-mode="drum-machine"]');
  const drumRotator = page.locator('.mode-screen[data-mode="drum-machine"] .drum-rotator');
  const drumGrid = page.locator('.mode-screen[data-mode="drum-machine"] .drum-grids');
  const firstStep = page.locator('.mode-screen[data-mode="drum-machine"] .step').first();
  await expect(drumScreen).toHaveClass(/is-active/);
  await expect(page.locator('body')).not.toHaveClass(/drum-fullscreen/);

  const normalGridRect = await drumGrid.boundingBox();
  const normalStepRect = await firstStep.boundingBox();
  const normalTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(normalGridRect).not.toBeNull();
  expect(normalStepRect).not.toBeNull();
  expect(normalTransform).toBe('none');

  await page.locator('#carousel-toggle').click();
  await expect(page.locator('body')).toHaveClass(/drum-fullscreen/);

  const fullscreenStepRect = await firstStep.boundingBox();
  const fullscreenTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(fullscreenStepRect).not.toBeNull();
  expect(fullscreenTransform).not.toBe('none');

  await page.setViewportSize({ width: 320, height: 900 });
  const tallPortraitTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(tallPortraitTransform).not.toBe('none');
});

test('drum machine fullscreen toggle keeps mobile orientation rules consistent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('tab', { name: 'Drum Machine' }).click();
  const drumScreen = page.locator('.mode-screen[data-mode="drum-machine"]');
  const drumRotator = page.locator('.mode-screen[data-mode="drum-machine"] .drum-rotator');
  await expect(drumScreen).toHaveClass(/is-active/);

  const initialTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(initialTransform).toBe('none');

  await page.locator('#carousel-toggle').click();
  await expect(page.locator('body')).toHaveClass(/drum-fullscreen/);
  const fullscreenTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(fullscreenTransform).not.toBe('none');

  await page.locator('#drum-exit').click();
  await expect(page.locator('body')).not.toHaveClass(/drum-fullscreen/);
  const exitedTransform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(exitedTransform).toBe('none');
});

test('drum machine fullscreen rotation is mobile-only', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.getByRole('tab', { name: 'Drum Machine' }).click();
  await page.locator('#carousel-toggle').click();
  await expect(page.locator('body')).toHaveClass(/drum-fullscreen/);

  const drumRotator = page.locator('.mode-screen[data-mode="drum-machine"] .drum-rotator');
  const transform = await drumRotator.evaluate((el) => getComputedStyle(el).transform);
  expect(transform).toBe('none');
});

test('drum machine toolbar wraps to two rows on mobile portrait so play is reachable', async ({
  page,
}) => {
  const portraitViewports = [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
  ];

  for (const viewport of portraitViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/');

    await page.getByRole('tab', { name: 'Drum Machine' }).click();
    const drumUi = page.locator('.mode-screen[data-mode="drum-machine"] .drum-ui');
    const playButton = page.locator('#drum-play-toggle');
    await expect(drumUi).toBeVisible();
    await expect(playButton).toBeVisible();

    const hasTwoRows = await drumUi.locator(':scope > *').evaluateAll((nodes) => {
      const rows = new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
      return rows.size >= 2;
    });

    const playIsOnSecondRow = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('.mode-screen[data-mode="drum-machine"] .drum-ui > *'));
      const play = document.querySelector('#drum-play-toggle');
      if (!play || controls.length === 0) return false;
      const tops = controls.map((node) => Math.round(node.getBoundingClientRect().top));
      const firstRowTop = Math.min(...tops);
      const playTop = Math.round(play.getBoundingClientRect().top);
      return playTop > firstRowTop;
    });

    expect(hasTwoRows).toBeTruthy();
    expect(playIsOnSecondRow).toBeTruthy();
  }
});

test('drum machine fullscreen keeps toolbar buttons visible and parallel to grid', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/');

  await page.getByRole('tab', { name: 'Drum Machine' }).click();
  await page.locator('#carousel-toggle').click();
  await expect(page.locator('body')).toHaveClass(/drum-fullscreen/);

  const drumUi = page.locator('.mode-screen[data-mode="drum-machine"] .drum-ui');
  const drumGrid = page.locator('.mode-screen[data-mode="drum-machine"] .drum-grids');
  const drumRotator = page.locator('.mode-screen[data-mode="drum-machine"] .drum-rotator');
  const beatButton = page.locator('#drum-beat-button');
  const kitButton = page.locator('#drum-kit-button');
  const playButton = page.locator('#drum-play-toggle');
  const tempoDown = page.locator('.drum-tempo [data-tempo="down"]');
  const tempoUp = page.locator('.drum-tempo [data-tempo="up"]');

  await expect(beatButton).toBeVisible();
  await expect(kitButton).toBeVisible();
  await expect(playButton).toBeVisible();
  await expect(tempoDown).toBeVisible();
  await expect(tempoUp).toBeVisible();

  const controlsInViewport = await page.evaluate(() => {
    const ids = [
      '#drum-beat-button',
      '#drum-kit-button',
      '#drum-play-toggle',
      '.drum-tempo [data-tempo="down"]',
      '.drum-tempo [data-tempo="up"]',
    ];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return ids.every((selector) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= -1 &&
        rect.left >= -1 &&
        rect.bottom <= vh + 1 &&
        rect.right <= vw + 1
      );
    });
  });
  expect(controlsInViewport).toBeTruthy();

  const [rotatorTransform, uiTransform, gridTransform] = await Promise.all([
    drumRotator.evaluate((el) => getComputedStyle(el).transform),
    drumUi.evaluate((el) => getComputedStyle(el).transform),
    drumGrid.evaluate((el) => getComputedStyle(el).transform),
  ]);
  expect(rotatorTransform).not.toBe('none');
  expect(uiTransform).toBe('none');
  expect(gridTransform).toBe('none');
});

test('metronome sound menu opens without creating a scrollbar on the metronome card', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Metronome' }).click();

  const metronomeScreen = page.locator('.mode-screen[data-mode="metronome"]');
  const soundButton = page.locator('#metro-sound-button');
  const soundMenu = page.locator('#metro-sound-menu');

  await expect(metronomeScreen).toHaveClass(/is-active/);
  await soundButton.click();
  await expect(soundMenu).toHaveClass(/is-open/);

  const overflowState = await metronomeScreen.evaluate((element) => {
    const style = getComputedStyle(element);
    const menu = element.querySelector<HTMLElement>('#metro-sound-menu');
    const cardRect = element.getBoundingClientRect();
    const menuRect = menu?.getBoundingClientRect();
    return {
      overflowY: style.overflowY,
      hasVerticalOverflow: element.scrollHeight > element.clientHeight + 1,
      menuBottom: menuRect?.bottom ?? 0,
      cardBottom: cardRect.bottom,
    };
  });

  expect(overflowState.overflowY).toBe('visible');
  expect(overflowState.hasVerticalOverflow).toBeFalsy();
  expect(overflowState.menuBottom).toBeGreaterThan(overflowState.cardBottom);
});

test('metronome time button shows "No Accent" after selecting no-accent mode', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Metronome' }).click();

  const timeButton = page.locator('#metro-time-button');
  await timeButton.click();
  await page.locator('#metro-time-menu [data-value="no-accent"]').click();
  await expect(timeButton).toHaveText('Time No Accent');
});

test('metronome sound button keeps the most recent sound selection visible', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Metronome' }).click();

  const soundButton = page.locator('#metro-sound-button');
  const soundMenu = page.locator('#metro-sound-menu');

  await expect(soundButton).toHaveText('Sound Woodblock');

  await soundButton.click();
  await expect(soundMenu).toHaveClass(/is-open/);
  await page.locator('#metro-sound-menu [data-sound="drum"]').click();
  await expect(soundMenu).not.toHaveClass(/is-open/);
  await expect(soundButton).toHaveText('Sound Drum');

  await soundButton.click();
  await page.locator('#metro-sound-menu [data-sound="conga"]').click();
  await expect(soundButton).toHaveText('Sound Conga');
});

test('drum machine beat and kit buttons keep their most recent selections visible', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Drum Machine' }).click();

  const beatButton = page.locator('#drum-beat-button');
  const beatMenu = page.locator('#drum-beat-menu');
  const kitButton = page.locator('#drum-kit-button');
  const kitMenu = page.locator('#drum-kit-menu');

  await expect(beatButton).toHaveText('Beat: Rock');
  await expect(kitButton).toContainText('Kit: Rock Drums');

  await beatButton.click();
  await expect(beatMenu).toHaveClass(/is-open/);
  await page.locator('#drum-beat-menu [data-beat="half-time"]').click();
  await expect(beatMenu).not.toHaveClass(/is-open/);
  await expect(beatButton).toHaveText('Beat: Half-Time');

  await kitButton.click();
  await expect(kitMenu).toHaveClass(/is-open/);
  await page.locator('#drum-kit-menu [data-kit="latin"]').click();
  await expect(kitMenu).not.toHaveClass(/is-open/);
  await expect(kitButton).toContainText('Kit: Latin Percussion');
});

test('mode switching remains responsive after a runtime hook error', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(() => {
    const original = window.AbortController;
    Object.defineProperty(window, '__testOriginalAbortController', {
      value: original,
      configurable: true,
    });
    window.AbortController = class {
      constructor() {
        throw new Error('forced metronome enter failure');
      }
    } as typeof AbortController;
  });

  await page.getByRole('tab', { name: 'Metronome' }).click();
  await expect(page.locator('.mode-screen[data-mode="metronome"]')).toHaveClass(/is-active/);

  await page.evaluate(() => {
    const original = (window as typeof window & {
      __testOriginalAbortController?: typeof AbortController;
    }).__testOriginalAbortController;
    if (original) {
      window.AbortController = original;
      delete (window as typeof window & { __testOriginalAbortController?: unknown })
        .__testOriginalAbortController;
    }
  });

  await page.getByRole('tab', { name: 'Drum Machine' }).click();

  await expect(page.locator('.mode-screen[data-mode="drum-machine"]')).toHaveClass(/is-active/);
});

test('tuner status toggle is not duplicated after mode re-entry', async ({ page }) => {
  await page.goto('/?debug=1');

  await expect(page.locator('body')).not.toHaveClass(/status-hidden/);
  await page.getByRole('tab', { name: 'Metronome' }).click();
  await page.getByRole('tab', { name: 'Chromatic Tuner' }).click();

  await page.locator('#strobe-visualizer').click();
  await expect(page.locator('body')).toHaveClass(/status-hidden/);
});
