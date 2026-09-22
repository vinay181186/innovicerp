import { expect, test } from '@playwright/test';

/**
 * Access Control — positive + negative e2e.
 *
 * READ-ONLY on purpose. This runs against the DEPLOYED Pages build + the LIVE
 * prod API (the only place localhost CORS allows), so the spec NEVER clicks
 * "Save Access": every assertion is about what the screen shows or how the
 * in-memory editor reacts, and the modal is always closed with Cancel. Nothing
 * is persisted to production.
 *
 * The logged-in account (E2E_EMAIL) must be an ADMIN — Access Control is
 * admin-only, so a non-admin session only ever sees the "Admin access required"
 * gate (which is itself the negative case in test 1).
 *
 * Run: pnpm --filter @innovic/web exec playwright test --config=playwright.pages.config.ts flow-access-control
 */

// Open the Access Control page and the first user's Configure modal.
async function openFirstConfigure(page: import('@playwright/test').Page) {
  await page.goto('/access-control', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('🔒 Access Control').first()).toBeVisible({ timeout: 30_000 });
  const configure = page.getByRole('button', { name: /Configure/ }).first();
  await expect(configure).toBeVisible({ timeout: 20_000 });
  await configure.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

// Make sure a department group is expanded (its price hint is only in the open body).
async function expandDept(dialog: import('@playwright/test').Locator, dept: string) {
  const toggle = dialog.getByRole('button', { name: new RegExp(`(Expand|Collapse) ${dept}`) });
  await expect(toggle).toBeVisible();
  const label = (await toggle.getAttribute('aria-label')) ?? '';
  if (label.startsWith('Expand')) await toggle.click();
}

test.describe('Access Control', () => {
  // ── POSITIVE: an admin lands on the matrix, not the gate ──
  test('positive: admin sees the matrix with users + Configure', async ({ page }) => {
    await page.goto('/access-control', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('🔒 Access Control').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Configure/ }).first()).toBeVisible();
    // NEGATIVE guard: the admin must NOT hit the admin-only gate.
    await expect(page.getByText('Admin access required')).toHaveCount(0);
  });

  // ── POSITIVE: the SEE ₹ column + the department-specific price hints ──
  test('positive: Configure shows SEE ₹ column and per-department price hints', async ({
    page,
  }) => {
    const dialog = await openFirstConfigure(page);

    // Sales is a money department → price starts at L2.
    await expandDept(dialog, 'Sales');
    await expect(dialog.getByText(/₹ from L2/).first()).toBeVisible();
    await expect(dialog.getByText(/works with the money itself/).first()).toBeVisible();
    // The new fifth column header.
    await expect(dialog.getByText('SEE', { exact: false }).first()).toBeVisible();

    // Production is not a money department → price starts at L3, L2 sees none.
    await expandDept(dialog, 'Production');
    await expect(dialog.getByText(/₹ from L3/).first()).toBeVisible();
    await expect(dialog.getByText(/data entry only and sees no money/).first()).toBeVisible();

    // Never save.
    await dialog.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(dialog).toBeHidden();
  });

  // ── NEGATIVE/EDGE: force money OFF on one tier-granted form (red ✕), then back ──
  test('negative: clicking a tier-granted ₹ box forces money off and back', async ({ page }) => {
    const dialog = await openFirstConfigure(page);

    // Work in Standard (per-department) mode, then grant Sales L2 so its forms
    // get money from the tier (in memory only — never saved).
    await dialog.getByRole('button', { name: 'Standard' }).first().click();
    const salesToggle = dialog.getByRole('button', { name: /(Expand|Collapse) Sales/ });
    const salesRow = salesToggle.locator('xpath=ancestor::div[1]');
    await salesRow.getByRole('button', { name: 'L2', exact: true }).click();
    await expandDept(dialog, 'Sales');

    // A tier-granted ₹ box carries this title (see configure-modal.tsx).
    const priceBox = dialog
      .locator('input[type="checkbox"][title*="hide money on this form"]')
      .first();
    await expect(priceBox).toBeVisible();
    const handle = await priceBox.elementHandle();
    if (!handle) throw new Error('expected a tier-granted ₹ checkbox after granting Sales L2');

    // Click → money forced OFF for that one form (the red ✕ marker appears).
    await handle.click();
    await expect(dialog.getByTitle('Money hidden on this form')).toBeVisible();

    // Click again → reverts to what the department level gives (✕ gone).
    await handle.click();
    await expect(dialog.getByTitle('Money hidden on this form')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(dialog).toBeHidden();
  });
});
