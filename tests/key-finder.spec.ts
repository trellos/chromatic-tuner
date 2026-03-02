import { expect, test } from '@playwright/test';

test.describe('key finder mode', () => {
  test('ranks key candidates, highlights selected notes in scale, and supports clear', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mode-chip').click();
    await page.getByRole('menuitem', { name: 'Key Finder' }).click();

    const panel = page.locator('.mode-screen[data-mode="key-finder"]');
    await expect(panel).toHaveClass(/is-active/);

    for (const pitchClass of [0, 2, 4, 5, 7, 9, 11]) {
      await panel.locator(`.key-finder-note-btn[data-pitch-class=\"${pitchClass}\"]`).click();
    }

    const firstResult = panel.locator('.key-finder-result').first();
    await expect(firstResult).toBeVisible();
    await expect(firstResult.locator('.key-finder-token.is-selected')).toHaveCount(7);
    await expect(firstResult.locator('.key-finder-result-score')).toHaveCount(0);
    await expect(panel.locator('[data-key-finder-mode-hints]')).toContainText(/D Dorian/);

    await panel.locator('[data-key-finder-clear]').click();
    await expect(panel.locator('[data-key-finder-empty]')).toBeVisible();
    await expect(panel.locator('[data-key-finder-mode-hints]')).toBeHidden();
  });

  test('shows non-diatonic notes inline in parentheses and updates mode hints on row click', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mode-chip').click();
    await page.getByRole('menuitem', { name: 'Key Finder' }).click();

    const panel = page.locator('.mode-screen[data-mode="key-finder"]');
    for (const pitchClass of [0, 2, 4, 6]) {
      await panel.locator(`.key-finder-note-btn[data-pitch-class=\"${pitchClass}\"]`).click();
    }

    const topResult = panel.locator('.key-finder-result').first();
    await expect(topResult.locator('.key-finder-outliers-inline')).toContainText(/non-diatonic:/);

    await panel.locator('.key-finder-result').nth(1).click();
    await expect(panel.locator('[data-key-finder-mode-hints]')).toContainText(/Dorian|Phrygian|Lydian/);
  });
});
