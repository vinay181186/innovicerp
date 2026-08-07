import { expect, test } from '@playwright/test';

// Layout guard for the redesigned BOM screen. At 900 / 1280 / 1600 px:
//   * the page itself never scrolls sideways
//   * every control on a child row is reachable, INCLUDING the Type select and
//     the delete button — the two that a naive "make it fit" would squeeze off
//     the end. Below ~630px of row width the list scrolls inside its own block
//     instead, which keeps them reachable rather than hidden.
//
// Read-only: drives /bom-masters/new and never saves.
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@bomlayout"

const PARENT = '723009000000';
const CHILD = '724639000000';
const WIDTHS = [900, 1280, 1600];

test('@bomlayout no row overflows and every control stays reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/bom-masters/new');
  await expect(page.getByText('New BOM', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Build one real row so there is something to measure.
  const parent = page.locator('#bom-parent-item');
  await parent.click();
  await parent.fill(PARENT);
  const po = page.locator('#bom-parent-item-listbox [role="option"]', { hasText: PARENT });
  await expect(po.first()).toBeVisible({ timeout: 20_000 });
  await po.first().click();

  await page.getByRole('button', { name: /Add child item/i }).click();
  const child = page.locator('#bom-item-0');
  await child.click();
  await child.fill(CHILD);
  const co = page.locator('#bom-item-0-listbox [role="option"]', { hasText: CHILD });
  await expect(co.first()).toBeVisible({ timeout: 20_000 });
  await co.first().click();
  await page.keyboard.press('Escape');

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);

    // 1. The PAGE must not scroll sideways.
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    // 2. Type select and delete button must be laid out and hittable.
    const select = page.locator('.bomx-row select').first();
    const del = page.locator('.bomx-del').first();
    await select.scrollIntoViewIfNeeded();
    const selBox = await select.boundingBox();
    await del.scrollIntoViewIfNeeded();
    const delBox = await del.boundingBox();

    // 3. Proof of reachability, not just of presence: actually operate them.
    await select.selectOption('purchase');
    await expect(select).toHaveValue('purchase');
    await select.selectOption('manufacture');
    await expect(del).toBeEnabled();

    // eslint-disable-next-line no-console
    console.log(
      `>> ${width}px: page overflow ${pageOverflow}px | Type ${Math.round(selBox?.width ?? 0)}×${Math.round(selBox?.height ?? 0)} | Delete ${Math.round(delBox?.width ?? 0)}×${Math.round(delBox?.height ?? 0)}`,
    );

    expect(pageOverflow, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
    expect(selBox?.width ?? 0, `Type select collapsed at ${width}px`).toBeGreaterThan(100);
    expect(delBox?.width ?? 0, `Delete button collapsed at ${width}px`).toBeGreaterThan(24);
  }

  // Deleting renumbers: add a second row, remove the first, the survivor is #1.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: /Add child item/i }).click();
  await expect(page.locator('.bomx-num')).toHaveCount(2);
  await page.locator('.bomx-del').first().click();
  await expect(page.locator('.bomx-num')).toHaveCount(1);
  await expect(page.locator('.bomx-num').first()).toHaveText('1');
  // eslint-disable-next-line no-console
  console.log('>> delete removes the row and the remaining rows renumber');
});
