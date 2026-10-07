// ADR-219 CASE 2 — BUILD the chain. TEST STACK ONLY.
//
// Creates a brand-new job-work chain on https://innovic-erp.pages.dev and leaves
// it in exactly the state Case 2 needs:
//
//   SO 10 → plan with ONE outsource op → JC → auto JW PR → JW PO (10)
//   → outward DC for 5 → GRN receives those 5 → Incoming QC: 0 accepted,
//   5 deviated → auto NC → disposed "Return to Vendor" for 5 → STOP.
//
//   fresh still owed = 5   ·   waiting to go back = 5   ·   no return challan.
//
// Every typed value carries ZZ-A219A- so these rows are obviously test rows and
// cannot be confused with the Case 1 agent's chain.
//
// Resumable: what has been built is recorded in
// apps/web/.playwright/adr219a-state.json, so a re-run skips finished steps.
// Delete that file to build a brand-new chain.
//
// Run from apps/web/:
//   npx playwright test --config=playwright.pages.config.ts \
//     e2e/adr219-case2-flow-build.spec.ts --reporter=list

import { expect, test } from '@playwright/test';
import { clickFirstRowMenuItem, planningLineRows, executePlanFromMenu } from './row-menu';
import {
  assertTestStack,
  ITEM_CODE,
  log,
  ORDER_QTY,
  pickFirst,
  pickFromCombo,
  readState,
  saveState,
  SEND_QTY,
  shot,
  TAG,
  today,
  VENDOR_CODE,
  type ChainState,
} from './adr219-case2-chain';

const STAMP = String(Date.now()).slice(-9);
const OP_NAME = `${TAG}HEAT TREATMENT`;

test.describe.configure({ mode: 'serial' });

test('A0 - guard: this is the TEST stack', async ({ page }) => {
  test.setTimeout(180_000);
  const api = await assertTestStack(page);
  log(`api base: ${api}`);
  saveState({ apiBase: api });
});

test('A1 - Sales Order for 10', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  if (s.soCode) {
    log(`A1 skipped — SO already built: ${s.soCode}`);
    return;
  }

  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  const client = page.getByPlaceholder(/Type customer code or name/i).first();
  await client.waitFor({ state: 'visible', timeout: 60_000 });
  await pickFirst(page, client, 'Adani');

  const clientPo = `${TAG}CPO-${STAMP}`;
  await page.locator('#clientPoNo').fill(clientPo);
  const internalSoNo = `SO-ZZ-A219A-${STAMP}`;
  await page.locator('#internalSoNo').fill(internalSoNo);

  // One line: our item, qty 10, Rev A, a rate so the order has a value.
  await page.getByRole('button', { name: /Add Line/i }).first().click();
  await page.waitForTimeout(800);
  await pickFirst(page, page.locator('#soln-ic-0'), ITEM_CODE);
  await page.getByLabel('Drawing Rev, line 1', { exact: true }).fill('A');
  await page.getByPlaceholder('Qty', { exact: true }).first().fill(String(ORDER_QTY));
  await page
    .getByPlaceholder('₹ Rate', { exact: true })
    .first()
    .fill('10')
    .catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 'a1-so-form');

  await page.getByRole('button', { name: /^Save SO$/ }).click();
  await page.waitForURL((u) => !/\/sales-orders\/new/.test(u.pathname), { timeout: 120_000 });
  await page.waitForTimeout(3000);
  await shot(page, 'a1-so-saved');

  const body = await page.locator('body').innerText();
  const code = /IN-SO-\d+/.exec(body)?.[0];
  expect(code, `no IN-SO-… on ${page.url()} — body: ${body.slice(0, 400)}`).toBeTruthy();
  log(`SO ${code} (Internal ${internalSoNo}, Client PO ${clientPo})`);
  saveState({ soCode: code!, soUrl: page.url(), internalSoNo });
});

test('A2 - plan one OUTSOURCE op and execute → Job Card + auto JW PR', async ({ page }) => {
  test.setTimeout(900_000);
  const s = readState();
  if (s.jcCode) {
    log(`A2 skipped — JC already built: ${s.jcCode}`);
    return;
  }
  expect(s.soCode, 'A1 must have run').toBeTruthy();
  const soCode = s.soCode!;

  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder(/Search SO/i).first().waitFor({ timeout: 60_000 });
  await page.getByPlaceholder(/Search SO/i).first().fill(soCode);
  await page.getByText(soCode, { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText(soCode, { exact: true }).first().click();
  await page.waitForTimeout(2500);

  // ⋯ → "Plan N" opens the create-plan modal (so-planning/create-plan-modal).
  await clickFirstRowMenuItem(page, planningLineRows(page), /^Plan \d/);
  const planQty = page.locator('#create-plan-qty');
  await planQty.waitFor({ state: 'visible', timeout: 60_000 });
  await planQty.fill(String(ORDER_QTY));
  const planRemark = page.locator('#create-plan-remark');
  if (await planRemark.count()) await planRemark.fill(`${TAG}ADR-219 Case 2 chain`);
  await shot(page, 'a2-create-plan');
  await page.getByRole('button', { name: /^Save Plan$/ }).click();
  await page.waitForTimeout(4000);
  await shot(page, 'a2-plan-saved');

  // The edit-plan modal opens on the suggested route. Clear it and leave ONE
  // outsource op on VND-959, so the job card has an OSP operation to send.
  const opsTable = page.locator('table.ops-routing').first();
  await opsTable.waitFor({ state: 'visible', timeout: 60_000 });
  const del = opsTable.locator('tbody tr button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i -= 1) {
    await del.nth(i).click();
    await page.waitForTimeout(250);
  }
  await page.getByRole('button', { name: /\+ Add Outsource Op$/ }).click();
  await page.waitForTimeout(600);
  const row0 = opsTable.locator('tbody tr').nth(0);
  await row0.getByPlaceholder('Operation name').fill(OP_NAME);
  await pickFirst(page, row0.getByPlaceholder('🔍 Vendor', { exact: true }), VENDOR_CODE);
  await shot(page, 'a2-route');

  await page.getByRole('button', { name: /Save Plan/i }).click();
  await page
    .getByRole('button', { name: /Save Plan/i })
    .waitFor({ state: 'hidden', timeout: 120_000 });
  await page.waitForTimeout(2500);

  await executePlanFromMenu(page, 120_000);
  await page.getByText(/IN-JC-\d{2}-\d+/).first().waitFor({ timeout: 180_000 });
  await page.waitForTimeout(2000);
  await shot(page, 'a2-executed');

  const jc = /IN-JC-\d{2}-\d+/.exec(await page.locator('body').innerText())?.[0];
  expect(jc, 'JC code on the page after Execute').toBeTruthy();
  log(`JC ${jc} (outsource op "${OP_NAME}")`);
  saveState({ jcCode: jc!, opName: OP_NAME });
});

test('A3 - find the auto job-work PR', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  if (s.prCode) {
    log(`A3 skipped — PR already found: ${s.prCode}`);
    return;
  }
  expect(s.jcCode, 'A2 must have run').toBeTruthy();

  await page.goto('/purchase-requests', { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder(/search/i).first();
  await search.waitFor({ timeout: 60_000 });
  await search.fill(OP_NAME);
  await page.waitForTimeout(5000);
  await shot(page, 'a3-pr-list');
  const body = await page.locator('body').innerText();
  const pr = /IN-[A-Z]*PR-\d+/.exec(body)?.[0];
  expect(
    pr,
    `no PR found for operation "${OP_NAME}" — the outsource op should have raised one. Page: ${body.slice(0, 500)}`,
  ).toBeTruthy();
  log(`JW PR ${pr}`);
  saveState({ prCode: pr! });
});

test('A4 - job-work PO for 10 from that PR, then approve it', async ({ page }) => {
  test.setTimeout(900_000);
  const s = readState();
  if (s.poCode && s.poId) {
    log(`A4 skipped — PO already built: ${s.poCode}`);
    return;
  }
  const prCode = s.prCode!;
  expect(prCode, 'A3 must have run').toBeTruthy();

  await page.goto('/purchase-orders/from-pr', { waitUntil: 'domcontentloaded' });
  await page.locator('#pof-code').waitFor({ timeout: 90_000 });
  await expect(page.locator('#pof-code')).not.toHaveValue('', { timeout: 90_000 });
  await pickFromCombo(page, 'pof-pr-0', prCode, new RegExp(prCode));
  // Picking the PR fills the line and should set the type + vendor; force both.
  await expect(page.getByLabel('Item Code, line 1', { exact: true })).not.toHaveValue('', {
    timeout: 90_000,
  });
  await page.waitForTimeout(1500);
  const poType = await page.locator('#pof-type').inputValue();
  log(`from-PR form: poType=${poType}`);
  if (poType !== 'job_work') await page.locator('#pof-type').selectOption('job_work');
  const vendorBox = await page.locator('#pof-vendor').inputValue();
  log(`from-PR form: vendor box = "${vendorBox}"`);
  if (!vendorBox.includes(VENDOR_CODE)) {
    await pickFromCombo(page, 'pof-vendor', VENDOR_CODE, new RegExp(VENDOR_CODE));
  }
  await page.locator('#pof-delivery-days').fill('14');
  const qtyBox = page.getByLabel('Qty, line 1', { exact: true });
  log(`from-PR form: line qty = "${await qtyBox.inputValue()}"`);
  await qtyBox.fill(String(ORDER_QTY));
  const rate = page.getByLabel('Rate, line 1', { exact: true });
  if (!(await rate.inputValue()) || Number(await rate.inputValue()) === 0) await rate.fill('50');
  await page.locator('#pof-remarks').fill(`${TAG}ADR-219 Case 2 — job-work order, 10 ordered`);
  await shot(page, 'a4-po-form');

  const save = page.locator('button.pof-btn-go');
  const foot = await page
    .locator('.pof-foot-msg, .pof-foot-hint')
    .first()
    .innerText()
    .catch(() => '');
  await expect(save, `footer says: ${foot}`).toBeEnabled({ timeout: 60_000 });
  await save.click();
  await expect(page).toHaveURL(/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 180_000 });
  const poId = /purchase-orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const poCode = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(await page.locator('body').innerText())?.[0];
  expect(poCode, 'PO code on the detail page').toBeTruthy();
  await shot(page, 'a4-po-saved');

  // Approve so material may leave against it.
  const badge = page.locator('.panel-hdr .badge').first();
  await expect(badge).toBeVisible({ timeout: 60_000 });
  if ((await badge.innerText()).trim().toLowerCase() === 'draft') {
    await page.getByRole('button', { name: /^Approve$/ }).click();
    await page.getByRole('button', { name: 'Approve PO' }).click();
    await expect(page.locator('.panel-hdr .badge').first()).toHaveText(/open/i, {
      timeout: 120_000,
    });
  }
  const status = (await page.locator('.panel-hdr .badge').first().innerText()).trim();
  log(`JW PO ${poCode} — status ${status}`);
  await shot(page, 'a4-po-approved');
  saveState({ poId, poCode: poCode! });
});

test('A5 - outward Delivery Challan for 5 of the 10', async ({ page }) => {
  test.setTimeout(900_000);
  const s = readState();
  if (s.dcCode) {
    log(`A5 skipped — DC already built: ${s.dcCode}`);
    return;
  }
  const poId = s.poId!;
  expect(poId, 'A4 must have run').toBeTruthy();

  await page.goto(`/delivery-challans/new?poId=${poId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-code').waitFor({ timeout: 90_000 });
  await expect(page.locator('#dc-code')).not.toHaveValue('', { timeout: 90_000 });
  await page.locator('#dc-transport').fill(`${TAG}Shree Ganesh Roadlines`);
  await page.locator('#dc-vehicle-no').fill('GJ-23-ZZ-0001');

  const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
  await expect(qtyBoxes).toHaveCount(1, { timeout: 90_000 });
  // The allowance BEFORE anything has gone out — expected 10, the full order.
  const capBefore = (await page.locator('text=/Can send now:/').first().innerText()).trim();
  log(`before any send, the form says: "${capBefore}"`);
  await qtyBoxes.first().fill(String(SEND_QTY));
  const material = page.locator('table.innovic-table input.innovic-input:not([type])').first();
  if (await material.count()) await material.fill(`${TAG}EN24`);
  await shot(page, 'a5-dc-form');

  const save = page.getByRole('button', { name: /Save DC/ });
  await expect(save).toBeEnabled({ timeout: 90_000 });
  await save.click();
  await expect(page).toHaveURL(/delivery-challans\/[0-9a-f-]{36}$/, { timeout: 180_000 });
  const dcId = /delivery-challans\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const dcCode = /IN-DC-\d+(?:\/R\d+)?/.exec(await page.locator('body').innerText())?.[0];
  expect(dcCode, 'DC code on the detail page').toBeTruthy();
  log(`outward DC ${dcCode} — ${SEND_QTY} pcs sent`);
  await shot(page, 'a5-dc-saved');
  saveState({ dcId, dcCode: dcCode! });
});

test('A6 - GRN receives the 5 back', async ({ page }) => {
  test.setTimeout(900_000);
  const s = readState();
  if (s.grnCode) {
    log(`A6 skipped — GRN already built: ${s.grnCode}`);
    return;
  }
  const { poCode, dcCode } = s as Required<Pick<ChainState, 'poCode' | 'dcCode'>>;
  expect(dcCode, 'A5 must have run').toBeTruthy();

  await page.goto('/goods-receipt-notes/new', { waitUntil: 'domcontentloaded' });
  const typeSel = page.locator('#grnInwardType');
  await expect(typeSel).toBeVisible({ timeout: 90_000 });
  await typeSel.selectOption('job_work_return');
  await expect(page.locator('#jwpoId')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await pickFromCombo(page, 'jwpoId', poCode, new RegExp(poCode.replace('/', '\\/')));
  await pickFromCombo(page, 'dcId', dcCode, new RegExp(dcCode.replace('/', '\\/')));

  const line1 = page.getByLabel('Received, line 1', { exact: true });
  await line1.waitFor({ state: 'visible', timeout: 90_000 });
  log(`GRN prefilled Received line 1 = "${await line1.inputValue()}"`);
  await line1.fill(String(SEND_QTY));
  const rem = page.locator('#dcRemarks');
  if (await rem.count()) await rem.fill(`${TAG}ADR-219 Case 2 — all 5 back from vendor`);
  await shot(page, 'a6-grn-form');

  await page.getByRole('button', { name: /Save GRN/ }).click();
  await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 180_000 });
  const grnId = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const grnCode = /IN-GRN-\d+/.exec(await page.locator('body').innerText())?.[0];
  expect(grnCode, 'GRN code on the detail page').toBeTruthy();
  log(`GRN ${grnCode} — ${SEND_QTY} received`);
  await shot(page, 'a6-grn-saved');
  saveState({ grnId, grnCode: grnCode! });
});

test('A7 - Incoming QC: 0 accepted, all 5 deviated → NC raised', async ({ page }) => {
  test.setTimeout(900_000);
  const s = readState();
  if (s.ncCode) {
    log(`A7 skipped — NC already raised: ${s.ncCode}`);
    return;
  }
  const grnCode = s.grnCode!;
  expect(grnCode, 'A6 must have run').toBeTruthy();

  await page.goto(`/incoming-qc?search=${encodeURIComponent(grnCode)}`, {
    waitUntil: 'domcontentloaded',
  });
  const row = page.locator('tbody tr').filter({ hasText: grnCode }).first();
  await row.waitFor({ state: 'visible', timeout: 120_000 });
  log(`Incoming QC pending row: ${(await row.innerText()).replace(/\s+/g, ' ').trim()}`);
  await shot(page, 'a7-iqc-list');

  await row.getByRole('button', { name: 'Actions' }).first().click();
  await page.getByRole('menuitem', { name: /^Inspect/ }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);

  // QC By ("Inspected By") opens prefilled with the signed-in user; take the
  // first QC person offered only when it is blank.
  const qcBy = dialog.getByPlaceholder(/Select QC person/).first();
  if ((await qcBy.inputValue()).trim() === '') {
    await pickFirst(page, qcBy, '');
  }
  const accBox = dialog
    .locator('.form-grp')
    .filter({ hasText: /^Accepted/ })
    .locator('input')
    .first();
  const rejBox = dialog
    .locator('.form-grp')
    .filter({ hasText: /^Deviated/ })
    .locator('input')
    .first();
  await accBox.fill('0');
  await rejBox.fill(String(SEND_QTY));
  await dialog.getByPlaceholder(/Observations/).fill(`${TAG}all 5 fail — return to vendor`);
  await shot(page, 'a7-iqc-form');
  await dialog.getByRole('button', { name: /Submit Inspection/i }).click();

  const alert = dialog.getByRole('alert');
  await page.waitForTimeout(3000);
  if (await alert.count()) {
    const t = (await alert.first().innerText().catch(() => '')).trim();
    if (t) throw new Error('Incoming QC refused: ' + t);
  }
  await dialog.waitFor({ state: 'hidden', timeout: 180_000 });
  await page.waitForTimeout(2500);
  await shot(page, 'a7-iqc-done');

  // The NC the reject raised — found on the NC Register by our job card.
  const jcCode = s.jcCode!;
  await page.goto(`/nc-register?search=${encodeURIComponent(jcCode)}`, {
    waitUntil: 'domcontentloaded',
  });
  const ncPattern = /NC-[A-Z0-9-]*\d/;
  const ncCell = page.getByText(ncPattern).first();
  await ncCell.waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  const ncBody = await page.locator('body').innerText();
  const ncCode = /NC-AUTO-[A-Za-z0-9-]+|NC-\d+/.exec(ncBody)?.[0];
  expect(ncCode, `no NC listed for ${jcCode} — body: ${ncBody.slice(0, 600)}`).toBeTruthy();
  await shot(page, 'a7-nc-list');

  await page.getByText(ncCode!, { exact: false }).first().click();
  await expect(page).toHaveURL(/nc-register\/[0-9a-f-]{36}/, { timeout: 120_000 });
  const ncId = /nc-register\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  log(`NC ${ncCode} raised for ${SEND_QTY} pcs`);
  saveState({ ncCode: ncCode!, ncId, ncUrl: page.url() });
});

test('A8 - dispose the deviation as Return to Vendor for 5 (NO return challan)', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const s = readState();
  if (s.disposed) {
    log('A8 skipped — already disposed');
    return;
  }
  const ncUrl = s.ncUrl!;
  expect(ncUrl, 'A7 must have run').toBeTruthy();

  await page.goto(ncUrl, { waitUntil: 'domcontentloaded' });
  const dispose = page.getByRole('button', { name: /Dispose/ }).first();
  await dispose.waitFor({ timeout: 120_000 });
  await dispose.click();
  await page.locator('#dispAction').waitFor({ state: 'visible', timeout: 60_000 });
  const offered = (await page.locator('#dispAction option').evaluateAll((els) =>
    els.map((e) => (e as HTMLOptionElement).value),
  )).filter(Boolean);
  log(`dispose actions offered: ${offered.join(', ')}`);
  expect(offered, 'Return to Vendor must be offered on a vendor-sourced NC').toContain(
    'return_to_vendor',
  );
  await page.locator('#dispAction').selectOption('return_to_vendor');
  await page.locator('#dispQty').fill(String(SEND_QTY));
  await page.locator('#dispRemarks').fill(`${TAG}ADR-219 Case 2 — send all 5 back`);
  await shot(page, 'a8-dispose-form');
  await page.getByRole('button', { name: /^Save Disposition$/ }).click();

  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(3000);
    if (!(await page.locator('#dispAction').count())) break;
  }
  await page.waitForTimeout(2000);
  await page.goto(ncUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .badge').first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(2000);
  await shot(page, 'a8-nc-disposed');
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  expect(body, 'the deviation must read as Return to Vendor').toMatch(/Return to Vendor/i);
  log(`NC ${s.ncCode} disposed Return to Vendor for ${SEND_QTY} pcs on ${today()}`);
  saveState({ disposed: true });
});

test('A9 - chain summary', async () => {
  const s = readState();
  log('──── ADR-219 Case 2 chain ────');
  for (const k of [
    'soCode',
    'internalSoNo',
    'jcCode',
    'prCode',
    'poCode',
    'dcCode',
    'grnCode',
    'ncCode',
  ] as const) {
    log(`${k}: ${s[k] ?? '(missing)'}`);
  }
  expect(s.disposed, 'the whole chain must be built').toBe(true);
});
