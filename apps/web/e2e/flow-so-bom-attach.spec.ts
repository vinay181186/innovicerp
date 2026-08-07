import { expect, test } from '@playwright/test';

// Equipment SO → its parent's BOM attaches itself (commit b265bc3).
//
// Two paths, both driven on /sales-orders/new and NEITHER saved:
//   A. a parent item that has no BOM  → amber note + "Go to BOM Master" link,
//      and the BOM field is left empty
//   B. a parent item that HAS an active BOM → green note naming it, and the
//      BOM select is filled in automatically
//
// Path B needs a BOM whose parent is set. Pass its parent's item code as
// E2E_BOM_PARENT to exercise it; without that env var the test reports the
// gap and skips B rather than pretending it passed.
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@sobom"

/** An item with no BOM built from it. */
const NO_BOM_ITEM = '723009000000';
const WITH_BOM_ITEM = process.env['E2E_BOM_PARENT'] ?? '';

test('@sobom equipment SO attaches the parent item’s BOM, or says none exists', async ({
  page,
}) => {
  await page.goto('/sales-orders/new');
  await expect(page.getByText(/SALES ORDER/i).first()).toBeVisible({ timeout: 30_000 });

  // Switch to the equipment type so the Equipment Details block appears.
  await page.locator('select[name="header.type"]').selectOption('equipment');
  await expect(page.getByText(/EQUIPMENT DETAILS/i)).toBeVisible();

  // The renamed label.
  await expect(page.getByText('Equipment / Parent Item')).toBeVisible();

  const equip = page.locator('input[name="lines.0.itemCodeText"]');
  const bomSelect = page.locator('select[name="header.bomMasterId"]');

  // --- A. no BOM for this parent -------------------------------------------
  await equip.fill(NO_BOM_ITEM);
  const amber = page.locator(`text=/No BOM exists for ${NO_BOM_ITEM}/`);
  await expect(amber).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Go to BOM Master/i })).toBeVisible();
  await expect(bomSelect).toHaveValue('');
  // eslint-disable-next-line no-console
  console.log(`>> ${NO_BOM_ITEM}: amber note shown, BOM left empty, link offered`);

  // --- B. a parent that does have a BOM ------------------------------------
  if (!WITH_BOM_ITEM) {
    // eslint-disable-next-line no-console
    console.log('>> SKIPPED the attach path: no E2E_BOM_PARENT set (no BOM has a parent yet)');
    return;
  }
  await equip.fill(WITH_BOM_ITEM);
  const green = page.locator('text=/attached automatically for/');
  await expect(green).toBeVisible({ timeout: 20_000 });
  const noteText = (await green.textContent()) ?? '';
  await expect(bomSelect).not.toHaveValue('');
  // eslint-disable-next-line no-console
  console.log(`>> ${WITH_BOM_ITEM}: ${noteText.trim()}`);
  // eslint-disable-next-line no-console
  console.log(`>> BOM select value = ${await bomSelect.inputValue()}`);
});
