import type { Page } from "@playwright/test";

export async function switchMode(page: Page, label: string): Promise<void> {
  const chip = page.locator("#mode-chip");
  const item = page.getByRole("menuitem", { name: label });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await chip.click({ force: true });
    try {
      await item.click({ force: true, timeout: 1500 });
      return;
    } catch {
      if (attempt === 1) {
        const clicked = await page.evaluate((targetLabel) => {
          const items = Array.from(
            document.querySelectorAll<HTMLButtonElement>(".mode-picker-item[data-mode]")
          );
          const itemByText = items.find(
            (itemNode) => (itemNode.textContent ?? "").trim() === targetLabel
          );
          itemByText?.click();
          return Boolean(itemByText);
        }, label);
        if (!clicked) throw new Error(`Mode picker did not open for ${label}`);
      }
    }
  }
}
