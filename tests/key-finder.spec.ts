import { expect, test } from '@playwright/test';

test.describe('key finder mode', () => {
  test('ranks key candidates, highlights selected notes in scale, and supports clear', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mode-chip').click();
    await page.getByRole('menuitem', { name: 'Key Finder' }).click();

    const panel = page.locator('.mode-screen[data-mode="key-finder"]');
    await expect(panel).toHaveClass(/is-active/);

    const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    for (const note of notes) {
      await panel.locator('.key-finder-note-btn', { hasText: new RegExp(`^${note}$`) }).click();
    }

    const firstResult = panel.locator('.key-finder-result').first();
    await expect(firstResult).toBeVisible();
    await expect(firstResult.locator('.key-finder-result-score')).toContainText('%');
    await expect(firstResult.locator('.key-finder-token.is-selected')).toHaveCount(7);
    await expect(firstResult).not.toContainText('Possible');
    await expect(panel.locator('.key-finder-clear')).toBeVisible();

    await panel.locator('[data-key-finder-clear]').click();
    await expect(panel.locator('[data-key-finder-empty]')).toBeVisible();
    await expect(panel.locator('.key-finder-chip')).toHaveCount(0);
  });

  test('shows non-diatonic notes inline in parentheses', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mode-chip').click();
    await page.getByRole('menuitem', { name: 'Key Finder' }).click();

    const panel = page.locator('.mode-screen[data-mode="key-finder"]');
    for (const note of ['C', 'D', 'E', 'F#']) {
      await panel.locator('.key-finder-note-btn', { hasText: new RegExp(`^${note}$`) }).click();
    }

    const topResult = panel.locator('.key-finder-result').first();
    await expect(topResult.locator('.key-finder-outliers-inline')).toContainText(/non-diatonic:/);
    await expect(topResult.locator('.key-finder-outliers-inline')).toContainText(/[A-G]/);
  });
});
