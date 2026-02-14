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


