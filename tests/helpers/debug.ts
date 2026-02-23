import type { Page } from "@playwright/test";

export async function readDebugRandomness(page: Page): Promise<number> {
  const text = await page.locator(".seigaiha-debug-value").first().textContent();
  const parsed = Number.parseFloat(text ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
