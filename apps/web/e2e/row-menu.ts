// Row-action helpers for the ⋯ row menu (apps/web/src/ui/data/RowMenu.tsx).
//
// Every table row's actions now live behind one ⋯ button (accessible name
// "Actions"). The menu itself is portalled to <body> (role=menu), so its items
// are found on the PAGE, never inside the row. A greyed item carries
// aria-disabled="true" and does nothing when clicked.
import type { Locator, Page } from '@playwright/test';

type Name = string | RegExp;

/** Open the ⋯ menu of `row` and return the menu (role=menu) locator. */
export async function openRowMenu(page: Page, row: Locator): Promise<Locator> {
  await row.getByRole('button', { name: 'Actions' }).first().click();
  const menu = page.getByRole('menu');
  await menu.first().waitFor({ state: 'visible', timeout: 10_000 });
  return menu.first();
}

/** Close an open ⋯ menu without running anything. */
export async function closeRowMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

/** Open the row's ⋯ menu and click the item `name`. */
export async function clickRowMenuItem(page: Page, row: Locator, name: Name): Promise<void> {
  await openRowMenu(page, row);
  await page.getByRole('menuitem', { name }).first().click();
}

/** Whether the row has an ENABLED ⋯ item `name` (the old "button is shown").
 *  Opens the menu to look, then closes it again with Escape. A row with no ⋯
 *  at all, a missing item or a greyed (aria-disabled) item all give false. */
export async function hasRowMenuItem(page: Page, row: Locator, name: Name): Promise<boolean> {
  if ((await row.getByRole('button', { name: 'Actions' }).count()) === 0) return false;
  await openRowMenu(page, row);
  const item = page.getByRole('menuitem', { name }).first();
  const ok = (await item.count()) > 0 && (await item.getAttribute('aria-disabled')) !== 'true';
  await closeRowMenu(page);
  return ok;
}

/** The first of `rows` whose ⋯ menu has an ENABLED item `name`, or null.
 *  Opens each row's menu in turn and closes it again. */
export async function findRowWithMenuItem(
  page: Page,
  rows: Locator,
  name: Name,
): Promise<Locator | null> {
  const n = await rows.count();
  for (let i = 0; i < n; i += 1) {
    if (await hasRowMenuItem(page, rows.nth(i), name)) return rows.nth(i);
  }
  return null;
}

/** Click item `name` in the ⋯ of the first of `rows` that offers it enabled
 *  (the old "first matching button on the page"). Throws when no row does. */
export async function clickFirstRowMenuItem(page: Page, rows: Locator, name: Name): Promise<void> {
  await rows.first().waitFor({ state: 'visible', timeout: 30_000 });
  const row = await findRowWithMenuItem(page, rows, name);
  if (!row) throw new Error(`no row's ⋯ menu offers an enabled "${String(name)}"`);
  await clickRowMenuItem(page, row, name);
}

/** SO Planning order-line rows: their ⋯ is named "Actions for line N"
 *  (Plan N · Raise PR · BOM Planning · Equipment BOM · Allocate · Release). */
export function planningLineRows(page: Page): Locator {
  return page
    .locator('tr')
    .filter({ has: page.getByRole('button', { name: /^Actions for line/ }) });
}
