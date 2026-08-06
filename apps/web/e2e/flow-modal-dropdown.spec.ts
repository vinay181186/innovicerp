import { expect, test } from '@playwright/test';

// Regression cover for the dropdown-inside-a-modal case.
//
// The pickers were portaled to <body> so a panel's `overflow: hidden` could no
// longer clip them. That broke every picker INSIDE a modal: the modals are
// plain fixed overlays at zIndex 100, and while the list lived inside the modal
// it inherited that stacking context. Portaled to <body> it became a sibling of
// the overlay, so at z-50 it rendered BEHIND the modal — the list was open and
// invisible, which reads as "the dropdown does not work".
//
// The earlier BOM test could not catch this: the BOM part list is on a plain
// page, not in a modal. This one opens a real modal.
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@modaldd"

test('@modaldd client picker inside a modal renders ABOVE the overlay', async ({ page }) => {
  await page.goto('/party-material', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Add Material/i }).first().click();
  await page.waitForTimeout(1500);

  const clientBox = page.getByPlaceholder(/Type client code or name/i).first();
  // The Client field is NOT disabled — only SO/JWSO and Item cascade off it.
  expect(await clientBox.isDisabled(), 'Client picker is enabled').toBe(false);

  await clientBox.click();
  await clientBox.fill('CLI');
  await page.waitForTimeout(2500);

  const list = page.locator('#pmClient-listbox');
  await expect(list, 'the list opens').toBeVisible({ timeout: 20_000 });

  const parent = await list.evaluate((el) => el.parentElement?.tagName ?? '(none)');
  const listZ = await list.evaluate((el) => Number(getComputedStyle(el).zIndex) || 0);
  // The modal overlay is the fixed, full-screen ancestor of the form.
  const overlayZ = await page
    .locator('div[style*="position: fixed"][style*="inset"]')
    .first()
    .evaluate((el) => Number(getComputedStyle(el).zIndex) || 0)
    .catch(() => 0);
  // eslint-disable-next-line no-console
  console.log(`>> list parent=${parent} listZ=${listZ} overlayZ=${overlayZ}`);
  expect(parent, 'portaled to body').toBe('BODY');
  expect(listZ, 'the list must stack ABOVE the modal overlay').toBeGreaterThan(overlayZ);

  // The real proof: an option is hittable and picking it commits.
  const opt = page.locator('#pmClient-listbox [role="option"]').first();
  await expect(opt, 'an option is visible').toBeVisible({ timeout: 20_000 });
  const label = (await opt.innerText()).trim();
  await opt.click();
  await page.waitForTimeout(1200);
  const committed = await clientBox.inputValue();
  // eslint-disable-next-line no-console
  console.log(`>> picked "${label}" → field shows "${committed}"`);
  expect(committed.length, 'the pick committed into the field').toBeGreaterThan(0);

  // And the cascade wakes up: SO/JWSO stops being disabled once a client exists.
  const orderBox = page.getByPlaceholder(/Type SO \/ JWSO no|Pick a client first/i).first();
  await expect(orderBox, 'SO/JWSO enables after a client is picked').toBeEnabled({
    timeout: 15_000,
  });
});
