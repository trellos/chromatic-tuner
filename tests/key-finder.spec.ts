import { expect, test } from '@playwright/test';
import { switchMode } from './helpers/mode.js';

test.describe('key finder mode', () => {
  test('ranks key candidates, highlights selected notes in scale, and supports clear', async ({ page }) => {
    await page.goto('/');
    await switchMode(page, 'Key Finder');

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
  test('increases first-card intensity when non-diatonic notes are added', async ({ page }) => {
    await page.goto('/');
    await switchMode(page, 'Key Finder');

    const panel = page.locator('.mode-screen[data-mode="key-finder"]');

    for (const pitchClass of [0, 2, 4, 5, 7, 9, 11]) {
      await panel.locator(`.key-finder-note-btn[data-pitch-class="${pitchClass}"]`).click();
    }

    const topCard = panel.locator('.key-finder-result').first();
    await expect(topCard).toBeVisible();
    const initialIntensity = await topCard.evaluate(
      (element) => getComputedStyle(element as HTMLElement).getPropertyValue('--kf-intensity').trim()
    );
    expect(initialIntensity).toBe('0.000');

    for (const pitchClass of [1, 3, 6]) {
      await panel.locator(`.key-finder-note-btn[data-pitch-class="${pitchClass}"]`).click();
    }

    const nextIntensity = await topCard.evaluate(
      (element) => getComputedStyle(element as HTMLElement).getPropertyValue('--kf-intensity').trim()
    );
    expect(Number.parseFloat(nextIntensity)).toBeGreaterThan(Number.parseFloat(initialIntensity));
  });

  test('shows non-diatonic notes inline and updates mode hints on row click', async ({ page }) => {
    await page.goto('/');
    await switchMode(page, 'Key Finder');

    const panel = page.locator('.mode-screen[data-mode="key-finder"]');
    for (const pitchClass of [0, 2, 4, 5, 7, 9, 11, 1]) {
      await panel.locator(`.key-finder-note-btn[data-pitch-class=\"${pitchClass}\"]`).click();
    }

    await expect(panel.locator('.key-finder-outliers-inline').first()).toContainText(/\(non-diatonic:/);

    const initialHints = await panel.locator('[data-key-finder-mode-hints]').textContent();
    await panel.locator('.key-finder-result').nth(1).click();
    const nextHints = await panel.locator('[data-key-finder-mode-hints]').textContent();
    expect(nextHints).not.toBe(initialHints);
    await expect(panel.locator('[data-key-finder-mode-hints]')).toContainText(/Dorian|Phrygian|Lydian|Mixolydian|Aeolian|Locrian/);
  });
});
