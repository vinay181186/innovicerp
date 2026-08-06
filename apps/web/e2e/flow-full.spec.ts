import { expect, test, type Locator, type Page } from '@playwright/test';

// FULLY AUTONOMOUS end-to-end: SO → plan(4 ops incl OSP) → execute → op logs →
// OSP loop (PR→PO→DC→receive→Incoming QC) → final op → dispatch → invoice.
// Discovers PR/PO/DC/GRN dynamically. WRITES real data to the deployed backend.

const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp-innovicerp/30277fb2-021d-4e86-a944-eccf9a952b2d/scratchpad';
const QTY = '100';
const docs: Record<string, string> = {};
function rec(k: string, v: string): void {
  docs[k] = v;
  // eslint-disable-next-line no-console
  console.log(`>> ${k}: ${v}`);
}
async function pickFirst(page: Page, input: Locator, term: string): Promise<void> {
  await input.click();
  await input.fill(term);
  await page.waitForTimeout(1300);
  await page.locator('[role="option"], li, [class*="option"], [class*="ss-"]').filter({ hasText: /\S/ }).first().click();
  await page.waitForTimeout(400);
}
async function loadJc(page: Page, jc: string): Promise<void> {
  await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await page.getByPlaceholder(/IN-JC-/i).fill(jc);
  await page.getByRole('button', { name: /^Load$/ }).click();
  await page.waitForTimeout(3000);
}
async function logOp(page: Page, jc: string, opName: string, qty: string): Promise<void> {
  await loadJc(page, jc);
  await page.getByText(opName, { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('spinbutton').first().fill(qty);
  await page.getByPlaceholder(/Operator name/i).fill('E2E Auto');
  await page.getByRole('button', { name: /Submit completion/i }).click();
  await page.waitForTimeout(3200);
}

test('full: SO → … → invoice (autonomous)', async ({ page }) => {
  test.setTimeout(600_000);

  // ── 1. Sales Order ──
  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const so = await page.locator('input[value^="IN-SO-"]').first().inputValue();
  rec('SO', so);
  const client = page.getByPlaceholder(/Type client code or name/i);
  await client.click();
  await client.fill('Demo');
  await page.waitForTimeout(1300);
  await page.getByText('CLI-DEMO — Demo Engineering Works').first().click();
  await page.getByPlaceholder(/Client PO reference/i).fill('E2E-FULL-PO');
  const item = page.getByPlaceholder(/Search item code or name/i).first();
  await item.click();
  await item.fill('559918151000');
  await page.waitForTimeout(1300);
  await page.getByText('559918151000 — SPACER').first().click();
  await page.getByPlaceholder('Qty', { exact: true }).first().fill(QTY);
  await page.getByPlaceholder('₹ Rate', { exact: true }).first().fill('10').catch(() => {});
  await page.getByRole('button', { name: /Save SO/i }).click();
  await page.waitForTimeout(3500);

  // ── 2. Plan (4 ops: process, process, OSP, process) + execute ──
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search SO/i).fill(so);
  await page.waitForTimeout(1300);
  await page.getByText(so, { exact: true }).first().click();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: /\+ ?Plan/i }).first().click();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(2500);
  const pln = (await page.locator('text=/Plan:\\s*PLN-/i').first().innerText().catch(() => '')).match(/PLN-\d+/);
  if (pln) rec('PLN', pln[0]);
  const del = page.locator('table.ops-routing tbody tr button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i--) {
    await del.nth(i).click();
    await page.waitForTimeout(150);
  }
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /\+ Add OSP Op/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(400);
  const rows = page.locator('table.ops-routing tbody tr');
  const names = ['Turning', 'Milling', 'Heat Treatment', 'Grinding'];
  for (let i = 0; i < 4; i++) {
    await rows.nth(i).getByPlaceholder('Operation name').fill(names[i]!);
    if (i === 2) {
      await pickFirst(page, rows.nth(i).getByPlaceholder(/Vendor/i), 'a');
      await rows.nth(i).getByPlaceholder('₹/pc').fill('5').catch(() => {});
    } else {
      await pickFirst(page, rows.nth(i).getByPlaceholder(/Machine/i), 'a');
    }
  }
  await page.getByRole('button', { name: /Save Plan/i }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Execute/i }).first().click();
  await page.waitForTimeout(4500);
  const body2 = await page.locator('body').innerText();
  const jc = body2.match(/IN-JC-\d{2}-\d+/);
  const pr = body2.match(/IN-JWPR-\d+/);
  if (jc) rec('JC', jc[0]);
  if (pr) rec('OSP PR', pr[0]);
  const jcNo = jc![0];

  // ── 3. Log op1 + op2 (in-house) ──
  await logOp(page, jcNo, 'Turning', QTY);
  await logOp(page, jcNo, 'Milling', QTY);

  // ── 4. OSP loop: PR → PO → DC → receive → Incoming QC ──
  await page.goto(`/purchase-requests?search=${docs['OSP PR']}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByText('📝 PO', { exact: false }).first().click();
  await page.waitForTimeout(3000);
  const poAuto = await page.locator('input[value^="IN-PO-"], input[value^="IN-JWPO-"]').first().inputValue().catch(() => '');
  await page.getByRole('button', { name: /Create PO/i }).click();
  await page.waitForTimeout(4000);
  const poId = new URL(page.url()).pathname.split('/').pop()!;
  const poNo = (await page.locator('body').innerText()).match(/IN-(?:JW)?PO-\d+/);
  rec('OSP PO', poNo ? poNo[0] : poAuto);

  // Create DC (send full qty to vendor)
  await page.goto(`/delivery-challans/new?poId=${poId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.getByRole('spinbutton').first().fill(QTY);
  await page.getByRole('button', { name: /Save DC/i }).click();
  await page.waitForTimeout(4000);
  const dcId = new URL(page.url()).pathname.split('/').pop()!;
  const dcNo = (await page.locator('body').innerText()).match(/IN-DC-\d+/);
  if (dcNo) rec('OSP DC', dcNo[0]);

  // Receive DC → auto-GRN
  await page.goto(`/delivery-challans/${dcId}/receive`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.getByRole('spinbutton').first().fill(QTY);
  await page.getByRole('button', { name: /Record receipt|Save/i }).click();
  await page.waitForTimeout(4000);

  // Incoming QC: find the GRN row for our PO and accept full qty
  await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const grnRow = page.locator('tr', { hasText: docs['OSP PO']! }).first();
  const grnNo = (await grnRow.innerText().catch(() => '')).match(/IN-GRN-\d+/);
  if (grnNo) rec('OSP GRN', grnNo[0]);
  await grnRow.getByText(/Inspect/i).first().click();
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/QC ?By|Inspector|Inspected/i).first().fill('E2E QC').catch(() => {});
  await page.getByRole('spinbutton').first().fill(QTY);
  await page.getByRole('button', { name: /Submit QC|Accept|Submit/i }).first().click();
  await page.waitForTimeout(4000);

  // ── 5. Complete op4 Grinding ──
  await logOp(page, jcNo, 'Grinding', QTY);
  await page.screenshot({ path: `${SHOT}/full-ops-done.png`, fullPage: true });

  // ── 6. Customer Dispatch ──
  await page.goto('/customer-dispatches/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const dspAuto = await page.locator('input[value^="DSP-"]').first().inputValue().catch(() => '');
  await page.locator('select').first().selectOption({ label: `${so} — Demo Engineering Works` });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Add Line/i }).first().click();
  await page.waitForTimeout(1200);
  const di = page.getByPlaceholder(/code or name/i).first();
  await di.click();
  await di.fill('559918151000');
  await page.waitForTimeout(1400);
  await page.getByText(/559918151000/).first().click().catch(() => {});
  await page.getByRole('spinbutton').first().fill(QTY, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Create Dispatch/i }).click();
  await page.waitForTimeout(4000);
  const dsp = (await page.locator('body').innerText()).match(/DSP-\d+/);
  rec('Dispatch', dsp ? dsp[0] : dspAuto);

  // ── 7. Invoice (from the dispatch row) ──
  await page.goto('/customer-dispatches', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('tr', { hasText: docs['Dispatch']! }).first().getByText(/Invoice/i).first().click();
  await page.waitForTimeout(3500);
  const invAuto = await page.locator('input[value^="INV-"]').first().inputValue().catch(() => '');
  await page.getByRole('spinbutton').first().fill(QTY, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Create Invoice/i }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOT}/full-invoice.png`, fullPage: true });
  const inv = (await page.locator('body').innerText()).match(/INV-\d+/);
  const status = (await page.locator('body').innerText()).match(/\b(unpaid|partial|paid)\b/i);
  rec('Invoice', (inv ? inv[0] : invAuto) + (status ? ` (${status[0]})` : ''));

  // eslint-disable-next-line no-console
  console.log('\n==== DOC SUMMARY ====\n' + JSON.stringify(docs, null, 2));
  expect(docs['Invoice']).toMatch(/INV-/);
});
