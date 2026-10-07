// ADR-219 CASE 2 — THE SIX PROOFS. TEST STACK ONLY. Read-only: nothing is saved.
//
// Needs the chain built by adr219-case2-flow-build.spec.ts (state file
// apps/web/.playwright/adr219a-state.json).
//
// Run from apps/web/:
//   npx playwright test --config=playwright.pages.config.ts \
//     e2e/adr219-case2-flow-proofs.spec.ts --reporter=list
//
// The six proofs, in the owner's words:
//   1 the picker shows it (listed, orange, Return Challan Pending = 5)
//   2 an ordinary order is unmarked (no orange, cell EMPTY not 0)
//   3 the fresh cap did not move (Can Send Now = 5, not 10)
//   4 the warning states the total and names the route
//   5 the button lands on Against NC with the NC No. already searched
//   6 Against NC fills itself in
//
// STOPS BEFORE SAVING the return challan — proving 1-6 is the job.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { colIndex, log, readState, SEND_QTY, shot } from './adr219-case2-chain';

test.describe.configure({ mode: 'serial' });

/** The Against-PO picker table on /delivery-challans/new. */
function pickerTable(page: Page): Locator {
  return page
    .locator('table.innovic-table')
    .filter({ has: page.locator('th', { hasText: /^Return Challan Pending$/ }) })
    .first();
}

async function openPicker(page: Page): Promise<Locator> {
  await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-source').waitFor({ timeout: 90_000 });
  const table = pickerTable(page);
  await table.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 120_000 });
  await page.waitForTimeout(1500);
  return table;
}

/** Row text + the Return Challan Pending cell + whether it carries the wash. */
async function readRow(
  table: Locator,
  row: Locator,
): Promise<{ text: string; pending: string; marked: boolean; cls: string }> {
  const idx = await colIndex(table, /^Return Challan Pending$/);
  const cls = (await row.getAttribute('class')) ?? '';
  return {
    text: (await row.innerText()).replace(/\s+/g, ' ').trim(),
    pending: (await row.locator('td').nth(idx).innerText()).trim(),
    marked: /\brow-pending\b/.test(cls),
    cls,
  };
}

test('PROOF 1 - the picker lists the order, marks the row, and reads 5', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  const poCode = s.poCode!;
  expect(poCode, 'the chain must be built first (run the build spec)').toBeTruthy();

  const table = await openPicker(page);
  await page.locator('#dc-po-search').fill(poCode);
  await page.waitForTimeout(1500);
  const row = table.locator('tbody tr').filter({ hasText: poCode }).first();
  await expect(row, `${poCode} must still be listed in the Against PO picker`).toBeVisible({
    timeout: 60_000,
  });
  const r = await readRow(table, row);
  log(`PROOF 1 row: ${r.text}`);
  log(`PROOF 1 Return Challan Pending cell = "${r.pending}" · row class = "${r.cls}"`);
  await shot(page, 'p1-picker-marked');

  // The note above the table that explains the marked rows.
  const note = page.getByText(/Marked orders have deviated pieces waiting to go back to the vendor/);
  await expect(note, 'the note explaining the marked rows').toBeVisible({ timeout: 30_000 });

  expect(r.pending, 'Return Challan Pending on the order').toBe(String(SEND_QTY));
  expect(r.marked, `the row must carry the orange wash (class was "${r.cls}")`).toBe(true);
});

test('PROOF 2 - an ordinary order is unmarked and its cell is EMPTY, not 0', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  const poCode = s.poCode!;
  const table = await openPicker(page);
  const idx = await colIndex(table, /^Return Challan Pending$/);
  const rows = table.locator('tbody tr');
  const n = await rows.count();
  log(`PROOF 2 — ${n} orders in the picker`);

  const zeros: string[] = [];
  let clean: { code: string; text: string } | null = null;
  for (let i = 0; i < n; i += 1) {
    const row = rows.nth(i);
    const code = (await row.locator('td').first().innerText()).trim();
    if (code === poCode) continue;
    const cell = (await row.locator('td').nth(idx).innerText()).trim();
    const cls = (await row.getAttribute('class')) ?? '';
    if (cell === '0') zeros.push(code);
    if (cell === '' && !/\brow-pending\b/.test(cls) && clean === null) {
      clean = { code, text: (await row.innerText()).replace(/\s+/g, ' ').trim() };
    }
  }
  await shot(page, 'p2-picker-all');

  expect(
    zeros,
    `these rows printed a literal 0 in Return Challan Pending — the column must be blank when nothing waits: ${zeros.join(', ')}`,
  ).toEqual([]);
  expect(clean, 'at least one job-work / service order with nothing waiting to go back').toBeTruthy();
  log(`PROOF 2 clean order: ${clean!.code} — cell empty, no orange. Row: ${clean!.text}`);
});

test('PROOF 3 - the fresh cap did not move: Can Send Now = 5, not 10', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  const poId = s.poId!;
  expect(poId, 'the chain must be built first').toBeTruthy();

  await page.goto(`/delivery-challans/new?poId=${poId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-code').waitFor({ timeout: 120_000 });
  const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
  await expect(qtyBoxes).toHaveCount(1, { timeout: 120_000 });
  await page.waitForTimeout(2000);
  await shot(page, 'p3-cap');

  const lineText = (await page.locator('table.innovic-table tbody tr').first().innerText())
    .replace(/\s+/g, ' ')
    .trim();
  log(`PROOF 3 line: ${lineText}`);
  const cap = /Can send now:\s*([\d.]+)/.exec(lineText);
  expect(
    cap,
    `no "Can send now" figure on the line — the row read: ${lineText}`,
  ).toBeTruthy();
  log(`PROOF 3 Can send now = ${cap![1]}`);
  // The max attribute the input itself enforces must agree with the words.
  const maxAttr = await qtyBoxes.first().getAttribute('max');
  log(`PROOF 3 Send Now input max = ${maxAttr}`);
  expect(Number(cap![1]), 'Can Send Now must still be the FRESH balance (5), never 10').toBe(
    SEND_QTY,
  );
  expect(Number(maxAttr), 'the Send Now box must cap at the fresh balance too').toBe(SEND_QTY);
});

test('PROOF 4 - the warning states the total and names Against NC', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  const poId = s.poId!;
  const ncCode = s.ncCode!;

  await page.goto(`/delivery-challans/new?poId=${poId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-code').waitFor({ timeout: 120_000 });
  const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
  await expect(qtyBoxes).toHaveCount(1, { timeout: 120_000 });
  // The panel is scoped to the lines THIS challan would send (ADR-211), so a
  // quantity has to be on the line before it renders.
  await qtyBoxes.first().fill(String(SEND_QTY));
  await page.waitForTimeout(2500);

  const panel = page
    .locator('[role="alert"]')
    .filter({ hasText: /must go back to the vendor/ })
    .first();
  await expect(panel, 'the orange warning panel').toBeVisible({ timeout: 90_000 });
  const text = (await panel.innerText()).replace(/\s+/g, ' ').trim();
  log(`PROOF 4 panel: ${text}`);
  await shot(page, 'p4-warning');

  expect(text, 'the panel must lead with the TOTAL still to go back').toContain(
    `${SEND_QTY} pcs on this PO must go back to the vendor — send them separately`,
  );
  expect(text, 'it must say the pieces are not part of what this screen offers').toMatch(
    /not part of what this screen offers/i,
  );
  expect(text, 'it must name Against NC as the route').toMatch(/Raise the return on Against NC/i);
  expect(text, 'the deviation must be listed by its number').toContain(ncCode);
  expect(text, 'the deviation must be listed with 5 pcs').toMatch(
    new RegExp(`${SEND_QTY} pcs`),
  );
  expect(text, 'the button must name the total and the route').toContain(
    `Send the ${SEND_QTY} back → Against NC`,
  );
  expect(
    text,
    'the panel must NOT send the user to "Against JW PO / DC" (ADR-219: one name for the action)',
  ).not.toContain('Against JW PO / DC');
  await expect(
    panel.getByRole('button', { name: `Send the ${SEND_QTY} back → Against NC` }),
    'the button, as a real button',
  ).toBeVisible();
});

test('PROOF 5 - the button lands on Against NC with the NC No. already searched', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const s = readState();
  const poId = s.poId!;
  const ncCode = s.ncCode!;

  await page.goto(`/delivery-challans/new?poId=${poId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-code').waitFor({ timeout: 120_000 });
  const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
  await expect(qtyBoxes).toHaveCount(1, { timeout: 120_000 });
  await qtyBoxes.first().fill(String(SEND_QTY));
  await page.waitForTimeout(2500);

  await page
    .getByRole('button', { name: `Send the ${SEND_QTY} back → Against NC` })
    .click();
  // A typed quantity makes the form dirty, so the screen asks before dropping it.
  const confirm = page.getByRole('alertdialog').filter({ hasText: /Are you sure you want to exit/ });
  if (await confirm.count()) {
    log('PROOF 5 — the screen asked before dropping the typed quantity; pressed Exit');
    await confirm.getByRole('button', { name: 'Exit' }).click();
  }
  await page.waitForTimeout(2500);
  await shot(page, 'p5-landed');

  const source = await page.locator('#dc-source').inputValue();
  const seeded = await page.locator('#dc-nc-search').inputValue();
  log(`PROOF 5 — DC Against = "${source}" · Against NC search box = "${seeded}"`);
  expect(source, 'the source must have switched to Against NC').toBe('nc');
  expect(seeded, "the NC No. must already be in Against NC's search box").toBe(ncCode);
  // and the deviation it searched for is actually on screen
  await expect(
    page.locator('tbody tr').filter({ hasText: ncCode }).first(),
    'the deviation the button sent us to must be listed',
  ).toBeVisible({ timeout: 90_000 });
});

test('PROOF 6 - Against NC fills itself in', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  const ncCode = s.ncCode!;
  const poCode = s.poCode!;
  const dcCode = s.dcCode!;

  await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-source').waitFor({ timeout: 120_000 });
  await page.locator('#dc-source').selectOption('nc');
  await page.locator('#dc-nc-search').waitFor({ timeout: 60_000 });
  await page.locator('#dc-nc-search').fill(ncCode);
  await page.waitForTimeout(2000);
  const row = page.locator('tbody tr').filter({ hasText: ncCode }).first();
  await expect(row, `${ncCode} must be offered on Against NC`).toBeVisible({ timeout: 120_000 });
  log(`PROOF 6 picker row: ${(await row.innerText()).replace(/\s+/g, ' ').trim()}`);
  await row.getByRole('button', { name: /^Select$/ }).click();
  await page.locator('#ncdc-date').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2000);
  await shot(page, 'p6-against-nc-form');

  /** The value rendered under a read-only caption in the summary box. */
  const fact = async (label: string): Promise<string> => {
    const cell = page
      .locator('div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .last();
    return (await cell.innerText()).replace(label, '').replace(/\s+/g, ' ').trim();
  };
  const summary = (await page.locator('.panel, form').first().innerText())
    .replace(/\s+/g, ' ')
    .trim();
  log(`PROOF 6 summary: ${summary.slice(0, 700)}`);

  const jwPo = await fact('JW PO No.');
  const sentOn = await fact('Sent on DC No.');
  const qty = await fact('Qty to Return');
  log(`PROOF 6 — JW PO No. = "${jwPo}" · Sent on DC No. = "${sentOn}" · Qty to Return = "${qty}"`);

  expect(jwPo, 'JW PO No. must be read off the deviation').toContain(poCode);
  expect(sentOn, 'Sent on DC No. must be the outward challan the pieces went out on').toContain(
    dcCode,
  );
  expect(qty, 'Qty to Return must be 5 pcs').toMatch(new RegExp(`^${SEND_QTY} pcs$`));

  // Qty to Return is NOT an input anywhere on this form, and the only editable
  // fields are vendor / date / transporter / vehicle / remarks.
  const editable: string[] = [];
  const inputs = page.locator('form input:not([type="hidden"]), form textarea');
  const n = await inputs.count();
  for (let i = 0; i < n; i += 1) {
    const el = inputs.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    if (!(await el.isEditable().catch(() => false))) continue;
    const id = (await el.getAttribute('id')) ?? '';
    const ph = (await el.getAttribute('placeholder')) ?? '';
    editable.push(id || ph || '(unnamed)');
  }
  log(`PROOF 6 editable fields on the Against NC form: ${editable.join(', ')}`);
  for (const f of ['ncdc-date', 'ncdc-transport', 'ncdc-vehicle-no', 'ncdc-remarks']) {
    expect(editable, `${f} must be editable`).toContain(f);
  }
  expect(
    editable.filter((f) => /qty|return/i.test(f)),
    'nothing resembling a quantity may be editable on this form',
  ).toEqual([]);

  log('PROOF 6 done — STOPPING BEFORE SAVE, as instructed. No return challan was raised.');
});
