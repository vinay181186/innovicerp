import { expect, test } from '@playwright/test';

// Verifies the two BOM fixes shipped in 004dfbe, WITHOUT saving anything —
// this spec never writes to prod, it only drives the /bom-masters/new form.
//
//   1. The item picker resolves real codes again. The form used to request
//      /items?limit=10000, which the API rejects (schema caps limit at 1000),
//      so the code→item map was empty and every Excel row came back
//      "item_code not found in master".
//   2. Picking the same part on two lines now says WHICH part and WHICH two
//      lines, instead of a bare "duplicate item code".
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@bomdup"

const ITEM_A = '723009000000'; // HANDLE ELESA L.652/80 B-M8-C9
const ITEM_A_NAME = /HANDLE/i;

async function pickItem(
  page: import('@playwright/test').Page,
  lineIdx: number,
  code: string,
): Promise<void> {
  const input = page.locator(`#bom-item-${lineIdx}`);
  await input.click();
  await input.fill(code);
  // Scope to THIS line's listbox — matching option text globally hits table
  // cells behind the form.
  const option = page.locator(`#bom-item-${lineIdx}-listbox [role="option"]`, {
    hasText: code,
  });
  await expect(option.first()).toBeVisible({ timeout: 20_000 });
  await option.first().click();
}

test('@bomdup item picker resolves a real code, and a duplicate part is named', async ({
  page,
}) => {
  await page.goto('/bom-masters/new');
  await expect(page.getByText('📦 New BOM')).toBeVisible({ timeout: 30_000 });

  // The banner shows ONE error at a time, header first — leave BOM Name blank
  // and "BOM Name is required" masks the line error we are here to check.
  await page.getByPlaceholder(/Hydraulic Press Assembly/i).fill('E2E duplicate-check (not saved)');

  // --- 1. the lookup works again -------------------------------------------
  await pickItem(page, 0, ITEM_A);

  // Name auto-fills from the master → the item genuinely resolved, which is
  // exactly what the limit=10000 400 used to prevent.
  const nameBox = page.locator('input[readonly][placeholder="auto-filled"]').first();
  await expect(nameBox).toHaveValue(ITEM_A_NAME, { timeout: 15_000 });
  // eslint-disable-next-line no-console
  console.log(`>> line 1 resolved ${ITEM_A} → "${await nameBox.inputValue()}"`);

  // --- 2. the duplicate message names the part and both lines --------------
  await page.getByRole('button', { name: /Add Item/i }).click();
  await pickItem(page, 1, ITEM_A);

  const err = page.locator('text=/duplicate item code/i').first();
  await expect(err).toBeVisible({ timeout: 15_000 });
  const text = (await err.textContent()) ?? '';
  // eslint-disable-next-line no-console
  console.log(`>> duplicate message: ${text.trim()}`);

  expect(text).toContain(ITEM_A); // names the part
  expect(text).toMatch(/already on line 1/i); // names the earlier line
  expect(text).toMatch(/only once/i); // says what to do

  // Save must be blocked while the duplicate stands.
  await expect(page.getByRole('button', { name: /Save BOM/i })).toBeDisabled();

  // Removing the second line clears it — no save, nothing persisted.
  await expect(page.getByText('📦 Part List / Items (2)')).toBeVisible();
});
