import { expect, test } from '@playwright/test';

// One-off: give an existing BOM a parent item through the edit form, so the
// "@sobom" attach path has real data to prove itself against.
//
// Targets a BOM by its NAME via E2E_BOM_NAME so this can only ever touch the
// row you name — by default one of the E2E-BOM-* rows left behind by earlier
// runs, never a real production BOM.
//
// Run: E2E_BOM_NAME=... E2E_PARENT=... npx playwright test --config=playwright.pages.config.ts -g "@setparent"

const BOM_NAME = process.env['E2E_BOM_NAME'] ?? '';
const PARENT = process.env['E2E_PARENT'] ?? '';

test('@setparent give a BOM its parent item', async ({ page }) => {
  test.skip(!BOM_NAME || !PARENT, 'set E2E_BOM_NAME and E2E_PARENT');

  await page.goto('/bom-masters');
  const row = page.locator('tr', { hasText: BOM_NAME }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('a').first().click();

  await page.getByRole('link', { name: /Edit \/ Revise/i }).click();
  await expect(page.getByText(/Edit BOM/i).first()).toBeVisible({ timeout: 30_000 });

  const input = page.locator('#bom-parent-item');
  await input.click();
  await input.fill(PARENT);
  const opt = page.locator('#bom-parent-item-listbox [role="option"]', { hasText: PARENT });
  await expect(opt.first()).toBeVisible({ timeout: 20_000 });
  await opt.first().click();

  const save = page.getByRole('button', { name: /Save as Rev/i });
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page.getByText(/Parent Item/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`text=${PARENT}`).first()).toBeVisible({ timeout: 15_000 });
  // eslint-disable-next-line no-console
  console.log(`>> "${BOM_NAME}" now has parent ${PARENT}`);
});
