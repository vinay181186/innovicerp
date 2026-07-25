import { expect, test } from '@playwright/test';

/**
 * Planning module — SO IN-SO-00525 (Nilkanth Engineering), LINE 2.
 *
 * Expected line 2 item (per production record):
 *   item code 721069535800 — "PLAIN WASHER | ISO 7089-10-200 HV- A4"
 *
 * READ-ONLY: this test navigates and asserts only. It never creates, edits,
 * or executes a plan, so it is safe against the live Supabase the dev server
 * points at.
 *
 * Flow mirrors the so-planning workflow page (routes/workflow.tsx):
 *   left pane = SO search + list, right pane = per-line cards ("LINE n").
 */

const SO_CODE = 'IN-SO-00525';
const LINE_NO = 2;
const ITEM_CODE = '721069535800';
const ITEM_NAME_FRAGMENT = 'PLAIN WASHER';

test.describe('Planning · IN-SO-00525', () => {
  test('LINE 2 shows the PLAIN WASHER item', async ({ page }) => {
    test.setTimeout(90_000); // live prod data load
    await page.goto('/planning', { waitUntil: 'domcontentloaded' });

    // Left pane: filter the SO list down to our SO, then open it.
    const search = page.getByPlaceholder(/Search SO/i);
    await expect(search).toBeVisible();
    await search.fill(SO_CODE);

    const soRow = page.getByText(SO_CODE, { exact: true });
    await expect(soRow).toBeVisible({ timeout: 15_000 });
    await soRow.click();

    // Right pane header confirms the SO opened.
    await expect(
      page.getByText(new RegExp(`Planning:\\s*${SO_CODE}`)),
    ).toBeVisible({ timeout: 15_000 });

    // Locate the LINE 2 card. Each line renders in a `.card`; the header shows
    // an exact "LINE 2" label — anchor on that to avoid matching LINE 20+.
    const line2Card = page
      .locator('.card')
      .filter({ has: page.getByText(/^LINE 2$/) });
    await expect(line2Card).toBeVisible();

    // Assert the item on line 2.
    await expect(line2Card).toContainText(ITEM_CODE);
    await expect(line2Card).toContainText(ITEM_NAME_FRAGMENT);
  });
});
