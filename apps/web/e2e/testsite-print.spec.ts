// TEST STACK ONLY (https://innovic-erp.pages.dev -> api-test-....railway.app).
//
// Builds a 45-line Purchase Order and an OSP Delivery Challan raised against it,
// then captures each document's PRINT window as a real paginated PDF so the
// approved PO format can be checked on paper.
//
// Every free-text value carries the E2E_ marker. Run with:
//   TESTSITE_EMAIL=... TESTSITE_PASSWORD=... \
//   npx playwright test --config=e2e/testsite.config.ts e2e/testsite-print.spec.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { PO_LINES, VENDOR } from './testsite-print-data';

test.describe.configure({ mode: 'serial' });

const STATE_FILE =
  'C:/Innovic_projects/innovic-erp/innovicerp/apps/web/.playwright/testsite-print-state.json';
const PO_PDF = 'C:/Innovic_projects/innovic-erp/TEST-Purchase-Order.pdf';
const DC_PDF = 'C:/Innovic_projects/innovic-erp/TEST-OSP-Delivery-Challan.pdf';

interface State {
  vendorName?: string;
  vendorCode?: string;
  prCode?: string;
  poId?: string;
  poCode?: string;
  dcId?: string;
  dcCode?: string;
}

function readState(): State {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
}
function writeState(patch: State): State {
  const next = { ...readState(), ...patch };
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

/** Guard: this spec writes data, so refuse to run anywhere but the test API. */
async function assertTestStack(page: Page): Promise<void> {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).hostname));
  await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const api = [...hosts].find((h) => h.includes('railway.app'));
  expect(api, 'no API host seen').toBeTruthy();
  expect(api, 'refusing to write: API host is ' + api).toContain('api-test-');
}

/** Pick a row out of a <SearchableSelect> combobox. */
async function pickFromCombo(page: Page, id: string, search: string, want: RegExp): Promise<void> {
  const box = page.locator('#' + id);
  await box.click();
  await box.fill(search);
  const option = page.getByRole('option').filter({ hasText: want }).first();
  await option.waitFor({ state: 'visible', timeout: 30_000 });
  await option.click();
}

/** Open the document's Print window and save it as a paginated PDF. */
async function printToPdf(page: Page, path: string): Promise<void> {
  const [popup] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Print', exact: true }).click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  // The PO renders through buildDocHtml (.title-bar); the challan renders through
  // challan-print (.doc-title). Wait for whichever this document uses.
  await popup.locator('.title-bar, .doc-title').first().waitFor({
    state: 'attached',
    timeout: 30_000,
  });
  // Let the inline logo decode and the fonts settle before paginating.
  await popup.waitForTimeout(3000);
  await popup.pdf({ path, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await popup.close();
}

test('0 - this is the test stack', async ({ page }) => {
  await assertTestStack(page);
});

test('1 - create the E2E vendor', async ({ page }) => {
  const s = readState();
  if (s.vendorCode) {
    test.skip(true, 'vendor ' + s.vendorCode + ' already created');
    return;
  }
  await page.goto('/vendors/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#name').waitFor({ timeout: 60_000 });
  await page.locator('#name').fill(VENDOR.name);
  await page.locator('#contactPerson').fill(VENDOR.contactPerson);
  await page.locator('#phone').fill(VENDOR.phone);
  await page.locator('#email').fill(VENDOR.email);
  await page.locator('#gstNumber').fill(VENDOR.gstNumber);
  await page.locator('#addressLine1').fill(VENDOR.addressLine1);
  await page.locator('#city').fill(VENDOR.city);
  await page.locator('#state').fill(VENDOR.state);
  await page.locator('#pincode').fill(VENDOR.pincode);
  await page
    .getByRole('button', { name: /Save|Create/ })
    .first()
    .click();
  await expect(page).not.toHaveURL(/vendors\/new/, { timeout: 60_000 });

  // Find the code the server allocated.
  await page.goto('/vendors', { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder(/search/i).first();
  await search.waitFor({ timeout: 60_000 });
  await search.fill('E2E_ Shreeji');
  await page.waitForTimeout(4000);
  const row = page.locator('tr', { hasText: VENDOR.name }).first();
  await row.waitFor({ timeout: 30_000 });
  const code = (await row.locator('td').first().innerText()).trim();
  expect(code).toMatch(/VND-/);
  writeState({ vendorCode: code, vendorName: VENDOR.name });
  console.log('VENDOR CREATED: ' + code + ' - ' + VENDOR.name);
});

test('2 - create the E2E purchase request', async ({ page }) => {
  const s = readState();
  if (s.prCode) {
    test.skip(true, 'PR ' + s.prCode + ' already created');
    return;
  }
  const first = PO_LINES[0]!;
  await page.goto('/purchase-requests/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#prDate').waitFor({ timeout: 60_000 });
  await page.locator('#operation').fill('E2E_ HEAT TREATMENT');
  await pickFromCombo(page, 'vendorId', s.vendorCode!, new RegExp(s.vendorCode!));
  await page.locator('#prType').selectOption('service');
  await page.locator('#itemCodeText').fill(first.code);
  await page.locator('#itemName').fill(first.name);
  await page.locator('#qty').fill(String(first.qty));
  await page.locator('#estCost').fill(String(first.rate));
  await page.locator('#remarks').fill('E2E_ raised by the print-format check - safe to cancel.');
  await page
    .getByRole('button', { name: /Save|Create/ })
    .first()
    .click();
  await expect(page).not.toHaveURL(/purchase-requests\/new/, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const body = await page.locator('body').innerText();
  const m = /IN-[A-Z]*PR-\d+/.exec(body);
  expect(m, 'no PR code on ' + page.url() + '\n' + body.slice(0, 800)).toBeTruthy();
  writeState({ prCode: m![0] });
  console.log('PR CREATED: ' + m![0]);
});

test('3 - create the 45-line purchase order', async ({ page }) => {
  test.setTimeout(1_500_000);
  const s = readState();
  if (s.poId) {
    test.skip(true, 'PO ' + s.poCode + ' already created');
    return;
  }
  await page.goto('/purchase-orders/from-pr', { waitUntil: 'domcontentloaded' });
  await page.locator('#pof-code').waitFor({ timeout: 60_000 });
  await expect(page.locator('#pof-code')).not.toHaveValue('', { timeout: 60_000 });

  await page.locator('#pof-type').selectOption('service');
  await pickFromCombo(page, 'pof-vendor', s.vendorCode!, new RegExp(s.vendorCode!));
  await page.locator('#pof-delivery-days').fill('21');

  // Line 1 is the PR line - the server refuses a PO with no PR behind it.
  await pickFromCombo(page, 'pof-pr-0', s.prCode!, new RegExp(s.prCode!));
  await expect(page.getByLabel('Item code, line 1', { exact: true })).toHaveValue(PO_LINES[0]!.code, {
    timeout: 60_000,
  });

  await page.locator('#pof-remarks').fill('E2E_ print-format check - 45 lines, safe to cancel.');
  await page.locator('#pof-taxtype').selectOption('sgst_cgst');
  await page.locator('#pof-cgst').fill('9');
  await page.locator('#pof-sgst').fill('9');

  // Grow the table to 45 lines.
  const addLine = page.getByRole('button', { name: '+ Add Line' }).first();
  for (let i = 1; i < PO_LINES.length; i += 1) {
    await addLine.click();
  }
  await expect(page.getByLabel('Item code, line ' + PO_LINES.length, { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  for (const [i, line] of PO_LINES.entries()) {
    const n = i + 1;
    await page.getByLabel('Item code, line ' + n, { exact: true }).fill(line.code);
    await page.getByLabel('Item name, line ' + n, { exact: true }).fill(line.name);
    await page.getByLabel('Qty, line ' + n, { exact: true }).fill(String(line.qty));
    await page.getByLabel('Rate, line ' + n, { exact: true }).fill(String(line.rate));
    if (line.remarks) await page.getByLabel('Remarks, line ' + n, { exact: true }).fill(line.remarks);
    if (n % 10 === 0) console.log('  filled line ' + n + '/' + PO_LINES.length);
  }

  const save = page.locator('button.pof-btn-go');
  const foot = await page.locator('.pof-foot-msg, .pof-foot-hint').first().innerText();
  console.log('FOOTER SAYS: ' + foot);
  await expect(save, 'footer says: ' + foot).toBeEnabled({ timeout: 30_000 });
  await save.click();
  await expect(page).toHaveURL(/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const poId = /purchase-orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const body = await page.locator('body').innerText();
  const code = /IN-PO-\d+/.exec(body)?.[0] ?? '';
  writeState({ poId, poCode: code });
  console.log('PO CREATED: ' + code + ' (' + poId + ') with ' + PO_LINES.length + ' lines');
});

test('3b - line remarks read as they should on paper', async ({ page }) => {
  // Idempotent: re-writes the six line remarks from the data file. Kept separate
  // from the create step so the wording can be corrected without rebuilding the
  // whole 45-line order.
  test.setTimeout(600_000);
  const s = readState();
  await page.goto('/purchase-orders/' + s.poId + '/edit', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Item code, line ' + PO_LINES.length, { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  for (const [i, line] of PO_LINES.entries()) {
    if (!line.remarks) continue;
    await page.getByLabel('Remarks, line ' + (i + 1), { exact: true }).fill(line.remarks);
  }
  const save = page.locator('button.pof-btn-go');
  const foot = await page.locator('.pof-foot-msg, .pof-foot-hint').first().innerText();
  await expect(save, 'footer says: ' + foot).toBeEnabled({ timeout: 30_000 });
  await save.click();
  await expect(page).not.toHaveURL(/\/edit$/, { timeout: 120_000 });
  console.log('LINE REMARKS REWRITTEN on ' + s.poCode);
});

test('4 - print the purchase order to PDF', async ({ page }) => {
  const s = readState();
  await page.goto('/purchase-orders/' + s.poId, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(4000);
  await printToPdf(page, PO_PDF);
  console.log('PO PDF: ' + PO_PDF);
});

test('5 - raise the OSP delivery challan', async ({ page }) => {
  test.setTimeout(900_000);
  const s = readState();
  if (s.dcId) {
    test.skip(true, 'DC ' + s.dcCode + ' already created');
    return;
  }
  await page.goto('/delivery-challans/new?poId=' + s.poId, { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-code').waitFor({ timeout: 60_000 });
  await expect(page.locator('#dc-code')).not.toHaveValue('', { timeout: 60_000 });
  await page.locator('#dc-transport').fill('E2E_ Shree Ganesh Roadlines');
  await page.locator('#dc-vehicle-no').fill('GJ-23-E2E-0001');

  const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
  await expect(qtyBoxes).toHaveCount(PO_LINES.length, { timeout: 60_000 });
  const materials = page.locator('table.innovic-table input.innovic-input:not([type])');
  const remarks = page.locator('table.innovic-table textarea');

  const MATERIALS = ['E2E_ EN24', 'E2E_ EN8D', 'E2E_ SS316', 'E2E_ CI FG260', 'E2E_ CW705R'];
  for (const [i, line] of PO_LINES.entries()) {
    const send = Math.max(1, Math.ceil(line.qty / 2));
    await qtyBoxes.nth(i).fill(String(send));
    await materials.nth(i).fill(MATERIALS[i % MATERIALS.length]!);
    if (i % 7 === 0) {
      await remarks
        .nth(i)
        .fill('E2E_ send for heat treatment - return with test report (line ' + (i + 1) + ')');
    }
    if ((i + 1) % 10 === 0) console.log('  DC line ' + (i + 1) + '/' + PO_LINES.length);
  }

  const save = page.getByRole('button', { name: /Save DC/ });
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await save.click();
  await expect(page).toHaveURL(/delivery-challans\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const dcId = /delivery-challans\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const body = await page.locator('body').innerText();
  const code = /IN-DC-\d+/.exec(body)?.[0] ?? '';
  writeState({ dcId, dcCode: code });
  console.log('DC CREATED: ' + code + ' (' + dcId + ')');
});

test('6 - print the delivery challan to PDF', async ({ page }) => {
  const s = readState();
  await page.goto('/delivery-challans/' + s.dcId, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(4000);
  await printToPdf(page, DC_PDF);
  console.log('DC PDF: ' + DC_PDF);
  console.log('STATE: ' + JSON.stringify(readState()));
});
