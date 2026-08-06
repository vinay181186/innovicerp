import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createSO, ITEM_CODE, makeGuard, makeLog, planExecuteInhouse, snap } from './case-helpers';

// CASE 2 — ALL OSP VIA JC (dual-lane): make a JC, outsource its op balance →
// PR (IN-JWPR) → JW PO (IN-JWPO) → Outward DC (IN-DC) → receive → Incoming QC.
// Writes to prod (authorized).

const docs: Record<string, string> = {};
const guards: Record<string, string> = {};
const log = makeLog(docs); const guard = makeGuard(guards);
const RESULT = 'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad/case2-result.json';
const QTY = 10;

test('CASE 2 — OSP via JC dual-lane', async ({ page }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(25_000);

  // 0 — a JC with a process op to outsource
  const soNo = await createSO(page, QTY, 'C2');
  log('IN-SO', soNo);
  const { jc } = await planExecuteInhouse(page, soNo, ['Turning']);
  log('IN-JC', jc);
  expect(jc).toMatch(/IN-JC-/);

  // 1 — Outsource balance on the Turning op → PR IN-JWPR
  await page.goto('/jc-ops', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const jsel = page.locator('select').first();
  { const opts = await jsel.locator('option').allInnerTexts(); const idx = opts.findIndex((t) => t.includes(jc)); if (idx >= 0) await jsel.selectOption({ index: idx }); }
  await page.waitForTimeout(1800);
  await snap(page, 'c2', '01-jcops');
  await page.getByRole('button', { name: /🏭 Outsource balance/ }).first().click();
  await page.waitForTimeout(1200);
  const bqty = page.locator('input[type="number"]').first();
  const bmax = await bqty.getAttribute('max').catch(() => null);
  const bval = await bqty.inputValue().catch(() => '');
  guard('outsource-balance qty default/cap', `default=${bval} max=${bmax ?? 'n/a'} (≤ available ${QTY})`);
  const vcode = await page.locator('#outsource-balance-vendors option').first().getAttribute('value').catch(() => '');
  await page.getByPlaceholder('Vendor code').fill(vcode || '');
  await snap(page, 'c2', '02-balance-modal');
  await page.getByRole('button', { name: 'Outsource balance', exact: true }).click();
  await page.waitForTimeout(3500);
  await snap(page, 'c2', '03-pr-raised');

  // 2 — PR → JW PO (/outsource-jobs: search by JC → capture PR → check → Create PO from Selected → Create JW PO)
  await page.goto('/outsource-jobs', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.getByPlaceholder(/Search PR/i).fill(jc);
  await page.waitForTimeout(1800);
  const pr = ((await page.locator('body').innerText()).match(/IN-JWPR-\d+/) || [''])[0];
  if (pr) log('IN-JWPR', pr);
  const prRow = page.locator('table tbody tr', { hasText: jc }).first();
  await prRow.getByRole('checkbox').first().check();
  await page.waitForTimeout(800);
  await snap(page, 'c2', '04-pr-selected');
  await page.getByRole('button', { name: /Create PO from Selected/i }).first().click();
  await page.waitForTimeout(1800);
  await snap(page, 'c2', '05-createpo-form');
  await page.locator('input[type="number"]').last().fill('5').catch(() => {}); // rate on the PO line
  // PO NO. is a REQUIRED typed field with a static placeholder — use a unique
  // code so re-runs don't collide on IN-JWPO-00001.
  const po = 'IN-JWPO-9' + String(Date.now()).slice(-4);
  await page.getByPlaceholder(/IN-JWPO-/i).first().fill(po).catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Create JW PO/i }).click();
  await page.waitForTimeout(3500);
  log('IN-JWPO', po);
  await snap(page, 'c2', '06-po-created');

  // 3 — Outward DC: from the PO's "📦 Create DC" action → ship qty → Save DC
  await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await page.getByPlaceholder(/Search/i).first().fill(po).catch(() => {});
  await page.waitForTimeout(1500);
  const poRow = page.locator('table tbody tr', { hasText: po }).first();
  await poRow.getByRole('link', { name: /Create DC/i }).click();
  await page.waitForTimeout(2200);
  await snap(page, 'c2', '07-dc-form');
  const dcNo = await page.locator('input[value^="IN-DC-"]').first().inputValue().catch(() => '');
  await page.locator('input[type="number"]').first().fill(String(QTY)); // ship qty
  await page.getByRole('button', { name: /Save DC/i }).click();
  await page.waitForTimeout(3500);
  if (dcNo) log('IN-DC', dcNo);
  await snap(page, 'c2', '08-dc-created');

  // 4 — Receive back (DC row "+ Receive" → received qty → Record receipt → auto-GRN)
  await page.goto('/delivery-challans', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search/i).first().fill(dcNo).catch(() => {});
  await page.waitForTimeout(1500);
  const dcRow = page.locator('table tbody tr', { hasText: dcNo }).first();
  await dcRow.getByRole('link', { name: /Receive/i }).click();
  await page.waitForTimeout(2200);
  await snap(page, 'c2', '09-receive-form');
  await page.locator('input[type="number"]').first().fill(String(QTY)); // received qty
  await page.getByRole('button', { name: /Record receipt/i }).click();
  await page.waitForTimeout(3500);
  log('receive', `${QTY} received (auto-GRN, QC pending)`);
  await snap(page, 'c2', '10-received');

  // 5 — Incoming QC: inspect the newest pending row for our item → accept
  await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const qcRow = page.locator('table tbody tr').filter({ hasText: ITEM_CODE }).filter({ has: page.getByRole('link', { name: /Inspect/i }) }).first();
  await qcRow.getByRole('link', { name: /Inspect/i }).click();
  await page.waitForTimeout(2000);
  await snap(page, 'c2', '11-qc-form');
  await page.locator('input[type="number"]').first().fill(String(QTY)); // accepted
  await page.getByRole('button', { name: /Submit QC/i }).click();
  await page.waitForTimeout(3000);
  log('QC', `accepted ${QTY} → recombine (dual-lane)`);
  await snap(page, 'c2', '12-qc-done');

  writeFileSync(RESULT, JSON.stringify({ docs, guards }, null, 2));
  /* eslint-disable-next-line no-console */
  console.log('\n==== CASE 2 (through DC) ====\n' + JSON.stringify({ docs, guards }, null, 2));
  expect(soNo).toMatch(/IN-SO-/);
});
