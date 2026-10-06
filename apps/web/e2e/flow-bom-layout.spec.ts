import { expect, test } from '@playwright/test';
import {
  bomPartGrade,
  bomPartItemName,
  bomPartRemove,
  bomPartRows,
  bomPartSize,
  bomPartType,
} from './bom-form';

// Layout guard for the BOM screen's Child Items table. At 900 / 1280 / 1600 px:
//   * the page itself never scrolls sideways
//   * every control on a part row is reachable, INCLUDING the four at the end
//     of the row — BOM Type, RM Grade, RM Size and the delete button. Those are
//     the ones a naive "make it fit" squeezes to nothing: the row went from 6
//     columns to 8 when RM Grade and RM Size stopped being a sub-row of their
//     own and became columns, so the end of the row is where the space runs out
//     first. Below the table's natural width the list scrolls inside its own
//     block (.tbl-wrap) instead, which keeps them reachable rather than hidden.
//   * adding a part and deleting one leaves exactly one part row, renumbered.
//
// This spec used to locate `.bomx-row` / `.bomx-del` / `.bomx-num` — classes the
// app dropped — so it could only ever fail as "element not found". Every locator
// now comes from ./bom-form, which keys on the form's own field ids and aria
// labels.
//
// Read-only: drives /bom-masters/new and never saves.
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@bomlayout"

const PARENT = '723009000000';
const CHILD = '724639000000';
const WIDTHS = [900, 1280, 1600];

test('@bomlayout no row overflows and every control stays reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/bom-masters/new');
  await expect(page.getByText('New BOM', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Build one real row so there is something to measure.
  const parent = page.locator('#bom-parent-item');
  await parent.click();
  await parent.fill(PARENT);
  const po = page.locator('#bom-parent-item-listbox [role="option"]', { hasText: PARENT });
  await expect(po.first()).toBeVisible({ timeout: 20_000 });
  await po.first().click();

  await page.getByRole('button', { name: /Add child item/i }).click();
  const child = page.locator('#bom-item-0');
  await child.click();
  await child.fill(CHILD);
  const co = page.locator('#bom-item-0-listbox [role="option"]', { hasText: CHILD });
  await expect(co.first()).toBeVisible({ timeout: 20_000 });
  await co.first().click();
  await page.keyboard.press('Escape');

  // The row's Item Name is now a plain text cell, so a resolved code is also
  // the proof the measurements below are taken on a real, filled part row.
  await expect(bomPartItemName(page, 0), 'the part row resolved its item').not.toHaveText(
    /auto-filled/i,
    { timeout: 20_000 },
  );

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300);

    // 1. The PAGE must not scroll sideways.
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    // 2. The four controls at the end of the row must be laid out and hittable.
    //    Each is scrolled into view first — on a narrow screen they are off the
    //    right edge of the table's own scroller, which is allowed; being
    //    squeezed to nothing is not.
    const type = bomPartType(page, 0);
    const grade = bomPartGrade(page, 0);
    const size = bomPartSize(page, 0);
    const del = bomPartRemove(page, 0);

    await type.scrollIntoViewIfNeeded();
    const typeBox = await type.boundingBox();
    await grade.scrollIntoViewIfNeeded();
    const gradeBox = await grade.boundingBox();
    await size.scrollIntoViewIfNeeded();
    const sizeBox = await size.boundingBox();
    await del.scrollIntoViewIfNeeded();
    const delBox = await del.boundingBox();

    // 3. Proof of reachability, not just of presence: actually operate them.
    await type.selectOption('purchase');
    await expect(type).toHaveValue('purchase');
    await type.selectOption('manufacture');
    await expect(grade).toBeEditable();
    await expect(size).toBeEditable();
    await expect(del).toBeEnabled();

    // eslint-disable-next-line no-console
    console.log(
      `>> ${width}px: page overflow ${pageOverflow}px | Type ${Math.round(typeBox?.width ?? 0)}×${Math.round(typeBox?.height ?? 0)} | RM Grade ${Math.round(gradeBox?.width ?? 0)} | RM Size ${Math.round(sizeBox?.width ?? 0)} | Delete ${Math.round(delBox?.width ?? 0)}×${Math.round(delBox?.height ?? 0)}`,
    );

    expect(pageOverflow, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
    expect(typeBox?.width ?? 0, `BOM Type select collapsed at ${width}px`).toBeGreaterThan(100);
    expect(gradeBox?.width ?? 0, `RM Grade picker collapsed at ${width}px`).toBeGreaterThan(100);
    expect(sizeBox?.width ?? 0, `RM Size picker collapsed at ${width}px`).toBeGreaterThan(100);
    expect(delBox?.width ?? 0, `Delete button collapsed at ${width}px`).toBeGreaterThan(24);
  }

  // Deleting renumbers: add a second (blank) row, remove the FIRST one, and the
  // survivor is part 1 — counted by the rows that actually hold an item picker,
  // so the "No child items yet" row can never be mistaken for a part.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: /Add child item/i }).click();
  await expect(bomPartRows(page)).toHaveCount(2);

  await bomPartRemove(page, 0).click();
  await expect(bomPartRows(page)).toHaveCount(1);
  await expect(
    bomPartRows(page).first().locator('td').first(),
    'the survivor is Sr No 1',
  ).toHaveText('1');
  // And it is the row that survived, not the row that was deleted: the one left
  // is the blank second row, whose Item Name still reads "auto-filled".
  await expect(bomPartItemName(page, 0), 'the FIRST row is the one that went').toHaveText(
    /auto-filled/i,
  );
  // eslint-disable-next-line no-console
  console.log('>> delete removes that row and the remaining rows renumber');
});
