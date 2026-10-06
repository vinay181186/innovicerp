import type { Locator, Page } from '@playwright/test';

// The BOM create / edit form's DOM, in ONE place.
//
// Not a *.spec.ts, so Playwright never runs it as a test.
//
// Why this file exists: five BOM specs each hard-coded their own way to reach a
// part row and the Item Name, and when the form was rebuilt (ADR BOM→RM, child
// table 6 → 8 columns) every one of them broke the same way — they located
// `.bomx-row` / `.bomx-del` / `.bomx-num`, classes the app had already dropped,
// and an `input[placeholder="auto-filled"]` that is no longer an input at all.
// A locator that matches NOTHING fails as "element not found", which reads like
// a broken screen rather than a stale test. So everything DOM-shaped lives here.
//
// Each locator below hangs off something the form promises to keep: the field
// ids (#bom-item-N, #bom-line-grade-N, #bom-line-size-N), the row's own aria
// labels, or the column order of the Child Items table.

/** Column order of the Child Items table (8 cells per part row). */
const COL = {
  srNo: 0,
  itemCode: 1,
  itemName: 2,
  qtyPerSet: 3,
  bomType: 4,
  rmGrade: 5,
  rmSize: 6,
  remove: 7,
} as const;

/** Every PART row of the Child Items table — a row is a part because it holds
 *  an item picker (`#bom-item-N`). Keyed on the id and not on the table's
 *  classes, and it excludes the "No child items yet" / "Locked" empty-state row
 *  on purpose: this is the count of parts, so `toHaveCount(1)` means one part. */
export function bomPartRows(page: Page): Locator {
  // `[role="combobox"]` pins it to the picker INPUT: the open dropdown's own
  // element is `#bom-item-N-listbox`, which shares the prefix.
  return page.locator('tr').filter({ has: page.locator('[id^="bom-item-"][role="combobox"]') });
}

/** The part row carrying line `idx` (0-based, as the field ids number them). */
export function bomPartRow(page: Page, idx: number): Locator {
  return page.locator('tr').filter({ has: page.locator(`#bom-item-${idx}`) });
}

/** A part's Item Name. Resolved from the code and never typed, so since the
 *  rebuild it is plain TEXT in its own column — not a read-only input. Reads
 *  "auto-filled" until a code resolves. */
export function bomPartItemName(page: Page, idx: number): Locator {
  return bomPartRow(page, idx).locator('td').nth(COL.itemName);
}

export function bomPartQty(page: Page, idx: number): Locator {
  return bomPartRow(page, idx).locator('td').nth(COL.qtyPerSet).locator('input[type="number"]');
}

export function bomPartType(page: Page, idx: number): Locator {
  return bomPartRow(page, idx).locator('td').nth(COL.bomType).locator('select');
}

/** RM Grade / RM Size are COLUMNS on the part row now (they used to sit on a
 *  raw-material sub-row of their own). Same ids as before. */
export function bomPartGrade(page: Page, idx: number): Locator {
  return page.locator(`#bom-line-grade-${idx}`);
}

export function bomPartSize(page: Page, idx: number): Locator {
  return page.locator(`#bom-line-size-${idx}`);
}

/** The row's delete button, found by the aria label the form gives it
 *  ("Remove line 1" — 1-based, and it renumbers after a delete). */
export function bomPartRemove(page: Page, idx: number): Locator {
  return bomPartRow(page, idx).getByRole('button', { name: `Remove line ${idx + 1}` });
}

/** The PARENT's Item Name. Also resolved-never-typed, so it is a read-only
 *  fact in the Parent Item cluster: label "Item Name", value beside it. While
 *  nothing is resolved the value reads "auto-filled" / "Checking Item Master…"
 *  / "Not in Item Master" / "Loading…". */
export function bomParentItemName(page: Page): Locator {
  return page
    .locator('.cl-fact')
    .filter({ has: page.getByText('Item Name', { exact: true }) })
    .locator('.cl-fact-v');
}
