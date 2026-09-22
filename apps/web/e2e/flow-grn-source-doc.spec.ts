// TEST STACK ONLY (https://innovic-erp.pages.dev -> api-test-....railway.app).
//
// ADR-162 — a GRN is booked FROM its source document:
//   A. a buying (standard) PO directly            — GRN → + New → Against PO
//   B. a job-work / service PO through its DC     — GRN → + New → Against JWPO / DC
//
// This spec builds its OWN chain (two PRs, two POs, one DC) instead of touching
// the standing E2E_ fixture (IN-PO-00003 / IN-DC-00002), because receiving is
// exactly the kind of state change FIXTURES.md says never to do to the fixture.
// Every free-text value carries the E2E_ marker. Document numbers cannot
// (locked to IN-XX-#####), so the PR operation, the PO header remark, the DC
// transporter and the GRN remarks are what make the rows findable.
//
// Steps are serial and resumable: every created id/code is written to a state
// file so a re-run skips the steps already built and continues from there.
// Delete the state file to build a brand-new chain.
//
// Run from apps/web/ (credentials come from .env.e2e — the TEST login):
//   npx playwright test --config=playwright.pages.config.ts e2e/flow-grn-source-doc.spec.ts --reporter=list

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const STATE_FILE =
  'C:/Innovic_projects/innovic-erp/wt-test/apps/web/.playwright/grn-source-doc-state.json';

// The standing E2E vendor on the test stack (FIXTURES.md).
const VENDOR_CODE = 'VND-959';

// Part A — the buying PO: two lines, 10 and 5.
const A_LINE1 = { code: 'E2E_GRN-A1', name: 'E2E_ Hex bolt M10x40', qty: 10, rate: 12 };
const A_LINE2 = { code: 'E2E_GRN-A2', name: 'E2E_ Spring washer M10', qty: 5, rate: 3 };
// Part B — the service PO: one line, 10 out on a challan.
const B_LINE1 = { code: 'E2E_GRN-B1', name: 'E2E_ Gear blank for hardening', qty: 10, rate: 150 };

interface State {
  apiBase?: string;
  // Part A
  aPrCode?: string;
  aPoId?: string;
  aPoCode?: string;
  aPoApproved?: boolean;
  aGrnId?: string;
  aGrnCode?: string;
  // Part B
  bPrCode?: string;
  bPoId?: string;
  bPoCode?: string;
  bPoApproved?: boolean;
  bDcId?: string;
  bDcCode?: string;
  bGrnId?: string;
  bGrnCode?: string;
  bGrn2Id?: string;
  bGrn2Code?: string;
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
function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log('>> ' + msg);
}

/** Guard: this spec writes data, so refuse to run anywhere but the test API. */
async function assertTestStack(page: Page): Promise<string> {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).origin));
  await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const api = [...hosts].find((h) => h.includes('railway.app'));
  expect(api, 'no API host seen').toBeTruthy();
  expect(api, 'refusing to write: API host is ' + api).toContain('api-test-');
  return api!;
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

/** Close an open <SearchableSelect> by clicking outside it. NOT Escape: on the
 *  GRN screen ESC opens the exit-guard "Are you sure?" overlay, which then
 *  swallows every click. */
async function closeCombo(page: Page): Promise<void> {
  await page.locator('.panel-title').first().click();
  await page.waitForTimeout(300);
}

/** Open a <SearchableSelect> and return the visible option labels. */
async function comboOptions(page: Page, id: string, search = ''): Promise<string[]> {
  const box = page.locator('#' + id);
  await box.click();
  if (search) {
    await box.fill(search);
    await page.waitForTimeout(800); // let the 250ms debounce fire before reading loading state
  }
  const listbox = page.locator('#' + id + '-listbox');
  await expect(listbox).toBeVisible({ timeout: 30_000 });
  // The list shows "Loading…" until the query lands; wait that out.
  await expect(listbox).not.toContainText('Loading', { timeout: 60_000 });
  await page.waitForTimeout(500);
  const opts = listbox.getByRole('option');
  const n = await opts.count();
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push((await opts.nth(i).innerText()).trim());
  if (n === 0) log('combo #' + id + ' listbox says: "' + (await listbox.innerText()).trim() + '"');
  await closeCombo(page);
  return out;
}

/** Reads the value rendered beside a label in a detail page's Pair grid. */
async function readPair(page: Page, label: string): Promise<string> {
  const group = page
    .locator('.form-grp')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
  await expect(group, `the detail page shows a "${label}" field`).toBeVisible({ timeout: 30_000 });
  return (await group.locator('div').first().innerText()).trim();
}

/** Column index of a header text inside a table (0-based). */
async function colIndex(table: Locator, header: RegExp): Promise<number> {
  const ths = table.locator('thead th');
  const n = await ths.count();
  for (let i = 0; i < n; i += 1) {
    if (header.test((await ths.nth(i).innerText()).trim())) return i;
  }
  throw new Error('no column matching ' + header);
}

/** The Supabase access token the app itself sends as the Bearer. */
async function bearer(page: Page): Promise<string> {
  await page.goto('/goods-receipt-notes', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
    );
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { access_token?: string };
    return parsed.access_token ?? null;
  });
  expect(token, 'logged-in Supabase session token in localStorage').toBeTruthy();
  return token!;
}

// ── Chain builders (shared by parts A and B) ────────────────────────────────

async function createPr(
  page: Page,
  prType: 'standard' | 'service',
  line: { code: string; name: string; qty: number; rate: number },
  operation: string,
): Promise<string> {
  await page.goto('/purchase-requests/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#prDate').waitFor({ timeout: 60_000 });
  await page.locator('#operation').fill(operation);
  await pickFromCombo(page, 'vendorId', VENDOR_CODE, new RegExp(VENDOR_CODE));
  await page.locator('#prType').selectOption(prType);
  await page.locator('#itemCodeText').fill(line.code);
  await page.locator('#itemName').fill(line.name);
  await page.locator('#qty').fill(String(line.qty));
  await page.locator('#estCost').fill(String(line.rate));
  await page.locator('#remarks').fill('E2E_ GRN source-doc check (ADR-162) - safe to cancel.');
  await page.getByRole('button', { name: /Save|Create/ }).first().click();
  await expect(page).not.toHaveURL(/purchase-requests\/new/, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const body = await page.locator('body').innerText();
  const m = /IN-[A-Z]*PR-\d+/.exec(body);
  expect(m, 'no PR code on ' + page.url()).toBeTruthy();
  return m![0];
}

async function createPoFromPr(
  page: Page,
  poType: 'standard' | 'service',
  prCode: string,
  lines: { code: string; name: string; qty: number; rate: number }[],
  remark: string,
): Promise<{ id: string; code: string }> {
  await page.goto('/purchase-orders/from-pr', { waitUntil: 'domcontentloaded' });
  await page.locator('#pof-code').waitFor({ timeout: 60_000 });
  await page.locator('#pof-type').selectOption(poType);
  await expect(page.locator('#pof-code')).not.toHaveValue('', { timeout: 60_000 });
  await pickFromCombo(page, 'pof-vendor', VENDOR_CODE, new RegExp(VENDOR_CODE));
  await page.locator('#pof-delivery-days').fill('14');
  // Line 1 is the PR line — the server refuses a PO with no PR behind it.
  await pickFromCombo(page, 'pof-pr-0', prCode, new RegExp(prCode));
  await expect(page.getByLabel('Item code, line 1', { exact: true })).toHaveValue(lines[0]!.code, {
    timeout: 60_000,
  });
  await page.locator('#pof-remarks').fill(remark);

  const addLine = page.getByRole('button', { name: '+ Add Line' }).first();
  for (let i = 1; i < lines.length; i += 1) await addLine.click();
  for (const [i, line] of lines.entries()) {
    const n = i + 1;
    await page.getByLabel('Item code, line ' + n, { exact: true }).fill(line.code);
    await page.getByLabel('Item name, line ' + n, { exact: true }).fill(line.name);
    await page.getByLabel('Qty, line ' + n, { exact: true }).fill(String(line.qty));
    await page.getByLabel('Rate, line ' + n, { exact: true }).fill(String(line.rate));
  }
  const save = page.locator('button.pof-btn-go');
  const foot = await page.locator('.pof-foot-msg, .pof-foot-hint').first().innerText();
  await expect(save, 'footer says: ' + foot).toBeEnabled({ timeout: 30_000 });
  await save.click();
  await expect(page).toHaveURL(/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const id = /purchase-orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const body = await page.locator('body').innerText();
  const code = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(body)?.[0] ?? '';
  expect(code, 'PO code on the detail page').toMatch(/IN-[A-Z]*PO-\d+/);
  return { id, code };
}

async function approvePo(page: Page, poId: string): Promise<string> {
  await page.goto('/purchase-orders/' + poId, { waitUntil: 'domcontentloaded' });
  const badge = page.locator('.panel-hdr .badge').first();
  await expect(badge).toBeVisible({ timeout: 60_000 });
  const before = (await badge.innerText()).trim().toLowerCase();
  // On the test stack an admin's PO is born `open` (no approver step); only a
  // `draft` needs the Approve click.
  if (before !== 'draft') {
    log('PO is already "' + before + '" — no approval step needed');
    return before;
  }
  const approve = page.getByRole('button', { name: /^Approve$/ });
  await expect(
    approve,
    'the test login must be a PO approver (Approve button on a draft PO)',
  ).toBeVisible({ timeout: 60_000 });
  await approve.click();
  await page.getByRole('button', { name: 'Approve PO' }).click();
  await expect(page.locator('.panel-hdr .badge').first()).toHaveText(/open/i, { timeout: 60_000 });
  return (await page.locator('.panel-hdr .badge').first().innerText()).trim().toLowerCase();
}

/** Reads {received, status} for every line off the PO detail page. */
async function readPo(page: Page, poId: string): Promise<{ status: string; received: number[]; qty: number[] }> {
  await page.goto('/purchase-orders/' + poId, { waitUntil: 'domcontentloaded' });
  const table = page
    .locator('table.innovic-table')
    .filter({ has: page.locator('th', { hasText: /^Received$/i }) })
    .first();
  await expect(table.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const recIdx = await colIndex(table, /^Received$/i);
  const qtyIdx = await colIndex(table, /^Qty$/i);
  const rows = table.locator('tbody tr');
  const n = await rows.count();
  const received: number[] = [];
  const qty: number[] = [];
  for (let i = 0; i < n; i += 1) {
    received.push(Number((await rows.nth(i).locator('td').nth(recIdx).innerText()).trim()));
    qty.push(Number((await rows.nth(i).locator('td').nth(qtyIdx).innerText()).trim()));
  }
  const status = (await page.locator('.panel-hdr .badge').first().innerText()).trim().toLowerCase();
  return { status, received, qty };
}

/** Reads the GRN detail page: code, PO, DC No., Open DC present, line received qtys. */
async function readGrnDetail(page: Page, grnId: string) {
  await page.goto('/goods-receipt-notes/' + grnId, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .td-code').first()).toHaveText(/IN-GRN-\d+/, {
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  const code = (await page.locator('.panel-hdr .td-code').first().innerText()).trim();
  const po = await readPair(page, 'PO');
  const dcNo = await readPair(page, 'DC No.');
  const vendor = await readPair(page, 'Vendor');
  const openDc = await page.getByRole('link', { name: 'Open DC' }).count();
  const table = page
    .locator('table.innovic-table')
    .filter({ has: page.locator('th', { hasText: /^Received$/i }) })
    .first();
  const recIdx = await colIndex(table, /^Received$/i);
  const rows = table.locator('tbody tr');
  const n = await rows.count();
  const received: number[] = [];
  for (let i = 0; i < n; i += 1) {
    received.push(Number((await rows.nth(i).locator('td').nth(recIdx).innerText()).trim()));
  }
  return { code, po, dcNo, vendor, openDc, received };
}

/** Rows of the Against-PO line table as numbers: [poQty, receivedSoFar, balance, receiveNow]. */
async function readPoTabLines(page: Page): Promise<number[][]> {
  const rows = page.locator('form table.innovic-table tbody tr');
  const n = await rows.count();
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const tds = rows.nth(i).locator('td');
    if ((await tds.count()) < 7) continue; // the empty-state row
    out.push([
      Number((await tds.nth(3).innerText()).trim()),
      Number((await tds.nth(4).innerText()).trim()),
      Number((await tds.nth(5).innerText()).trim()),
      Number(await page.getByLabel(`Receive now, line ${i + 1}`, { exact: true }).inputValue()),
    ]);
  }
  return out;
}

async function openNewGrn(page: Page, tab: 'po' | 'dc'): Promise<void> {
  await page.goto('/goods-receipt-notes/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Against PO/ })).toBeVisible({ timeout: 60_000 });
  if (tab === 'dc') {
    await page.getByRole('button', { name: /Against JWPO \/ DC/ }).click();
    await expect(page.locator('#jwpoId')).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.locator('#purchaseOrderId')).toBeVisible({ timeout: 30_000 });
  }
  await page.waitForTimeout(1500);
}

// ═══════════════════════════════════════════════════════════════════════════
// Part A — PO → Item → GRN
// ═══════════════════════════════════════════════════════════════════════════

test('0 - this is the test stack', async ({ page }) => {
  const api = await assertTestStack(page);
  writeState({ apiBase: api });
  log('API: ' + api);
});

test('A1 - build the buying chain: PR -> standard PO (10 + 5) -> approve', async ({ page }) => {
  test.setTimeout(600_000);
  let s = readState();
  if (!s.aPrCode) {
    const pr = await createPr(page, 'standard', A_LINE1, 'E2E_ GRN-A purchase');
    s = writeState({ aPrCode: pr });
    log('A: PR ' + pr);
  }
  if (!s.aPoId) {
    const po = await createPoFromPr(
      page,
      'standard',
      s.aPrCode!,
      [A_LINE1, A_LINE2],
      'E2E_ GRN Against-PO check (ADR-162) - safe to cancel.',
    );
    s = writeState({ aPoId: po.id, aPoCode: po.code });
    log('A: PO ' + po.code + ' (' + po.id + ')');
  }
  if (!s.aPoApproved) {
    const status = await approvePo(page, s.aPoId!);
    s = writeState({ aPoApproved: true });
    log('A: PO ' + s.aPoCode + ' approved -> status ' + status);
  }
  const po = await readPo(page, s.aPoId!);
  log('A: PO lines qty ' + JSON.stringify(po.qty) + ' received ' + JSON.stringify(po.received) + ' status ' + po.status);
  expect(po.qty).toEqual([10, 5]);
});

test('A2 - Against PO: picking the PO fills vendor + the two pending lines, no QC fields', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  if (s.aGrnId) {
    test.skip(true, 'fresh-PO check already done before GRN ' + s.aGrnCode + ' was created (see A5 for the after-state)');
    return;
  }
  await openNewGrn(page, 'po');
  await pickFromCombo(page, 'purchaseOrderId', s.aPoCode!, new RegExp(s.aPoCode!.replace('/', '\\/')));

  const vendor = page.locator('#vendor');
  await expect(vendor).toHaveAttribute('readonly', '');
  await expect(vendor).toHaveValue(/E2E_ Shreeji/, { timeout: 30_000 });
  log('A2: vendor field = "' + (await vendor.inputValue()) + '" (read-only)');

  await expect(page.getByLabel('Receive now, line 2', { exact: true })).toBeVisible({ timeout: 30_000 });
  const lines = await readPoTabLines(page);
  log('A2: lines [poQty, soFar, balance, receiveNow] = ' + JSON.stringify(lines));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toEqual([10, 0, 10, 10]);
  expect(lines[1]).toEqual([5, 0, 5, 5]);

  const form = page.locator('form');
  for (const t of ['QC By', 'QC Accepted', 'QC Rejected', 'QC Date', 'QC Report']) {
    expect(await form.getByText(t, { exact: false }).count(), `no "${t}" on the Against PO form`).toBe(0);
  }
  log('A2: no QC By / QC Accepted / QC Rejected fields on the form');
});

test('A3 - Receive Now 11 is refused inline; 4 + 5 creates the GRN', async ({ page }) => {
  test.setTimeout(300_000);
  let s = readState();
  if (s.aGrnId) {
    test.skip(true, 'GRN ' + s.aGrnCode + ' already created');
    return;
  }
  await openNewGrn(page, 'po');
  await pickFromCombo(page, 'purchaseOrderId', s.aPoCode!, new RegExp(s.aPoCode!.replace('/', '\\/')));
  const line1 = page.getByLabel('Receive now, line 1', { exact: true });
  await expect(line1).toHaveValue('10', { timeout: 30_000 });

  await line1.fill('11');
  await expect(page.getByText('Cannot exceed balance of 10.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Create GRN/ }).click();
  await page.waitForTimeout(3000);
  // Two nets stop the submit: the input's native max=10 (browser constraint
  // validation, no JS handler runs) and, if that were bypassed, the form's own
  // "Fix the highlighted quantities." Either way the page must stay on /new.
  const native = await line1.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow);
  const summary = await page.getByText('Fix the highlighted quantities.').count();
  await expect(page).toHaveURL(/goods-receipt-notes\/new/);
  await expect(page.getByText('Cannot exceed balance of 10.', { exact: true })).toBeVisible();
  log(
    'A3: 11 -> "Cannot exceed balance of 10." shown; Create refused (still on /new; native max block=' +
      native +
      ', form summary shown=' +
      (summary > 0) +
      ')',
  );

  await line1.fill('4');
  await expect(page.getByLabel('Receive now, line 2', { exact: true })).toHaveValue('5');
  await page.locator('#remarks').fill('E2E_ GRN against PO - partial (4 + 5)');
  await page.getByRole('button', { name: /Create GRN/ }).click();
  await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const grnId = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const d = await readGrnDetail(page, grnId);
  s = writeState({ aGrnId: grnId, aGrnCode: d.code });
  log('A3: GRN ' + d.code + ' (' + grnId + ') PO=' + d.po + ' lines received=' + JSON.stringify(d.received));
  expect(d.po).toBe(s.aPoCode);
  expect(d.received).toEqual([4, 5]);
  expect(d.openDc, 'a PO-sourced GRN has no Open DC button').toBe(0);
});

test('A4 - PO detail: received 4 and 5, status partial', async ({ page }) => {
  test.setTimeout(180_000);
  const s = readState();
  const po = await readPo(page, s.aPoId!);
  log('A4: PO ' + s.aPoCode + ' received=' + JSON.stringify(po.received) + ' status=' + po.status);
  expect(po.received).toEqual([4, 5]);
  expect(po.status).toBe('partial');
});

test('A5 - Against PO again: only line 1 (balance 6) is offered; clearing / swapping the PO refreshes the table', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  await openNewGrn(page, 'po');
  const escaped = s.aPoCode!.replace('/', '\\/');
  await pickFromCombo(page, 'purchaseOrderId', s.aPoCode!, new RegExp(escaped));
  await expect(page.getByLabel('Receive now, line 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  const lines = await readPoTabLines(page);
  log('A5: lines after re-pick = ' + JSON.stringify(lines));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toEqual([10, 4, 6, 6]);
  const item = (await page.locator('form table.innovic-table tbody tr').first().locator('td').nth(1).innerText()).trim();
  expect(item).toContain(A_LINE1.code);

  // Clear the picker (delete its text) -> the table must empty.
  const box = page.locator('#purchaseOrderId');
  await box.click();
  await box.fill('');
  await closeCombo(page);
  await expect(page.getByText('Pick a purchase order to load its pending lines.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#vendor')).toHaveValue('');
  expect(await page.getByLabel(/Receive now, line/).count()).toBe(0);
  log('A5: cleared -> "Pick a purchase order to load its pending lines.", vendor blank, 0 lines');

  // Swap to a DIFFERENT approved buying PO, if the test stack has one.
  const others = (await comboOptions(page, 'purchaseOrderId', 'IN-')).filter(
    (o) => !o.includes(s.aPoCode!),
  );
  if (others.length === 0) {
    log('A5: no other approved buying PO on the test stack — swap check done via clear only');
  } else {
    const otherCode = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(others[0]!)![0];
    await pickFromCombo(page, 'purchaseOrderId', otherCode, new RegExp(otherCode.replace('/', '\\/')));
    await page.waitForTimeout(3000);
    const swapped = await readPoTabLines(page);
    const firstItem = swapped.length
      ? (await page.locator('form table.innovic-table tbody tr').first().locator('td').nth(1).innerText()).trim()
      : '(no pending lines)';
    log('A5: swapped to ' + otherCode + ' -> ' + swapped.length + ' line(s), first item "' + firstItem + '"');
    expect(firstItem, 'the previous PO’s item must not linger').not.toContain(A_LINE1.code);
    // Back to ours: line 1 / balance 6 comes back.
    await pickFromCombo(page, 'purchaseOrderId', s.aPoCode!, new RegExp(escaped));
    await expect(page.getByLabel('Receive now, line 1', { exact: true })).toHaveValue('6', { timeout: 30_000 });
    log('A5: back to ' + s.aPoCode + ' -> Receive Now 6 again');
  }
  // Nothing saved here.
});

test('A6 - server guard via API: over-balance -> 409, same PO line twice -> 400', async ({ page }) => {
  test.setTimeout(180_000);
  const s = readState();
  const token = await bearer(page);
  const api = s.apiBase!;
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };

  const poRes = await page.request.get(api + '/purchase-orders/' + s.aPoId, { headers });
  expect(poRes.status()).toBe(200);
  const po = (await poRes.json()) as {
    code: string;
    vendorId: string | null;
    lines: { id: string; lineNo: number; itemName: string; itemCodeText: string | null; qty: number; receivedQty: number }[];
  };
  const l1 = po.lines.find((l) => l.lineNo === 1)!;
  log('A6: PO line 1 from API: qty ' + l1.qty + ' received ' + l1.receivedQty);

  const today = new Date().toISOString().slice(0, 10);
  const header = {
    grnDate: today,
    purchaseOrderId: s.aPoId,
    poCodeText: po.code,
    ...(po.vendorId ? { vendorId: po.vendorId } : {}),
    remarks: 'E2E_ API guard probe - must be refused',
  };
  const line = (qty: number) => ({
    purchaseOrderLineId: l1.id,
    itemCodeText: l1.itemCodeText ?? A_LINE1.code,
    itemName: l1.itemName,
    receivedQty: qty,
    qcStatus: 'pending',
    qcAcceptedQty: 0,
    qcRejectedQty: 0,
  });

  const over = await page.request.post(api + '/goods-receipt-notes', {
    headers,
    data: { header, lines: [line(7)] },
  });
  const overBody = await over.text();
  log('A6: over-receipt (7 vs balance 6) -> HTTP ' + over.status() + ' ' + overBody);
  expect(over.status()).toBe(409);
  expect(overBody).toContain('only 6 more can be received');

  const dup = await page.request.post(api + '/goods-receipt-notes', {
    headers,
    data: { header, lines: [line(1), line(1)] },
  });
  const dupBody = await dup.text();
  log('A6: same PO line twice -> HTTP ' + dup.status() + ' ' + dupBody);
  expect(dup.status()).toBe(400);
  expect(dupBody).toContain('appears twice');

  // Prove neither probe wrote anything: the PO line balance is unchanged.
  const after = (await (await page.request.get(api + '/purchase-orders/' + s.aPoId, { headers })).json()) as {
    lines: { lineNo: number; receivedQty: number }[];
  };
  const l1After = after.lines.find((l) => l.lineNo === 1)!;
  log('A6: PO line 1 received after probes = ' + l1After.receivedQty);
  expect(l1After.receivedQty).toBe(4);
});

// ═══════════════════════════════════════════════════════════════════════════
// Part B — JWPO → DC → Item → GRN
// ═══════════════════════════════════════════════════════════════════════════

test('B1 - build the material-out chain: PR -> service PO (10) -> approve -> Issue DC for 10', async ({ page }) => {
  test.setTimeout(600_000);
  let s = readState();
  if (!s.bPrCode) {
    const pr = await createPr(page, 'service', B_LINE1, 'E2E_ GRN-B HARDENING');
    s = writeState({ bPrCode: pr });
    log('B: PR ' + pr);
  }
  if (!s.bPoId) {
    const po = await createPoFromPr(
      page,
      'service',
      s.bPrCode!,
      [B_LINE1],
      'E2E_ GRN Against-DC check (ADR-162) - safe to cancel.',
    );
    s = writeState({ bPoId: po.id, bPoCode: po.code });
    log('B: PO ' + po.code + ' (' + po.id + ')');
  }
  if (!s.bPoApproved) {
    const status = await approvePo(page, s.bPoId!);
    s = writeState({ bPoApproved: true });
    log('B: PO ' + s.bPoCode + ' approved -> status ' + status);
  }
  if (!s.bDcId) {
    await page.goto('/delivery-challans/new?poId=' + s.bPoId, { waitUntil: 'domcontentloaded' });
    await page.locator('#dc-code').waitFor({ timeout: 60_000 });
    await expect(page.locator('#dc-code')).not.toHaveValue('', { timeout: 60_000 });
    await page.locator('#dc-transport').fill('E2E_ Shree Ganesh Roadlines');
    await page.locator('#dc-vehicle-no').fill('GJ-23-E2E-0162');
    const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
    await expect(qtyBoxes).toHaveCount(1, { timeout: 60_000 });
    await qtyBoxes.first().fill(String(B_LINE1.qty));
    const materials = page.locator('table.innovic-table input.innovic-input:not([type])');
    await materials.first().fill('E2E_ EN24');
    const save = page.getByRole('button', { name: /Save DC/ });
    await expect(save).toBeEnabled({ timeout: 60_000 });
    await save.click();
    await expect(page).toHaveURL(/delivery-challans\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    const dcId = /delivery-challans\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    await page.waitForTimeout(4000);
    const body = await page.locator('body').innerText();
    // Challan numbers carry their revision (IN-DC-00006/R1), like POs.
    const code = /IN-DC-\d+(?:\/R\d+)?/.exec(body)?.[0] ?? '';
    expect(code).toMatch(/IN-DC-\d+/);
    s = writeState({ bDcId: dcId, bDcCode: code });
    log('B: DC ' + code + ' (' + dcId + ') for ' + B_LINE1.qty);
  }
});

test('B2 - Against JWPO / DC: pickers cascade (JWPO -> DC -> vendor + lines) and clear on change', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  if (s.bGrnId) {
    test.skip(true, 'fresh-DC check already done before GRN ' + s.bGrnCode + ' was created (see B6 for the after-state)');
    return;
  }
  await openNewGrn(page, 'dc');

  const dcBox = page.locator('#dcId');
  await expect(dcBox, 'DC picker disabled before a JWPO is picked').toBeDisabled();

  const jwpoOpts = await comboOptions(page, 'jwpoId', '');
  log('B2: JWPO picker offers ' + jwpoOpts.length + ' PO(s): ' + JSON.stringify(jwpoOpts.slice(0, 10)));
  expect(jwpoOpts.some((o) => o.includes(s.bPoCode!)), 'my service PO is offered').toBe(true);
  expect(jwpoOpts.some((o) => o.includes(s.aPoCode!)), 'the buying PO from part A is NOT offered').toBe(false);

  await pickFromCombo(page, 'jwpoId', s.bPoCode!, new RegExp(s.bPoCode!.replace('/', '\\/')));
  await expect(dcBox).toBeEnabled({ timeout: 30_000 });
  const dcOpts = await comboOptions(page, 'dcId', '');
  log('B2: DC picker offers: ' + JSON.stringify(dcOpts));
  expect(dcOpts.some((o) => o.includes(s.bDcCode!)), 'my DC is offered').toBe(true);

  await pickFromCombo(page, 'dcId', s.bDcCode!, new RegExp(s.bDcCode!.replace('/', '\\/')));
  await expect(page.locator('#dcVendor')).toHaveValue(/E2E_ Shreeji/, { timeout: 30_000 });
  await expect(page.getByLabel('Receive now, line 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  const tds = page.locator('form table.innovic-table tbody tr').first().locator('td');
  const sent = Number((await tds.nth(3).innerText()).trim());
  const soFar = Number((await tds.nth(4).innerText()).trim());
  const balance = Number((await tds.nth(5).innerText()).trim());
  const receiveNow = Number(await page.getByLabel('Receive now, line 1', { exact: true }).inputValue());
  log('B2: vendor="' + (await page.locator('#dcVendor').inputValue()) + '" sent=' + sent + ' soFar=' + soFar + ' balance=' + balance + ' receiveNow=' + receiveNow);
  expect([sent, soFar, balance, receiveNow]).toEqual([10, 0, 10, 10]);

  // Change / clear the JWPO -> DC + vendor + lines must go.
  const jwpoBox = page.locator('#jwpoId');
  await jwpoBox.click();
  await jwpoBox.fill('');
  await closeCombo(page);
  await expect(dcBox).toBeDisabled({ timeout: 30_000 });
  await expect(dcBox).toHaveValue('');
  await expect(page.locator('#dcVendor')).toHaveValue('');
  expect(await page.getByLabel(/Receive now, line/).count()).toBe(0);
  await expect(page.getByText(/Pick a JWPO, then one of its delivery challans/)).toBeVisible();
  log('B2: JWPO cleared -> DC picker disabled + blank, vendor blank, 0 lines');

  // Re-pick -> everything comes back.
  await pickFromCombo(page, 'jwpoId', s.bPoCode!, new RegExp(s.bPoCode!.replace('/', '\\/')));
  await pickFromCombo(page, 'dcId', s.bDcCode!, new RegExp(s.bDcCode!.replace('/', '\\/')));
  await expect(page.getByLabel('Receive now, line 1', { exact: true })).toHaveValue('10', { timeout: 30_000 });
  log('B2: re-picked -> line 1 Receive Now 10 again');
});

test('B3 - receive 6 of 10 through the DC tab -> lands on the auto-GRN with Open DC', async ({ page }) => {
  test.setTimeout(300_000);
  let s = readState();
  if (s.bGrnId) {
    test.skip(true, 'GRN ' + s.bGrnCode + ' already created');
    return;
  }
  await openNewGrn(page, 'dc');
  await pickFromCombo(page, 'jwpoId', s.bPoCode!, new RegExp(s.bPoCode!.replace('/', '\\/')));
  await pickFromCombo(page, 'dcId', s.bDcCode!, new RegExp(s.bDcCode!.replace('/', '\\/')));
  const line1 = page.getByLabel('Receive now, line 1', { exact: true });
  await expect(line1).toHaveValue('10', { timeout: 30_000 });
  await line1.fill('6');
  await page.locator('#dcRemarks').fill('E2E_ GRN against DC - partial (6 of 10)');
  await page.getByRole('button', { name: /Create GRN/ }).click();
  await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const grnId = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const d = await readGrnDetail(page, grnId);
  s = writeState({ bGrnId: grnId, bGrnCode: d.code });
  log('B3: GRN ' + d.code + ' (' + grnId + ') PO=' + d.po + ' DC No.=' + d.dcNo + ' OpenDC=' + d.openDc + ' received=' + JSON.stringify(d.received));
  expect(d.openDc, '"Open DC" button on the DC-sourced GRN').toBe(1);
  expect(d.dcNo).toBe(s.bDcCode);
  expect(d.po).toBe(s.bPoCode);
  expect(d.received).toEqual([6]);
});

test('B4 - DC detail shows one receipt of 6 and stays issued; PO received 6', async ({ page }) => {
  test.setTimeout(180_000);
  const s = readState();
  await page.goto('/delivery-challans/' + s.bDcId, { waitUntil: 'domcontentloaded' });
  const panel = page.locator('.panel').filter({ has: page.getByText('Receipts', { exact: true }) }).first();
  await expect(panel).toBeVisible({ timeout: 60_000 });
  const count = (await panel.locator('.panel-hdr').innerText()).trim();
  const receivedCells = panel.locator('tbody tr td:nth-child(2)');
  await expect(receivedCells.first()).toBeVisible({ timeout: 30_000 });
  const receipts: string[] = [];
  for (let i = 0; i < (await receivedCells.count()); i += 1) receipts.push((await receivedCells.nth(i).innerText()).trim());
  const status = (await page.locator('.panel-hdr .badge').first().innerText()).trim().toLowerCase();
  log('B4: DC ' + s.bDcCode + ' receipts panel "' + count.replace(/\s+/g, ' ') + '" received cells ' + JSON.stringify(receipts) + ' status ' + status);
  expect(count).toContain('1 receipt');
  expect(receipts).toEqual(['6.00']);
  expect(status).toBe('issued');

  const po = await readPo(page, s.bPoId!);
  log('B4: PO ' + s.bPoCode + ' received=' + JSON.stringify(po.received) + ' status=' + po.status);
  expect(po.received).toEqual([6]);
});

test('B5 - GRN list cards: Against DC / Against PO badges, expand, pills, no horizontal scroll at 1280', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/goods-receipt-notes', { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder(/Search GRN no/);
  await search.waitFor({ timeout: 60_000 });

  const cardFor = (code: string) =>
    page.locator('.panel').filter({ has: page.getByRole('link', { name: code, exact: true }) }).first();

  await search.fill(s.bGrnCode!);
  await page.waitForTimeout(3000);
  const bCard = cardFor(s.bGrnCode!);
  await expect(bCard).toBeVisible({ timeout: 30_000 });
  await expect(bCard.locator('.badge', { hasText: 'Against DC' })).toBeVisible();
  await expect(bCard.locator('.badge', { hasText: 'QC Pending' })).toBeVisible();
  log('B5: ' + s.bGrnCode + ' card badges: ' + (await bCard.locator('.badge').allInnerTexts()).join(' | '));

  // Click the card -> its lines expand.
  await bCard.getByText(/E2E_ Shreeji/).first().click();
  await expect(bCard.locator('table.innovic-table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  const expanded = (await bCard.locator('table.innovic-table tbody tr').first().innerText()).replace(/\s+/g, ' ');
  log('B5: expanded line: ' + expanded);
  expect(expanded).toContain(B_LINE1.code);

  await search.fill(s.aGrnCode!);
  await page.waitForTimeout(3000);
  const aCard = cardFor(s.aGrnCode!);
  await expect(aCard).toBeVisible({ timeout: 30_000 });
  await expect(aCard.locator('.badge', { hasText: 'Against PO' })).toBeVisible();
  log('B5: ' + s.aGrnCode + ' card badges: ' + (await aCard.locator('.badge').allInnerTexts()).join(' | '));

  // Status pills filter: "completed" must hide both fresh (pending) GRNs; "pending" shows them.
  await search.fill('');
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /^completed$/i }).click();
  await expect(page).toHaveURL(/qcStatus=completed/, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(
    page.getByRole('link', { name: s.aGrnCode!, exact: true }),
    'pending GRN hidden under "completed"',
  ).toHaveCount(0, { timeout: 30_000 });
  log('B5: under "completed": ' + (await page.locator('.panel .td-code').allInnerTexts()).join(', '));
  await page.getByRole('button', { name: /^pending$/i }).click();
  await expect(page).toHaveURL(/qcStatus=pending/, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByRole('link', { name: s.aGrnCode!, exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^All$/i }).click();
  await page.waitForTimeout(2000);
  log('B5: pills — completed hides the fresh GRNs, pending shows them');

  const scroll = await page.evaluate(() => {
    const d = document.documentElement;
    const content = document.querySelector('#content') as HTMLElement | null;
    return {
      docScrollW: d.scrollWidth,
      docClientW: d.clientWidth,
      contentScrollW: content?.scrollWidth ?? null,
      contentClientW: content?.clientWidth ?? null,
    };
  });
  log('B5: widths at 1280: ' + JSON.stringify(scroll));
  expect(scroll.docScrollW, 'no horizontal page scrollbar').toBeLessThanOrEqual(scroll.docClientW);
  if (scroll.contentScrollW !== null && scroll.contentClientW !== null) {
    expect(scroll.contentScrollW, 'no horizontal scroll in #content').toBeLessThanOrEqual(scroll.contentClientW + 1);
  }
});

test('B6 - receive the remaining 4: DC picker shows balance 4, then DC = received and the JWPO drops out', async ({ page }) => {
  test.setTimeout(300_000);
  let s = readState();
  if (!s.bGrn2Id) {
    await openNewGrn(page, 'dc');
    await pickFromCombo(page, 'jwpoId', s.bPoCode!, new RegExp(s.bPoCode!.replace('/', '\\/')));
    const dcOpts = await comboOptions(page, 'dcId', '');
    log('B6: DC picker offers: ' + JSON.stringify(dcOpts));
    expect(dcOpts.filter((o) => o.includes(s.bDcCode!))).toHaveLength(1);
    await pickFromCombo(page, 'dcId', s.bDcCode!, new RegExp(s.bDcCode!.replace('/', '\\/')));
    await expect(page.getByLabel('Receive now, line 1', { exact: true })).toHaveValue('4', { timeout: 30_000 });
    const tds = page.locator('form table.innovic-table tbody tr').first().locator('td');
    const nums = [3, 4, 5].map(async (i) => Number((await tds.nth(i).innerText()).trim()));
    const [sent, soFar, balance] = await Promise.all(nums);
    log('B6: sent=' + sent + ' soFar=' + soFar + ' balance=' + balance);
    expect([sent, soFar, balance]).toEqual([10, 6, 4]);
    expect(await page.getByLabel(/Receive now, line/).count()).toBe(1);
    await page.locator('#dcRemarks').fill('E2E_ GRN against DC - balance (4 of 10)');
    await page.getByRole('button', { name: /Create GRN/ }).click();
    await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    const grnId = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    const d = await readGrnDetail(page, grnId);
    s = writeState({ bGrn2Id: grnId, bGrn2Code: d.code });
    log('B6: GRN ' + d.code + ' (' + grnId + ') DC No.=' + d.dcNo + ' received=' + JSON.stringify(d.received));
    expect(d.received).toEqual([4]);
    expect(d.dcNo).toBe(s.bDcCode);
  }

  await page.goto('/delivery-challans/' + s.bDcId, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .badge').first()).toHaveText(/^received$/i, { timeout: 60_000 });
  log('B6: DC ' + s.bDcCode + ' status = received');
  const po = await readPo(page, s.bPoId!);
  log('B6: PO ' + s.bPoCode + ' received=' + JSON.stringify(po.received) + ' status=' + po.status);
  expect(po.received).toEqual([10]);

  await openNewGrn(page, 'dc');
  const jwpoOpts = await comboOptions(page, 'jwpoId', '');
  log('B6: JWPO picker now offers: ' + JSON.stringify(jwpoOpts.slice(0, 10)));
  expect(jwpoOpts.some((o) => o.includes(s.bPoCode!)), 'fully-received JWPO no longer offered').toBe(false);
});

test('B7 - Incoming QC lists both new GRNs as pending inspection (read-only)', async ({ page }) => {
  test.setTimeout(180_000);
  const s = readState();
  await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Pending Inspection/)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  const pendingTable = page.locator('table').filter({ has: page.getByText('Pending QC', { exact: true }) }).first();
  const rowsText = (await pendingTable.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  const mine = rowsText.filter((t) => t.includes(s.aGrnCode!) || t.includes(s.bGrnCode!) || t.includes(s.bGrn2Code ?? '§'));
  log('B7: pending rows for my GRNs (' + mine.length + '):\n   ' + mine.join('\n   '));
  expect(rowsText.filter((t) => t.includes(s.aGrnCode!)), s.aGrnCode + ' lines pending').toHaveLength(2);
  expect(rowsText.filter((t) => t.includes(s.bGrnCode!)), s.bGrnCode + ' line pending').toHaveLength(1);
  log('STATE: ' + JSON.stringify(readState()));
});
