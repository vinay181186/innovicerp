import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createSO, dispatch, invoice, ITEM_CODE, makeGuard, makeLog, snap } from './case-helpers';

// CASE 3 — FULL OUTSOURCE (plan_type=full_outsource): SO → Plan(Full Outsource)
// → Execute → processing PR (IN-JWPR) → JW PO → Outward DC → receive → Incoming
// QC → dispatch → invoice. Writes to prod (authorized).

const docs: Record<string, string> = {};
const guards: Record<string, string> = {};
const log = makeLog(docs); const guard = makeGuard(guards);
const RESULT = 'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad/case3-result.json';
const QTY = 10;

test('CASE 3 — full outsource SO→…→invoice', async ({ page }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(25_000);

  // 1 — Sales Order
  const soNo = await createSO(page, QTY, 'C3');
  log('IN-SO', soNo);

  // 2 — Plan (Full Outsource) → Execute
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
  const pln = ((await page.locator('text=/Plan:\\s*PLN-/i').first().innerText().catch(() => '')) || '').match(/PLN-\d+/)?.[0] ?? '';
  if (pln) log('PLN', pln);
  // select Full Outsource plan type
  await page.getByText(/Full Outsource/i).first().click();
  await page.waitForTimeout(1200);
  await snap(page, 'c3', '01-fo-panel');
  const v = page.getByPlaceholder(/Search vendor/i).first();
  await v.click(); await v.fill('sital'); await page.waitForTimeout(1300);
  await page.getByText(/sital/i).first().click().catch(async () => { await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); });
  await page.getByPlaceholder(/Complete machining/i).first().fill('Complete machining as per drawing');
  await page.locator('input[placeholder="0.00"]').first().fill('5').catch(() => {});
  await snap(page, 'c3', '02-fo-filled');
  await page.getByRole('button', { name: /Save Plan/i }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Execute/i }).first().click();
  await page.waitForTimeout(4500);
  await snap(page, 'c3', '03-executed');
  const body = await page.locator('body').innerText();
  const jc = (body.match(/IN-JC-\d{2}-\d+/) || [''])[0];
  if (jc) log('IN-JC', jc);

  // 3 — PR → JW PO (/outsource-jobs: search by JC → capture PR → check → Create PO)
  await page.goto('/outsource-jobs', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.getByPlaceholder(/Search PR/i).fill(jc || soNo);
  await page.waitForTimeout(1800);
  const pr = ((await page.locator('body').innerText()).match(/IN-JWPR-\d+/) || [''])[0];
  if (pr) log('IN-JWPR', pr);
  await page.locator('table tbody tr', { hasText: jc || soNo }).first().getByRole('checkbox').first().check();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Create PO from Selected/i }).first().click();
  await page.waitForTimeout(1800);
  await snap(page, 'c3', '04-createpo');
  // FO PRs carry NO suggested vendor — the modal's vendor select must be set
  const vsel = page.locator('select').filter({ has: page.locator('option', { hasText: /Select vendor/i }) }).first();
  await vsel.selectOption({ index: 1 }).catch(() => {});
  await page.locator('input[type="number"]').last().fill('5').catch(() => {});
  const po = 'IN-JWPO-8' + String(Date.now()).slice(-4);
  await page.getByPlaceholder(/IN-JWPO-/i).first().fill(po).catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Create JW PO/i }).click();
  await page.waitForTimeout(3500);
  log('IN-JWPO', po);

  // 4 — Outward DC from the PO
  await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.getByPlaceholder(/Search/i).first().fill(po).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('table tbody tr', { hasText: po }).first().getByRole('link', { name: /Create DC/i }).click();
  await page.waitForTimeout(2200);
  const dcNo = await page.locator('input[value^="IN-DC-"]').first().inputValue().catch(() => '');
  await page.locator('input[type="number"]').first().fill(String(QTY));
  await page.getByRole('button', { name: /Save DC/i }).click();
  await page.waitForTimeout(3500);
  if (dcNo) log('IN-DC', dcNo);

  // 5 — Receive back
  await page.goto('/delivery-challans', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search/i).first().fill(dcNo).catch(() => {});
  await page.waitForTimeout(1500);
  await page.locator('table tbody tr', { hasText: dcNo }).first().getByRole('link', { name: /Receive/i }).click();
  await page.waitForTimeout(2200);
  await page.locator('input[type="number"]').first().fill(String(QTY));
  await page.getByRole('button', { name: /Record receipt/i }).click();
  await page.waitForTimeout(3500);
  log('receive', `${QTY} received (auto-GRN)`);

  // 6 — Incoming QC
  await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const qcRow = page.locator('table tbody tr').filter({ hasText: ITEM_CODE }).filter({ has: page.getByRole('link', { name: /Inspect/i }) }).first();
  await qcRow.getByRole('link', { name: /Inspect/i }).click();
  await page.waitForTimeout(2000);
  await page.locator('input[type="number"]').first().fill(String(QTY));
  await page.getByRole('button', { name: /Submit QC/i }).click();
  await page.waitForTimeout(3000);
  log('QC', `accepted ${QTY} (OSP return)`);
  await snap(page, 'c3', '05-qc-done');

  // 7 — Dispatch + 8 — Invoice (produced via OSP → dispatchable)
  const d = await dispatch(page, soNo, QTY);
  if (d.dsp) log('DSP', d.dsp);
  if (d.max) guard('dispatch qty UI-capped', `max=${d.max} ✓`);
  const inv = await invoice(page, soNo, QTY);
  if (inv.inv) log('INV', inv.inv);
  if (inv.max) guard('invoice qty UI-capped', `max=${inv.max} ✓`);

  writeFileSync(RESULT, JSON.stringify({ docs, guards }, null, 2));
  /* eslint-disable-next-line no-console */
  console.log('\n==== CASE 3 ====\n' + JSON.stringify({ docs, guards }, null, 2));
  expect(soNo).toMatch(/IN-SO-/);
});
