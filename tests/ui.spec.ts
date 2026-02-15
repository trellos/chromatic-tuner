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



test('drum machine rotates to landscape presentation in fullscreen on mobile', async ({
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
  expect((fullscreenStepRect?.width ?? 0) > (normalStepRect?.width ?? 0)).toBeTruthy();
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

test('drum machine toolbar stays in a single row on mobile portrait', async ({ page }) => {
  const portraitViewports = [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
  ];

  for (const viewport of portraitViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/');

    await page.getByRole('tab', { name: 'Drum Machine' }).click();
    const drumUi = page.locator('.mode-screen[data-mode="drum-machine"] .drum-ui');
    await expect(drumUi).toBeVisible();

    const overlapsSingleRow = await drumUi.locator(':scope > *').evaluateAll((nodes) => {
      const rects = nodes.map((node) => node.getBoundingClientRect());
      if (rects.length < 2) return false;

      const first = rects[0];
      return rects.every((rect) => rect.top < first.bottom && rect.bottom > first.top);
    });

    expect(overlapsSingleRow).toBeTruthy();
  }
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
