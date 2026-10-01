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
