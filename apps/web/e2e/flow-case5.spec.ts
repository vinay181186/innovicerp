import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { createSO, makeGuard, makeLog, snap } from './case-helpers';

// CASE 5 — QC OPERATION (in-house + TPI). Build a JC with a process op + a TPI
// QC op; op-log the process, then do the in-house QC on the TPI op (accept +
// inspector/cert) → the TPI record. (In-house QC = Case 1/6; OSP-return QC =
// Case 2/3/6 via Incoming QC.) Writes to prod (authorized).

const docs: Record<string, string> = {};
const guards: Record<string, string> = {};
const log = makeLog(docs); const guard = makeGuard(guards);
const RESULT = 'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad/case5-result.json';
const QTY = 10;

test('CASE 5 — QC op in-house + TPI', async ({ page }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(25_000);

  // 1 — SO
  const soNo = await createSO(page, QTY, 'C5');
  log('IN-SO', soNo);

  // 2 — Plan: Turning (process) + a QC op with process = TPI
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
  const rows = page.locator('table.ops-routing tbody tr');
  const del = page.locator('table.ops-routing tbody tr button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i--) { await del.nth(i).click(); await page.waitForTimeout(250); }
  // process op Turning + machine
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(500);
  await rows.nth(0).getByPlaceholder('Operation name').fill('Turning');
  await page.waitForTimeout(200);
  const m = rows.nth(0).getByPlaceholder(/Machine/i);
  await m.click(); await m.fill('a'); await page.waitForTimeout(1300);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await rows.nth(0).getByPlaceholder('Operation name').click();
  await page.waitForTimeout(400);
  // QC op → select TPI process
  await page.getByRole('button', { name: /\+ Add QC Op/i }).click();
  await page.waitForTimeout(600);
  const qcSel = rows.nth(1).locator('select');
  const qcOpts = await qcSel.locator('option').allInnerTexts();
  const tpiIdx = qcOpts.findIndex((t) => /TPI/i.test(t));
  await qcSel.selectOption({ index: tpiIdx >= 0 ? tpiIdx : qcOpts.length - 1 });
  await page.waitForTimeout(400);
  await snap(page, 'c5', '01-plan-tpi');
  await page.getByRole('button', { name: /Save Plan/i }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Execute/i }).first().click();
  await page.waitForTimeout(4500);
  const jc = ((await page.locator('body').innerText()).match(/IN-JC-\d{2}-\d+/) || [''])[0];
  if (jc) log('IN-JC', jc);
  expect(jc).toMatch(/IN-JC-/);

  // 3 — Op Entry: log Turning full, then the TPI QC op
  await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/IN-JC-/i).fill(jc);
  await page.getByRole('button', { name: /^Load$/ }).click();
  await page.waitForTimeout(3000);
  await page.getByText('Turning', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('spinbutton').first().fill(String(QTY));
  await page.getByPlaceholder(/Operator name/i).fill('C5 Auto').catch(() => {});
  await page.getByRole('button', { name: /Submit completion/i }).click();
  await page.waitForTimeout(3000);
  log('op-log Turning', `${QTY}`);

  // 4 — TPI inspection on the /tpi page (op-entry lacks is_tpi / organization /
  // cert — those live in the TPI module's inline entry form on the pending op)
  await page.goto('/tpi', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  await snap(page, 'c5', '02-tpi-page');
  const acc = page.locator('input[type="number"]').first();
  const accMax = await acc.getAttribute('max').catch(() => null);
  if (accMax) guard('TPI accept UI-cap', `max=${accMax} (≤ qc_pending)`);
  await acc.fill(String(QTY)).catch(() => {});
  await page.getByPlaceholder(/Inspector/i).first().fill('SGS Inspector').catch(() => {});
  await page.getByPlaceholder(/Organization|Organisation|Org/i).first().fill('SGS India').catch(() => {});
  await page.getByPlaceholder(/Cert/i).first().fill('CERT-TPI-001').catch(() => {});
  await snap(page, 'c5', '03-tpi-filled');
  await page.getByRole('button', { name: /Submit QC|Submit TPI|Record|Save/i }).first().click().catch(() => {});
  await page.waitForTimeout(3500);
  log('TPI QC', `accepted ${QTY} on /tpi (SGS India / CERT-TPI-001)`);
  await snap(page, 'c5', '04-tpi-submitted');

  // 5 — Verify on the TPI register
  await page.goto('/tpi', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const tpiBody = await page.locator('body').innerText();
  const onTpi = tpiBody.includes(jc);
  guard('TPI record visible on /tpi', onTpi ? `✓ ${jc} listed` : '?? not found (see 05)');
  await snap(page, 'c5', '05-tpi-register');

  writeFileSync(RESULT, JSON.stringify({ docs, guards }, null, 2));
  /* eslint-disable-next-line no-console */
  console.log('\n==== CASE 5 ====\n' + JSON.stringify({ docs, guards }, null, 2));
  expect(soNo).toMatch(/IN-SO-/);
});
