import { expect, test } from '@playwright/test';

// Clicking a code field must show the item master, not the last field's search.
//
// Callers keep ONE search string for a whole form (the BOM parent + every child
// line share one; so do the SO line pickers), so a freshly opened picker used
// to inherit whatever the previous field searched for. On the BOM screen that
// meant the child dropdown opened showing exactly one row — the parent just
// picked, the one item a child may NOT be. SearchableSelect now re-syncs the
// caller's term to its own input on open, so an empty field asks for '' and
// gets the unfiltered first page.
//
// Read-only: drives /bom-masters/new and never saves.
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@bombrowse"

const PARENT = '723009000000';

test('@bombrowse the child code field lists the item master, not the parent’s search', async ({
  page,
}) => {
  await page.goto('/bom-masters/new');
  await expect(page.getByText('📦 New BOM')).toBeVisible({ timeout: 30_000 });

  // Narrow the shared list right down by searching the parent by full code.
  const parent = page.locator('#bom-parent-item');
  await parent.click();
  await parent.fill(PARENT);
  const opt = page.locator('#bom-parent-item-listbox [role="option"]', { hasText: PARENT });
  await expect(opt.first()).toBeVisible({ timeout: 20_000 });
  await opt.first().click();

  await page.getByRole('button', { name: /Add Item/i }).click();

  // Click the child field WITHOUT typing — the regression is here.
  await page.locator('#bom-item-0').click();
  const rows = page.locator('#bom-item-0-listbox [role="option"]');
  await expect.poll(async () => rows.count(), { timeout: 20_000 }).toBeGreaterThan(1);
  const n = await rows.count();
  // eslint-disable-next-line no-console
  console.log(`>> child dropdown on click (no typing): ${n} option(s)`);

  // And it must contain items OTHER than the parent — that is the whole point.
  const first = (await rows.first().textContent()) ?? '';
  const texts = await rows.allTextContents();
  expect(texts.some((t) => !t.includes(PARENT))).toBe(true);
  // eslint-disable-next-line no-console
  console.log(`>> first row: ${first.trim()}`);

  // Typing still narrows it.
  await page.locator('#bom-item-0').fill('724639000000');
  await expect
    .poll(async () => rows.count(), { timeout: 20_000 })
    .toBeLessThan(n);
  // eslint-disable-next-line no-console
  console.log(`>> after typing a full code: ${await rows.count()} option(s)`);
});
