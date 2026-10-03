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

// ── SO Planning: the per-plan actions (ADR-208) ─────────────────────────────
// Until the line table moved onto the shared FIT table, a plan's actions were
// buttons inside its chip in the Plans cell: "⚡ Create JC", "⚡ Raise PR",
// "✏ Edit". They are ⋯ items now, each prefixed with its plan code so a line
// carrying several plans stays readable — "PLN-0013 · Create JC". Match on the
// suffix, or pass the plan code when you mean one particular plan.

/** The ⋯ item that lets a plan out to the floor (the old ⚡ button). */
export const EXECUTE_PLAN_ITEM = /·\s*(Create JC|Raise PR)$/;
/** The ⋯ item that reopens a plan for editing (the old ✏ button). */
export const EDIT_PLAN_ITEM = /·\s*Edit plan$/;

/** Open every collapsed ▸ on the page, so the detail panels can be read.
 *  The fit table puts a row's extra columns and its plan chips in there. */
export async function expandPlanningRows(page: Page): Promise<void> {
  // By ROLE and NAME, never `button.dt-exp`. The fit table keeps a hidden
  // measuring copy of itself mounted at all times (ColumnMeasurer), and every
  // sampled row in it carries the same `.dt-exp` class with no aria-label and
  // no aria-expanded. A CSS locator therefore finds twice as many carets as
  // there are rows and tries to click one inside `visibility: hidden`, which
  // waits for the test timeout instead of failing. getByRole skips anything
  // hidden from the accessibility tree.
  const carets = page.getByRole('button', { name: 'Show row details' });
  // Each click removes one caret from this set (its name flips to "Hide row
  // details"), so take the first one until none is left rather than indexing.
  for (let guard = 0; guard < 200; guard += 1) {
    if ((await carets.count()) === 0) return;
    await carets.first().click();
    await page.waitForTimeout(120);
  }
}

/** Let a plan out from the ⋯ of the first Planning line that offers it.
 *  Replaces `getByRole('button', {name: /Create JC|Raise PR/}).click()`.
 *  Polls, because the item only appears once Save Plan has landed. */
export async function executePlanFromMenu(page: Page, timeout = 60_000): Promise<void> {
  const rows = planningLineRows(page);
  await rows.first().waitFor({ state: 'visible', timeout });
  const deadline = Date.now() + timeout;
  for (;;) {
    const row = await findRowWithMenuItem(page, rows, EXECUTE_PLAN_ITEM);
    if (row) {
      await clickRowMenuItem(page, row, EXECUTE_PLAN_ITEM);
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error('no Planning line offers "… · Create JC" / "… · Raise PR" in its ⋯');
    }
    await page.waitForTimeout(1000);
  }
}

/** The ⋯ item for ONE named plan, e.g. `PLN-0013 · Create JC`.
 *
 *  Naming the plan in the MATCHER matters, not just in the row filter. A BOM
 *  line raises every child plan against the same SO line, so one row's ⋯
 *  carries the items of all of them — matching on the action alone would act on
 *  whichever plan happens to come first. */
function planItemName(planCode: string, name: Name): RegExp {
  // A plan code is `PLN-0046` — letters, digits and a hyphen, none of which is
  // a regex metacharacter outside a character class, so it needs no escaping.
  // Guard anyway rather than build a broken pattern in silence.
  if (!/^[A-Za-z0-9-]+$/.test(planCode)) {
    throw new Error(`planItemName: unexpected plan code ${planCode}`);
  }
  const action = typeof name === 'string' ? name : name.source;
  // The action patterns end-anchor the label (`· Create JC$`); the plan code
  // start-anchors it. Drop only a leading `^` from the action if it has one.
  return new RegExp(`^\\s*${planCode}\\s*${action.replace(/^\^/, '')}`);
}

/** Does the line carrying `planCode` offer THAT PLAN's ⋯ item, enabled? */
export async function hasPlanMenuItem(page: Page, planCode: string, name: Name): Promise<boolean> {
  const row = planningLineRows(page).filter({ hasText: planCode }).first();
  if ((await row.count()) === 0) return false;
  return hasRowMenuItem(page, row, planItemName(planCode, name));
}

/** Click THAT PLAN's ⋯ item on the line carrying it. */
export async function clickPlanMenuItem(page: Page, planCode: string, name: Name): Promise<void> {
  const row = planningLineRows(page).filter({ hasText: planCode }).first();
  await clickRowMenuItem(page, row, planItemName(planCode, name));
}
