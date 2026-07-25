import { expect, test } from '@playwright/test';

/**
 * Feature regression specs for recent work (authenticated — the `chromium`
 * project reuses the login session from auth.setup.ts). These assert stable UI
 * and the specific fixes shipped, not transient data.
 *
 * Covered:
 *  - Stock Ledger search now matches the item code (ADR: grn_qc/dispatch rows
 *    have null item_code_text but resolve via the items JOIN).
 *  - OSP At-Vendor Register reconciliation columns incl. the new "In QC".
 *  - QC Call Register: two panes + the "History & Export" link (QC consolidation).
 *
 * NOTE: these are authenticated + data-dependent, so they need the API reachable
 * from the test browser. Against localhost the live Railway API blocks the
 * localhost:5173 origin (add it to the API's ALLOWED_ORIGINS to run locally).
 * They pass as-is against the deployed site (CORS-allowed) — e.g. run with a
 * config whose `use.baseURL` is the pages.dev URL and no `webServer`. Verified
 * green against the deployed site (2026-07-25).
 */

test.describe('recent features', () => {
  test('Stock Ledger search finds an item by its code', async ({ page }) => {
    await page.goto('/store-transactions', { waitUntil: 'domcontentloaded' });
    // The search box now matches item code/name (not just source_ref/remarks).
    await page.getByPlaceholder(/Search/i).fill('554117240000');
    // Debounced 300ms → the ledger reloads filtered; the item code renders via
    // the items JOIN even though the grn_qc rows carry a null item_code_text.
    await expect(page.getByText('554117240000').first()).toBeVisible({ timeout: 15_000 });
  });

  test('OSP At-Vendor Register shows the reconciliation columns', async ({ page }) => {
    await page.goto('/osp-wip', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('OSP At-Vendor Register').first()).toBeVisible({ timeout: 25_000 });
    for (const col of ['At Vendor', 'In QC', 'Accepted', 'Not Sent']) {
      await expect(page.getByRole('columnheader', { name: col }).first()).toBeVisible();
    }
  });

  test('QC Call Register: two panes + History & Export link', async ({ page }) => {
    await page.goto('/qc-call-register', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('QC Pending Calls')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('QC Completed Log')).toBeVisible();
    await expect(page.getByRole('link', { name: /History & Export/i })).toBeVisible();
  });
});
