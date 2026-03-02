import { expect, test } from '@playwright/test';

test.describe('key finder mode', () => {
  test('ranks key candidates from selected notes and supports clear', async ({ page }) => {
    await page.goto('/');
    await page.locator('.mode-dot[data-mode="key-finder"]').click();

    const panel = page.locator('.mode-screen[data-mode="key-finder"]');
    await expect(panel).toHaveClass(/is-active/);

    const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    for (const note of notes) {
      await panel.locator('.key-finder-note-btn', { hasText: new RegExp(`^${note}$`) }).click();
    }

    const firstResult = panel.locator('.key-finder-result').first();
    await expect(firstResult).toBeVisible();
    await expect(firstResult.locator('.key-finder-result-score')).toContainText('%');
    await expect(firstResult).toContainText(/(C Major|A Minor|Ionian|Aeolian)/);

    await panel.locator('[data-key-finder-clear]').click();
    await expect(panel.locator('[data-key-finder-empty]')).toBeVisible();
    await expect(panel.locator('.key-finder-chip')).toHaveCount(0);
  });

  test('supports fretboard input tab and visible preview button', async ({ page }) => {
    await page.goto('/');
    await page.locator('.mode-dot[data-mode="key-finder"]').click();

    const panel = page.locator('.mode-screen[data-mode="key-finder"]');
    await panel.locator('[data-key-finder-input="fretboard"]').click();

    const fretButtons = panel.locator('.key-finder-fret-btn');
    await expect(fretButtons.first()).toBeVisible();
    await fretButtons.nth(0).click();
    await fretButtons.nth(2).click();
    await fretButtons.nth(4).click();

    const firstResult = panel.locator('.key-finder-result').first();
    await expect(firstResult).toBeVisible();
    await expect(firstResult.locator('.key-finder-preview-btn')).toBeVisible();
  });
});
