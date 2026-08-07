import { expect, test } from '@playwright/test';

// Verifies the BOM parent-item gate shipped in afc6244 (ADR-108), WITHOUT
// saving anything — this spec never writes to prod.
//
//   1. A new BOM opens with the part list LOCKED: "+ Add Item" and
//      "Import Excel" are disabled until a parent is picked.
//   2. Picking a parent auto-fills its name and unlocks the list.
//   3. The parent cannot also be one of its own child parts.
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@bomparent"

const PARENT = '723009000000'; // HANDLE ELESA L.652/80 B-M8-C9
const PARENT_NAME = /HANDLE/i;
const CHILD = '724639000000'; // HONEYWELL MICROSWITCH

async function pick(
  page: import('@playwright/test').Page,
  fieldId: string,
  code: string,
): Promise<void> {
  const input = page.locator(`#${fieldId}`);
  await input.click();
  await input.fill(code);
  const option = page.locator(`#${fieldId}-listbox [role="option"]`, { hasText: code });
  await expect(option.first()).toBeVisible({ timeout: 20_000 });
  await option.first().click();
}

test('@bomparent part list is locked until a parent is picked, and the parent cannot be its own part', async ({
  page,
}) => {
  await page.goto('/bom-masters/new');
  await expect(page.getByText('📦 New BOM')).toBeVisible({ timeout: 30_000 });

  const addItem = page.getByRole('button', { name: /Add Item/i });
  const importExcel = page.getByRole('button', { name: /Import Excel/i });

  // --- 1. locked ------------------------------------------------------------
  await expect(page.getByText(/PICK THE PARENT FIRST/i)).toBeVisible();
  await expect(addItem).toBeDisabled();
  await expect(importExcel).toBeDisabled();
  await expect(page.getByText(/Locked — pick the/i)).toBeVisible();
  // eslint-disable-next-line no-console
  console.log('>> locked: Add Item + Import Excel disabled, empty state says locked');

  // --- 2. picking the parent unlocks ---------------------------------------
  await pick(page, 'bom-parent-item', PARENT);
  const parentName = page.locator('input[readonly][placeholder="auto-filled"]').first();
  await expect(parentName).toHaveValue(PARENT_NAME, { timeout: 15_000 });
  await expect(page.getByText(/PARENT — BUILT FROM THE PARTS BELOW/i)).toBeVisible();
  await expect(addItem).toBeEnabled();
  await expect(importExcel).toBeEnabled();
  // eslint-disable-next-line no-console
  console.log(`>> parent ${PARENT} → "${await parentName.inputValue()}", list unlocked`);

  // --- 3. the parent cannot be its own child -------------------------------
  await page
    .getByPlaceholder(/Hydraulic Press Assembly/i)
    .fill('E2E parent-gate check (not saved)');
  await addItem.click();
  await pick(page, 'bom-item-0', PARENT);

  const err = page.locator('text=/is the parent item/i').first();
  await expect(err).toBeVisible({ timeout: 15_000 });
  const text = (await err.textContent()) ?? '';
  // eslint-disable-next-line no-console
  console.log(`>> self-reference message: ${text.trim()}`);
  expect(text).toContain(PARENT);
  await expect(page.getByRole('button', { name: /Save BOM/i })).toBeDisabled();

  // Swapping that line to a real child clears the error and re-enables Save.
  await pick(page, 'bom-item-0', CHILD);
  await expect(err).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Save BOM/i })).toBeEnabled();
  // eslint-disable-next-line no-console
  console.log('>> swapped to a real child → Save enabled (nothing saved)');
});
