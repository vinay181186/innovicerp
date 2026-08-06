import { expect, type Page } from '@playwright/test';

// Shared, PROVEN step helpers extracted from the green Case 1 run. Reused by the
// case specs so each flow doesn't re-debug the same forms. All write to prod
// (authorized). Not a *.spec.ts so Playwright won't run it as a test.

export const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad';

export const ITEM_CODE = '559918151000';
export const ITEM_LABEL = /559918151000 — SPACER/;

export function makeLog(docs: Record<string, string>) {
  return (k: string, v: string) => { docs[k] = v; /* eslint-disable-next-line no-console */ console.log(`>> ${k}: ${v}`); };
}
export function makeGuard(guards: Record<string, string>) {
  return (k: string, v: string) => { guards[k] = v; /* eslint-disable-next-line no-console */ console.log(`GUARD ${k}: ${v}`); };
}
export async function snap(page: Page, prefix: string, n: string): Promise<void> {
  await page.screenshot({ path: `${SHOT}/${prefix}-${n}.png`, fullPage: true }).catch(() => {});
}

/** Type-to-search picker: type `term`, click the option matching `optText`. */
export async function pick(page: Page, ph: RegExp, term: string, optText: RegExp): Promise<void> {
  const input = page.getByPlaceholder(ph).first();
  await input.click(); await input.fill(term); await page.waitForTimeout(1300);
  await page.getByText(optText).first().click();
  await page.waitForTimeout(500);
}

/** Create a Sales Order (Demo client, given item+qty). Returns the SO number.
 *  Uses a UNIQUE client-PO ref (the field must be unique across SO+JW). */
export async function createSO(page: Page, qty: number, poTag: string): Promise<string> {
  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const soNo = await page.locator('input[value^="IN-SO-"]').first().inputValue();
  await pick(page, /Type client code or name/i, 'Demo', /CLI-DEMO — Demo Engineering Works/);
  await page.getByPlaceholder(/Client PO reference/i).fill(`${poTag}-${Date.now()}`);
  await pick(page, /Search item code or name/i, ITEM_CODE, ITEM_LABEL);
  await page.getByPlaceholder('Qty', { exact: true }).first().fill(String(qty));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Save SO/i }).click();
  await expect(page, 'SO saved').toHaveURL(/sales-orders\/[0-9a-f]{8}-/, { timeout: 20_000 });
  return soNo;
}

/** Open the SO in planning, create a Manufacture plan with the given in-house
 *  op names, save + execute. Returns { pln, jc }. */
export async function planExecuteInhouse(
  page: Page, soNo: string, opNames: string[],
): Promise<{ pln: string; jc: string }> {
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search SO/i).fill(soNo);
  await page.waitForTimeout(2000);
  await expect(page.getByText(soNo).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText(soNo).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /\+ ?Plan/i }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(2500);
  const planTitle = (await page.locator('text=/Plan:\\s*PLN-/i').first().innerText().catch(() => '')) || '';
  const pln = (planTitle.match(/PLN-\d+/) || [''])[0];
  const rows = page.locator('table.ops-routing tbody tr');
  const del = page.locator('table.ops-routing tbody tr button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i--) { await del.nth(i).click(); await page.waitForTimeout(250); }
  const addOp = page.getByRole('button', { name: /\+ Add Op$/ });
  for (let i = 0; i < opNames.length; i++) { await addOp.click(); await page.waitForTimeout(500); }
  await expect(rows).toHaveCount(opNames.length, { timeout: 10_000 });
  for (let i = 0; i < opNames.length; i++) { await rows.nth(i).getByPlaceholder('Operation name').fill(opNames[i]!); await page.waitForTimeout(200); }
  for (let i = 0; i < opNames.length; i++) {
    const mach = rows.nth(i).getByPlaceholder(/Machine/i);
    await mach.click(); await mach.fill('a'); await page.waitForTimeout(1300);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await rows.nth(i).getByPlaceholder('Operation name').click();
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: /Save Plan/i }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Execute/i }).first().click();
  await page.waitForTimeout(4500);
  const jc = ((await page.locator('body').innerText()).match(/IN-JC-\d{2}-\d+/) || [''])[0];
  return { pln, jc };
}

/** Load a JC in Op Entry. */
export async function opEntryLoad(page: Page, jcNo: string): Promise<void> {
  await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/IN-JC-/i).fill(jcNo);
  await page.getByRole('button', { name: /^Load$/ }).click();
  await page.waitForTimeout(3000);
}

/** Log full qty on a process op (op must be selected by its operation name). */
export async function opLog(page: Page, opName: string, qty: number): Promise<void> {
  await page.getByText(opName, { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('spinbutton').first().fill(String(qty));
  await page.getByPlaceholder(/Operator name/i).fill('E2E Auto').catch(() => {});
  await page.getByRole('button', { name: /Submit completion/i }).click();
  await page.waitForTimeout(3000);
}

/** Accept qty on a QC op (e.g. 'DIR'). */
export async function qcAccept(page: Page, opName: string, qty: number): Promise<void> {
  await page.getByText(opName, { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole('spinbutton').first().fill(String(qty)); // ACCEPTED QTY
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Submit QC inspection/i }).click();
  await page.waitForTimeout(3500);
}

/** Add a dispatch/invoice/... line: select SO, Add Line, pick item. */
async function selectSoAndAddLine(page: Page, soNo: string): Promise<void> {
  const sels = page.locator('select');
  for (let s = 0; s < (await sels.count()); s++) {
    const opts = await sels.nth(s).locator('option').allInnerTexts();
    const idx = opts.findIndex((t) => t.includes(soNo));
    if (idx >= 0) { await sels.nth(s).selectOption({ index: idx }); break; }
  }
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: /Add Line/i }).click();
  await page.waitForTimeout(1200);
  const item = page.getByPlaceholder(/code or name/i).first();
  await item.click(); await item.fill(ITEM_CODE); await page.waitForTimeout(1500);
  await page.getByText(ITEM_LABEL).first().click().catch(async () => { await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); });
  await page.waitForTimeout(1000);
}

/** Customer Dispatch of qty against a SO. Returns DSP number + the UI qty cap. */
export async function dispatch(page: Page, soNo: string, qty: number): Promise<{ dsp: string; max: string | null }> {
  await page.goto('/customer-dispatches/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await selectSoAndAddLine(page, soNo);
  const dqty = page.locator('input[type="number"]').last();
  const max = await dqty.getAttribute('max').catch(() => null);
  await dqty.fill(String(qty));
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Create Dispatch/i }).click();
  await page.waitForTimeout(3500);
  const dsp = ((await page.locator('body').innerText()).match(/DSP-\d+/) || [''])[0];
  return { dsp, max };
}

/** Invoice of qty against a SO. Returns INV number + the UI qty cap. */
export async function invoice(page: Page, soNo: string, qty: number): Promise<{ inv: string; max: string | null }> {
  await page.goto('/invoices/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await selectSoAndAddLine(page, soNo);
  const nums = page.locator('input[type="number"]');
  let filledQty = false; let max: string | null = null;
  for (let k = 0; k < (await nums.count()); k++) {
    if (!(await nums.nth(k).isEditable().catch(() => false))) continue;
    const v = await nums.nth(k).inputValue().catch(() => '');
    if (v === '' && !filledQty) { max = await nums.nth(k).getAttribute('max').catch(() => null); await nums.nth(k).fill(String(qty)); filledQty = true; }
    else if (v === '0') { await nums.nth(k).fill('10'); }
  }
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Create Invoice/i }).click();
  await page.waitForTimeout(3500);
  const inv = ((await page.locator('body').innerText()).match(/INV-\d+/) || [''])[0];
  return { inv, max };
}
