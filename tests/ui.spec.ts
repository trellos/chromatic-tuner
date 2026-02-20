import { test, expect } from '@playwright/test';

test('seigaiha layers exist on body::before', async ({ page }) => {
  await page.goto('/');

  const details = await page.evaluate(() => {
    const styles = getComputedStyle(document.body, '::before');
    const backgroundImage = styles.backgroundImage;
    const backgroundRepeat = styles.backgroundRepeat;
    const backgroundSize = styles.backgroundSize;

    return {
      backgroundImage,
      backgroundRepeat,
      backgroundSize,
      dataImageCount: (backgroundImage.match(/data:image\/svg\+xml/g) ?? []).length,
      urlCount: (backgroundImage.match(/url\(/g) ?? []).length,
      repeatCount: (backgroundRepeat.match(/repeat/g) ?? []).length,
      sizeCount: (backgroundSize.match(/384px 384px/g) ?? []).length,
    };
  });

  expect(details.dataImageCount >= 3 || details.urlCount >= 3).toBeTruthy();
  expect(details.repeatCount).toBeGreaterThanOrEqual(3);
  expect(details.sizeCount).toBeGreaterThanOrEqual(1);
});

test('parallax animates by changing backgroundPosition', async ({ page }) => {
  await page.goto('/');

  const t0 = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundPosition);
  await page.waitForTimeout(800);
  const t1 = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundPosition);

  expect(t1).not.toBe(t0);

  const layers0 = t0.split(',').map((item) => item.trim());
  const layers1 = t1.split(',').map((item) => item.trim());
  let changed = 0;
  for (let index = 0; index < Math.min(layers0.length, layers1.length); index += 1) {
    if (layers0[index] !== layers1[index]) {
      changed += 1;
    }
  }

  expect(changed).toBeGreaterThanOrEqual(2);
});

test('card overlay exists and animates', async ({ page }) => {
  await page.goto('/');

  const activeScreen = page.locator('.mode-screen.is-active').first();
  await expect(activeScreen).toBeVisible();

  const cardData = await activeScreen.evaluate((element) => {
    const styles = getComputedStyle(element, '::before');
    return {
      backgroundImage: styles.backgroundImage,
      backgroundPosition: styles.backgroundPosition,
      urlCount: (styles.backgroundImage.match(/url\(/g) ?? []).length,
    };
  });

  expect(cardData.backgroundImage).not.toBe('none');
  expect(cardData.urlCount).toBeGreaterThanOrEqual(2);

  const t0 = cardData.backgroundPosition;
  await page.waitForTimeout(800);
  const t1 = await activeScreen.evaluate(
    (element) => getComputedStyle(element, '::before').backgroundPosition
  );

  expect(t1).not.toBe(t0);
});
