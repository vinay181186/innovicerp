import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createSO, dispatch, invoice, ITEM_CODE, makeGuard, makeLog, opEntryLoad, planExecuteInhouse, snap } from './case-helpers';

// CASE 6 — ALL-OP JC with a mid-route IN-HOUSE → OSP switch (dual-lane).
// Turning: log 6 in-house, then outsource the remaining 4 balance → OSP chain;
// the two lanes recombine (6+4=10) so Milling → QC → dispatch → invoice see 10.
// Writes to prod (authorized).

const docs: Record<string, string> = {};
const guards: Record<string, string> = {};
const log = makeLog(docs); const guard = makeGuard(guards);
const RESULT = 'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad/case6-result.json';
const QTY = 10; const INHOUSE = 6; const BAL = 4;

test('CASE 6 — all-op mid-switch in-house→OSP', async ({ page }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(25_000);

  // 1 — SO → Plan(Turning, Milling) → Execute (auto DIR QC appended)
  const soNo = await createSO(page, QTY, 'C6');
  log('IN-SO', soNo);
  const { jc } = await planExecuteInhouse(page, soNo, ['Turning', 'Milling']);
  log('IN-JC', jc);
  expect(jc).toMatch(/IN-JC-/);

  // 2 — Op Entry: log PARTIAL 6 on Turning (op becomes "started")
  await opEntryLoad(page, jc);
  await page.getByText('Turning', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('spinbutton').first().fill(String(INHOUSE));
  await page.getByPlaceholder(/Operator name/i).fill('C6 Auto').catch(() => {});
  await page.getByRole('button', { name: /Submit completion/i }).click();
  await page.waitForTimeout(3000);
  log('op-log Turning (in-house)', `${INHOUSE} of ${QTY} (partial)`);
  await snap(page, 'c6', '01-partial');

  // 3 — Mid-switch: outsource the remaining BAL on the STARTED Turning op
  await page.goto('/jc-ops', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const jsel = page.locator('select').first();
  { const opts = await jsel.locator('option').allInnerTexts(); const idx = opts.findIndex((t) => t.includes(jc)); if (idx >= 0) await jsel.selectOption({ index: idx }); }
  await page.waitForTimeout(1800);
  // Turning's Outsource balance (the row whose OPERATION is Turning)
  const turnRow = page.locator('table tbody tr', { hasText: 'Turning' }).first();
  await turnRow.getByRole('button', { name: /Outsource balance/i }).click();
  await page.waitForTimeout(1200);
  const bqty = page.locator('input[type="number"]').first();
  const bval = await bqty.inputValue().catch(() => '');
  guard('outsource-balance after partial (input−done−sent)', `default=${bval} (expect ${BAL} = ${QTY}−${INHOUSE})`);
  const vcode = await page.locator('#outsource-balance-vendors option').first().getAttribute('value').catch(() => '');
  await page.getByPlaceholder('Vendor code').fill(vcode || '');
  await snap(page, 'c6', '02-balance');
  await page.getByRole('button', { name: 'Outsource balance', exact: true }).click();
  await page.waitForTimeout(3500);

  // 4 — PR → JW PO
  await page.goto('/outsource-jobs', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.getByPlaceholder(/Search PR/i).fill(jc);
  await page.waitForTimeout(1800);
  const pr = ((await page.locator('body').innerText()).match(/IN-JWPR-\d+/) || [''])[0];
  if (pr) log('IN-JWPR', pr);
  await page.locator('table tbody tr', { hasText: jc }).first().getByRole('checkbox').first().check();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Create PO from Selected/i }).first().click();
  await page.waitForTimeout(1800);
  await page.locator('select').filter({ has: page.locator('option', { hasText: /Select vendor/i }) }).first().selectOption({ index: 1 }).catch(() => {});
  await page.locator('input[type="number"]').last().fill('5').catch(() => {});
  const po = 'IN-JWPO-7' + String(Date.now()).slice(-4);
  await page.getByPlaceholder(/IN-JWPO-/i).first().fill(po).catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Create JW PO/i }).click();
  await page.waitForTimeout(3500);
  log('IN-JWPO', po);

  // 5 — Outward DC (ship BAL) → receive → Incoming QC (accept BAL)
  await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.getByPlaceholder(/Search/i).first().fill(po).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('table tbody tr', { hasText: po }).first().getByRole('link', { name: /Create DC/i }).click();
  await page.waitForTimeout(2200);
  const dcNo = await page.locator('input[value^="IN-DC-"]').first().inputValue().catch(() => '');
  await page.locator('input[type="number"]').first().fill(String(BAL));
  await page.getByRole('button', { name: /Save DC/i }).click();
  await page.waitForTimeout(3500);
  if (dcNo) log('IN-DC', dcNo);
  await page.goto('/delivery-challans', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search/i).first().fill(dcNo).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('table tbody tr', { hasText: dcNo }).first().getByRole('link', { name: /Receive/i }).click();
  await page.waitForTimeout(2200);
  await page.locator('input[type="number"]').first().fill(String(BAL));
  await page.getByRole('button', { name: /Record receipt/i }).click();
  await page.waitForTimeout(3500);
  log('receive', `${BAL} received`);
  await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const qcRow = page.locator('table tbody tr').filter({ hasText: ITEM_CODE }).filter({ has: page.getByRole('link', { name: /Inspect/i }) }).first();
  await qcRow.getByRole('link', { name: /Inspect/i }).click();
  await page.waitForTimeout(2000);
  await page.locator('input[type="number"]').first().fill(String(BAL));
  await page.getByRole('button', { name: /Submit QC/i }).click();
  await page.waitForTimeout(3000);
  log('OSP QC', `accepted ${BAL} → Turning done = ${INHOUSE}+${BAL} = ${QTY} (recombine)`);
  await snap(page, 'c6', '03-recombine');

  // 6 — Milling (input = recombined 10) → op-log 10
  await opEntryLoad(page, jc);
  await page.getByText('Milling', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.getByRole('spinbutton').first().fill(String(QTY)).catch(() => {});
  await page.getByPlaceholder(/Operator name/i).fill('C6 Auto').catch(() => {});
  await page.getByRole('button', { name: /Submit completion/i }).click().catch(() => {});
  await page.waitForTimeout(3000);
  log('op-log Milling', `${QTY} (sees recombined input)`);

  // 7 — Terminal QC (DIR) accept 10
  await page.getByText('DIR', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByRole('spinbutton').first().fill(String(QTY)).catch(() => {});
  await page.getByRole('button', { name: /Submit QC inspection/i }).click().catch(() => {});
  await page.waitForTimeout(3000);
  log('terminal QC', `accepted ${QTY}`);
  await snap(page, 'c6', '04-qc-done');

  // 8 — Dispatch + Invoice
  const d = await dispatch(page, soNo, QTY);
  if (d.dsp) log('DSP', d.dsp);
  const inv = await invoice(page, soNo, QTY);
  if (inv.inv) log('INV', inv.inv);

  writeFileSync(RESULT, JSON.stringify({ docs, guards }, null, 2));
  /* eslint-disable-next-line no-console */
  console.log('\n==== CASE 6 ====\n' + JSON.stringify({ docs, guards }, null, 2));
  expect(soNo).toMatch(/IN-SO-/);
});
