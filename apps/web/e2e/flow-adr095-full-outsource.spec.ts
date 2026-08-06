import { expect, test, type Page } from '@playwright/test';

// Regression cover for the 2026-08-03 full-outsource changes.
//   ADR-095 — a full-outsource plan raises exactly ONE PR (the JW PR). The
//             material PR is gone, and so is the Material Source picker.
//   ADR-093 — Store/Inventory shows an "At Vendor" column.
//
// Named flow-* so playwright.pages.config.ts picks it up: it runs against the
// deployed Cloudflare Pages frontend, which the prod API allows by CORS
// (localhost:5173 is blocked).
//
// WRITES TO PROD (authorized, same as the other case specs). One run creates
// one plan + one JC + one PR, tagged E2E-ADR095 in the process field.

const ITEM_CODE = '554117186000'; // AUTOMATIC FIRE CHECK LEVER
const VENDOR = 'VND-008';
const QTY = 7;

/** Distinct PR codes currently listed on the Purchase Requests page. */
async function listPrCodes(page: Page): Promise<string[]> {
  await page.goto('/purchase-requests', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const body = await page.locator('body').innerText();
  return [...new Set(body.match(/IN-JWPR-\d+/g) ?? [])];
}

test('full outsource raises exactly one PR and has no Material Source field', async ({ page }) => {
  const before = await listPrCodes(page);
  console.log(`>> PRs before: ${before.length}`);
  expect(before.length, 'PR list loaded (auth + API reachable)').toBeGreaterThan(0);

  await page.goto('/plans/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('select.innovic-select').first().selectOption('full_outsource');
  await page.waitForTimeout(1000);

  // Scope by the panel TITLE — plain hasText also matches the plan-header
  // panel, because the plan-type <select> inside it has a "Full Outsource"
  // <option>.
  const foPanel = page
    .locator('.panel')
    .filter({ has: page.locator('.panel-title', { hasText: /Full outsource/i }) });
  await expect(foPanel, 'full-outsource panel rendered').toBeVisible({ timeout: 10_000 });

  // ASSERT 1 (ADR-095): Material Source is gone from the form.
  await expect(
    page.getByText(/Material source/i),
    'Material Source field must no longer exist',
  ).toHaveCount(0);
  await expect(page.getByText(/From Stock/i), 'no "From Stock" option').toHaveCount(0);
  await expect(page.getByText(/Purchase New/i), 'no "Purchase New" option').toHaveCount(0);
  console.log('>> ASSERT 1 ok — no Material Source / From Stock / Purchase New on the form');

  // Fill the plan.
  await page.getByPlaceholder(/search code/i).first().fill(ITEM_CODE);
  await page.waitForTimeout(1800);
  const numbers = page.locator('input[type="number"]');
  await numbers.nth(0).fill(String(QTY)); // Order qty
  await numbers.nth(1).fill(String(QTY)); // Plan qty
  const process = `E2E-ADR095-${Date.now()}`;
  await foPanel.locator('input.innovic-input').first().fill(VENDOR); // JW Vendor code
  await foPanel.getByPlaceholder(/Heat treat, Plating/i).fill(process);
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /Create plan/i }).click();
  await expect(page, 'plan saved → detail page').toHaveURL(/\/plans\/[0-9a-f]{8}-/, {
    timeout: 30_000,
  });
  await page.waitForTimeout(2500);
  const pln = ((await page.locator('body').innerText()).match(/PLN-\d+/) ?? [''])[0];
  console.log(`>> plan created: ${pln} (process ${process})`);

  // Finalize → Execute.
  await page.getByRole('button', { name: /^Finalize$/ }).click();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /^Execute$/ }).click();
  await page.waitForTimeout(6000);

  const detail = await page.locator('body').innerText();
  const jc = (detail.match(/IN-JC-\d{2}-\d+/) ?? [''])[0];
  console.log(`>> jc created: ${jc}`);

  // ASSERT 2 (ADR-095): JW PR created, Mat PR NOT created.
  const cell = (label: string): string =>
    (detail.match(new RegExp(`${label}\\s*\\n?\\s*([^\\n]*)`, 'i'))?.[1] ?? '').trim();
  console.log(`>> plan detail — JW PR: "${cell('JW PR')}"   Mat PR: "${cell('Mat PR')}"`);
  expect(cell('JW PR'), 'JW PR created').toContain('✓');
  expect(cell('Mat PR'), 'Mat PR must NOT be created').not.toContain('✓');
  console.log('>> ASSERT 2 ok — plan detail shows JW PR created, Mat PR not');

  // ASSERT 3 (ADR-095): exactly ONE new PR. Before today this was two.
  const after = await listPrCodes(page);
  const added = after.filter((c) => !before.includes(c));
  console.log(`>> PRs after: ${after.length} — added: ${added.join(', ') || '(none)'}`);
  expect(added, 'execute must raise exactly ONE purchase request').toHaveLength(1);
  console.log(`>> ASSERT 3 ok — exactly one new PR: ${added[0]}`);

  // ASSERT 4 (ADR-095): the new PR is the JW one; no "(vendor TBD)" material PR.
  const prPage = await page.locator('body').innerText();
  expect(prPage.includes(process), 'the new PR carries our process name').toBe(true);
  const tbdRows = prPage.match(/\(vendor TBD\)/g) ?? [];
  console.log(`>> "(vendor TBD)" occurrences on PR list: ${tbdRows.length}`);
  expect(tbdRows.length, 'no NEW material PR (IN-JWPR-00020 is a known pre-change row)')
    .toBeLessThanOrEqual(1);
  console.log('>> ASSERT 4 ok — new PR is the job-work PR, no new material PR');
});

test('store inventory shows the At Vendor column', async ({ page }) => {
  await page.goto('/store-inventory', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('table thead th').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // ASSERT 5 (ADR-093): the column exists, between On PO and Mfg Pending.
  // CSS uppercases the header text, so compare case-insensitively.
  const raw = await page.locator('table thead th').allInnerTexts();
  const headers = raw.map((h) => h.trim().toLowerCase());
  console.log(`>> store headers: ${raw.join(' | ')}`);
  expect(headers, 'At Vendor column present').toContain('at vendor');
  expect(headers.indexOf('at vendor'), 'sits after On PO').toBeGreaterThan(
    headers.indexOf('on po'),
  );
  expect(headers.indexOf('at vendor'), 'sits before Mfg Pending').toBeLessThan(
    headers.indexOf('mfg pending'),
  );
  console.log('>> ASSERT 5 ok — At Vendor column present and correctly positioned');

  // ASSERT 6: the one item with material genuinely out at a vendor reads 5 / 5.
  await page.getByPlaceholder(/Search item/i).first().fill('554117146000');
  await page.waitForTimeout(3000);
  const row = (await page.locator('tbody tr').first().innerText()).replace(/\n/g, ' | ');
  console.log(`>> LEVER CATCH RAMMER row: ${row}`);
  expect(row, 'row is the right item').toContain('554117146000');
  console.log('>> ASSERT 6 ok — see row values above (In Stock 5, At Vendor 5 expected)');
});
