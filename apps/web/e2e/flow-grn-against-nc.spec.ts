// TEST STACK ONLY (https://innovic-erp.pages.dev -> api-test-....railway.app).
//
// ADR-163 — GRN "Against NC": the NC's own return-to-vendor challan is the
// source; GRN Type is one dropdown; the GRN number is never typed.
//
// This spec builds its OWN NC chain (SO -> JC -> Turning -> DIR QC 10 ok / 4
// rejected -> NC -> dispose Return to vendor -> Create DC on VND-959), because
// receiving is a state change and nothing standing on the test stack carries
// the E2E_ marker in `sent_to_vendor`. Every free-text value carries E2E_:
// the SO's client PO ref, the op-entry operator/inspector names, the NC
// disposition remark, the DC transporter/remarks, the GRN remarks.
//
// Steps are serial and resumable: every created id/code is written to a state
// file so a re-run skips the steps already built and continues from there.
// Delete the state file to build a brand-new chain.
//
// Run from apps/web/ (credentials come from .env.e2e — the TEST login):
//   npx playwright test --config=playwright.pages.config.ts e2e/flow-grn-against-nc.spec.ts --reporter=list

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const STATE_FILE =
  'C:/Innovic_projects/innovic-erp/wt-test/apps/web/.playwright/grn-against-nc-state.json';

// The standing E2E vendor on the test stack (FIXTURES.md).
const VENDOR_CODE = 'VND-959';
const VENDOR_NAME = /E2E_ Shreeji/;
// The same item the QC–NC rework spec uses; it exists on the test stack.
const ITEM_CODE = '554117144000';
const ORDER_QTY = 14;
const QC_OK = 10;
const QC_REJ = 4;
const FIRST_RECEIVE = 3; // leaves a balance of 1 for the old Challan -> Receive page
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

interface State {
  apiBase?: string;
  soCode?: string;
  jcCode?: string;
  jcUrl?: string;
  opSeq?: number;
  ncCode?: string;
  ncId?: string;
  ncUrl?: string;
  ncDisposed?: boolean;
  dcId?: string;
  dcCode?: string;
  grnId?: string;
  grnCode?: string;
  grn2Id?: string;
  grn2Code?: string;
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
const today = (): string => new Date().toISOString().slice(0, 10);
const now = (): string => new Date().toTimeString().slice(0, 5);

/** Guard: this spec writes data, so refuse to run anywhere but the test API. */
async function assertTestStack(page: Page): Promise<string> {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).origin));
  await page.goto('/goods-receipt-notes', { waitUntil: 'domcontentloaded' });
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
 *  GRN screen ESC opens the exit-guard "Are you sure?" overlay. */
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
    await page.waitForTimeout(800);
  }
  const listbox = page.locator('#' + id + '-listbox');
  await expect(listbox).toBeVisible({ timeout: 30_000 });
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

// ── Op Entry helpers (same pattern as flow-qc-nc-rework.spec.ts) ─────────────

async function pickFirst(page: Page, input: Locator, term: string): Promise<void> {
  await input.click();
  await input.fill(term);
  const opt = page.locator('[role="option"]').filter({ hasNotText: /Loading/i }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.waitForTimeout(400);
}

async function loadJc(page: Page, jc: string): Promise<void> {
  await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const box = page.locator('#jc-input');
  await box.click();
  await box.fill(jc);
  const opt = page.locator('[role="option"]').filter({ hasText: jc }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(800);
}

async function fillEntryHeader(page: Page, operator: string): Promise<void> {
  await page.locator('#opf-date').fill(today());
  await page.locator('#opf-time').fill(now());
  await page.locator('#opf-shift').selectOption('day');
  await page.locator('#opf-op').first().fill(operator);
}

async function popupGone(page: Page): Promise<void> {
  await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden', timeout: 120_000 });
  await page.waitForTimeout(800);
}

function opRow(page: Page, opName: string): Locator {
  return page.locator('tr').filter({ hasText: opName }).first();
}

// ── GRN screen helpers ───────────────────────────────────────────────────────

type InwardType = 'purchase' | 'job_work_return' | 'nc_return';

async function openNewGrn(page: Page, type: InwardType): Promise<void> {
  await page.goto('/goods-receipt-notes/new', { waitUntil: 'domcontentloaded' });
  const sel = page.locator('#grnInwardType');
  await expect(sel).toBeVisible({ timeout: 60_000 });
  await sel.selectOption(type);
  const anchor = { purchase: '#purchaseOrderId', job_work_return: '#jwpoId', nc_return: '#ncId' }[type];
  await expect(page.locator(anchor)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

/** Rows of the Against-NC line table as numbers: [sent, soFar, balance, receiveNow]. */
async function readNcTabLines(page: Page): Promise<number[][]> {
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

/** Reads the GRN detail page. */
async function readGrnDetail(page: Page, grnId: string) {
  await page.goto('/goods-receipt-notes/' + grnId, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .td-code').first()).toHaveText(/IN-GRN-\d+/, {
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  const code = (await page.locator('.panel-hdr .td-code').first().innerText()).trim();
  const hasPoPair = (await page.locator('.form-grp').filter({ has: page.getByText('PO', { exact: true }) }).count()) > 0;
  const nc = (await page.locator('.form-grp').filter({ has: page.getByText('NC', { exact: true }) }).count()) > 0
    ? await readPair(page, 'NC')
    : '';
  // Our DC shows as "DC No." (DC-linked GRN); the vendor's own challan as
  // "Vendor Challan No."; neither pair renders when both are empty.
  const pairCount = async (l: string): Promise<number> =>
    page.locator('.form-grp').filter({ has: page.getByText(l, { exact: true }) }).count();
  const dcNo = (await pairCount('DC No.')) > 0
    ? await readPair(page, 'DC No.')
    : (await pairCount('Vendor Challan No.')) > 0
      ? await readPair(page, 'Vendor Challan No.')
      : '—';
  const vendor = await readPair(page, 'Vendor');
  const openDc = await page.getByRole('link', { name: 'Open DC' }).count();
  const openNc = await page.getByRole('link', { name: 'Open NC' }).count();
  const openPo = await page.getByRole('link', { name: 'Open PO' }).count();
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
  return { code, hasPoPair, nc, dcNo, vendor, openDc, openNc, openPo, received };
}

/** NC detail: the Sent / Received tiles and the status badge text. */
async function readNcDetail(page: Page, ncUrl: string) {
  await page.goto(ncUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const tile = async (label: string): Promise<number> => {
    const cell = page
      .locator('.panel > *')
      .filter({ has: page.getByText(label, { exact: true }) })
      .first();
    return Number((await cell.locator('.mono.fw-700').first().innerText()).trim());
  };
  const status = (await page.locator('.panel-hdr .badge').first().innerText()).trim();
  return { sent: await tile('Sent'), received: await tile('Received'), status };
}

/** DC detail: status badge + the Receipts panel's count and received cells. */
async function readDcDetail(page: Page, dcId: string) {
  await page.goto('/delivery-challans/' + dcId, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .badge').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const status = (await page.locator('.panel-hdr .badge').first().innerText()).trim().toLowerCase();
  const panel = page.locator('.panel').filter({ has: page.getByText('Receipts', { exact: true }) }).first();
  const count = (await panel.count()) ? (await panel.locator('.panel-hdr').innerText()).replace(/\s+/g, ' ').trim() : '(no Receipts panel)';
  const cells = panel.locator('tbody tr td:nth-child(2)');
  const receipts: string[] = [];
  for (let i = 0; i < (await cells.count()); i += 1) receipts.push((await cells.nth(i).innerText()).trim());
  return { status, count, receipts };
}

/** JC detail: the NC breakup strip text of the op card that carries one. */
async function readJcNcStrip(page: Page, jcUrl: string): Promise<string> {
  await page.goto(jcUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(/⚠ NC/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  const strip = page.locator('div').filter({ has: page.getByText('⚠ NC', { exact: true }) }).last();
  return (await strip.innerText()).replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════════════════

test('0 - this is the test stack', async ({ page }) => {
  const api = await assertTestStack(page);
  writeState({ apiBase: api });
  log('API: ' + api);
});

test('C0 - build the NC chain: SO -> JC -> Turning 14 -> DIR QC 10 ok / 4 rej -> NC -> Return to vendor -> Create DC', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();

  // 1. Sales order, one line, qty 14.
  if (!s.soCode) {
    await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const client = page.getByPlaceholder(/Type customer code or name/i);
    await client.click();
    await client.fill('Adani');
    await page.locator('[role="option"], li').filter({ hasText: /Adani/ }).first().waitFor({ timeout: 45_000 });
    await page.locator('[role="option"], li').filter({ hasText: /Adani/ }).first().click();
    await page.getByPlaceholder(/Client PO reference/i).fill(`E2E_NC-GRN-${STAMP}`);
    const item = page.getByPlaceholder(/Search item code or name/i).first();
    await item.click();
    await item.fill(ITEM_CODE);
    await page.locator('[role="option"], li').filter({ hasText: ITEM_CODE }).first().waitFor({ timeout: 45_000 });
    await page.locator('[role="option"], li').filter({ hasText: ITEM_CODE }).first().click();
    await page.getByPlaceholder('Qty', { exact: true }).first().fill(String(ORDER_QTY));
    await page.getByPlaceholder('Rev', { exact: true }).first().fill('A');
    await page.getByPlaceholder('₹ Rate', { exact: true }).first().fill('10').catch(() => {});
    await page.getByRole('button', { name: /Save SO/i }).click();
    await page.waitForURL((u) => !/\/sales-orders\/new/.test(u.pathname), { timeout: 90_000 });
    await page.waitForTimeout(2500);
    const body = await page.locator('body').innerText();
    const m = /IN-SO-\d+/.exec(body);
    expect(m, 'SO code on page after save').toBeTruthy();
    s = writeState({ soCode: m![0] });
    log('C0: SO ' + s.soCode + ' (client PO ref E2E_NC-GRN-' + STAMP + ', qty ' + ORDER_QTY + ')');
  }

  // 2. Plan one process op (Turning) — the system appends the terminal DIR QC — and execute.
  if (!s.jcCode) {
    await page.goto('/planning', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByPlaceholder(/Search SO/i).fill(s.soCode!);
    await page.getByText(s.soCode!, { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.getByText(s.soCode!, { exact: true }).first().click();
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /\+ ?Plan/i }).first().click();
    await page.waitForTimeout(1300);
    const planQty = page.locator('.form-grp:has(label:has-text("Plan Qty")) input[type="number"]').first();
    await planQty.waitFor({ state: 'visible', timeout: 30_000 });
    await planQty.fill(String(ORDER_QTY));
    await page.getByRole('button', { name: /^Save Plan$/ }).click();
    await page.waitForTimeout(2500);
    const del = page.locator('table.ops-routing tbody tr button.btn-danger');
    for (let i = (await del.count()) - 1; i >= 0; i--) {
      await del.nth(i).click();
      await page.waitForTimeout(150);
    }
    await page.getByRole('button', { name: /\+ Add Op$/ }).click();
    await page.waitForTimeout(400);
    const row0 = page.locator('table.ops-routing tbody tr').nth(0);
    await row0.getByPlaceholder('Operation name').fill('Turning');
    await pickFirst(page, row0.getByPlaceholder('🔍 Machine', { exact: true }), 'cnc');
    await page.getByRole('button', { name: /Save Plan/i }).click();
    await page.getByRole('button', { name: /Save Plan/i }).waitFor({ state: 'hidden', timeout: 60_000 });
    const execBtn = page.getByRole('button', { name: /Create JC|Raise PR/ }).first();
    await execBtn.waitFor({ state: 'visible', timeout: 60_000 });
    await execBtn.click();
    await page.getByText(/IN-JC-\d{2}-\d+/).first().waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    const body = await page.locator('body').innerText();
    const jc = /IN-JC-\d{2}-\d+/.exec(body);
    expect(jc, 'JC code on page after execute').toBeTruthy();
    s = writeState({ jcCode: jc![0] });
    log('C0: JC ' + s.jcCode + ' raised from ' + s.soCode);
  }
  const JC = s.jcCode!;

  // 3. Run Turning (start, stop with 14) then DIR QC: 10 ok + 4 rejected.
  if (!s.ncCode) {
    await loadJc(page, JC);
    const ops = await page.locator('body').innerText();
    expect(ops, 'Turning listed').toMatch(/Turning/);
    expect(ops, 'DIR QC op appended').toMatch(/DIR/);

    const startBtn = opRow(page, 'Turning').getByRole('button', { name: /Start/ });
    if (await startBtn.count()) {
      await startBtn.click();
      await page.waitForTimeout(1200);
      await fillEntryHeader(page, 'E2E_ Operator');
      await page.getByRole('button', { name: /Start Operation/i }).click();
      await popupGone(page);
      await loadJc(page, JC);
    }
    const logBtn = opRow(page, 'Turning').getByRole('button', { name: /Log/ });
    if (await logBtn.count()) {
      await logBtn.click();
      await page.waitForTimeout(1200);
      await fillEntryHeader(page, 'E2E_ Operator');
      await page.locator('#opf-qty').fill(String(ORDER_QTY));
      await page.locator('#opf-rej').fill('0');
      await page.getByRole('button', { name: /^Stop/ }).click();
      await popupGone(page);
      await loadJc(page, JC);
    }
    log('C0: Turning started + stopped with ' + ORDER_QTY + ' made');

    await opRow(page, 'DIR').getByRole('button', { name: /Inspect/ }).click();
    await page.waitForTimeout(1200);
    await fillEntryHeader(page, 'E2E_ Inspector');
    await page.locator('#opf-qty').fill(String(QC_OK));
    await page.locator('#opf-rej').fill(String(QC_REJ));
    await page.getByRole('button', { name: /Submit Inspection/i }).click();
    await popupGone(page);

    await page.goto(`/nc-register?search=${JC}`, { waitUntil: 'domcontentloaded' });
    const ncPattern = new RegExp('NC-AUTO-' + JC + '-Op([0-9]+)-[0-9]+', 'i');
    const ncCell = page.getByText(ncPattern).first();
    await ncCell.waitFor({ timeout: 60_000 });
    const nc = ncPattern.exec(await ncCell.innerText());
    expect(nc, 'NC listed for ' + JC).toBeTruthy();
    s = writeState({ ncCode: nc![0], opSeq: Number(nc![1]) });
    log('C0: DIR QC ' + QC_OK + ' ok / ' + QC_REJ + ' rejected -> NC ' + s.ncCode + ' (op seq ' + s.opSeq + ')');
  }

  // 4. NC detail -> Dispose = Return to vendor for all 4.
  if (!s.ncUrl) {
    await page.goto(`/nc-register?search=${JC}`, { waitUntil: 'domcontentloaded' });
    const ncRow = page.getByText(s.ncCode!, { exact: false }).first();
    await ncRow.waitFor({ timeout: 60_000 });
    await ncRow.click();
    await expect(page).toHaveURL(/nc-register\/[0-9a-f-]{36}/, { timeout: 60_000 });
    const ncId = /nc-register\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    s = writeState({ ncUrl: page.url(), ncId });
    log('C0: NC detail ' + s.ncUrl);
  }
  if (!s.ncDisposed) {
    await page.goto(s.ncUrl!, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Dispose/ }).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: /Dispose/ }).click();
    await page.waitForTimeout(800);
    await page.locator('#dispAction').selectOption('return_to_vendor');
    await page.locator('#dispQty').fill(String(QC_REJ));
    await page.locator('#dispRemarks').fill('E2E_ GRN Against NC check (ADR-163) - return to vendor');
    await page.getByRole('button', { name: /^Save Disposition$/ }).click();
    await page.waitForTimeout(3000);
    await page.goto(s.ncUrl!, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.panel-hdr .badge').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const status = (await page.locator('.panel-hdr .badge').first().innerText()).trim();
    const body = await page.locator('body').innerText();
    expect(body, 'disposition shown as return to vendor').toMatch(/return to vendor/i);
    s = writeState({ ncDisposed: true });
    log('C0: NC ' + s.ncCode + ' disposed -> status "' + status + '"');
  }

  // 5. NC detail -> Create DC (vendor VND-959) -> record the challan.
  if (!s.dcId) {
    await page.goto(s.ncUrl!, { waitUntil: 'domcontentloaded' });
    await page.locator('#ncDcDate').waitFor({ timeout: 60_000 });
    await page.locator('#ncDcDate').fill(today());
    await pickFromCombo(page, 'ncDcVendor', VENDOR_CODE, new RegExp(VENDOR_CODE));
    await page.locator('#ncDcTransport').fill('E2E_ Shree Ganesh Roadlines');
    await page.locator('#ncDcRemarks').fill('E2E_ GRN Against NC check (ADR-163) - safe to cancel.');
    const create = page.getByRole('button', { name: /Create DC/ });
    await expect(create).toBeEnabled({ timeout: 30_000 });
    await create.click();
    const link = page.getByRole('link', { name: /IN-DC-\d+/ }).first();
    await link.waitFor({ timeout: 120_000 });
    const dcCode = (await link.innerText()).trim();
    const href = (await link.getAttribute('href')) ?? '';
    const dcId = /delivery-challans\/([0-9a-f-]{36})/.exec(href)?.[1];
    expect(dcId, 'DC link href carries the challan id: ' + href).toBeTruthy();
    s = writeState({ dcId, dcCode });
    log('C0: return challan ' + dcCode + ' (' + dcId + ') on ' + VENDOR_CODE);
  }

  // 6. The parent JC page URL (for the op-card strip later).
  if (!s.jcUrl) {
    await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.getByPlaceholder(/search/i).first().fill(JC);
    const jcRow = page.getByText(JC, { exact: true }).first();
    await jcRow.waitFor({ timeout: 60_000 });
    await jcRow.click();
    await expect(page).toHaveURL(/job-cards\/[0-9a-f-]{36}/, { timeout: 60_000 });
    s = writeState({ jcUrl: page.url() });
  }
  const before = await readNcDetail(page, s.ncUrl!);
  log('C0: NC before receipt: sent=' + before.sent + ' received=' + before.received + ' status="' + before.status + '"');
  expect(before.sent).toBe(QC_REJ);
  expect(before.status).toMatch(/Sent to vendor/i);
  log('CHAIN: ' + JSON.stringify(s));
});

test('C1 - GRN Type is one select with exactly 3 options; no "GRN No." on the create page for any type', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/goods-receipt-notes/new', { waitUntil: 'domcontentloaded' });
  const sel = page.locator('#grnInwardType');
  await expect(sel).toBeVisible({ timeout: 60_000 });
  expect(await sel.evaluate((el) => el.tagName)).toBe('SELECT');
  const opts = (await sel.locator('option').allInnerTexts()).map((t) => t.trim());
  log('C1: GRN Type options = ' + JSON.stringify(opts));
  expect(opts).toEqual(['Against PO', 'Against JWPO / DC', 'Against NC']);
  for (const t of ['Against PO', 'Against JWPO / DC'] as const) {
    expect(await page.getByRole('button', { name: t }).count(), 'no "' + t + '" button — it is a select now').toBe(0);
  }
  for (const type of ['purchase', 'job_work_return', 'nc_return'] as const) {
    await sel.selectOption(type);
    await page.waitForTimeout(1200);
    const text = await page.locator('.panel').first().innerText();
    expect(text, 'no "GRN No." on the ' + type + ' form').not.toMatch(/GRN No/i);
    expect(await page.locator('input[value^="IN-GRN-"]').count(), 'no pre-filled IN-GRN input').toBe(0);
    log('C1: type ' + type + ' -> no "GRN No." label, no IN-GRN- input');
  }
});

test('C2 - Against NC: the picker offers my NC (and no NC without a challan); picking it fills JC / challan / vendor / reason / the line', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  if (s.grnId) {
    test.skip(true, 'fresh-NC check already done before GRN ' + s.grnCode + ' was created (see C6 for the after-state)');
    return;
  }

  // Every NC that is NOT sent_to_vendor has no issued return challan and must not be offered.
  const token = await bearer(page);
  const headers = { authorization: 'Bearer ' + token };
  const res = await page.request.get(s.apiBase + '/nc-register?limit=200&offset=0', { headers });
  expect(res.status()).toBe(200);
  const ncList = (await res.json()) as { items: { code: string; status: string }[] };
  const notEligible = ncList.items.filter((n) => n.status !== 'sent_to_vendor').map((n) => n.code);
  const eligible = ncList.items.filter((n) => n.status === 'sent_to_vendor').map((n) => n.code);
  log('C2: NC register has ' + ncList.items.length + ' NC(s); sent_to_vendor = ' + JSON.stringify(eligible));

  await openNewGrn(page, 'nc_return');
  const form = page.locator('form');
  expect(await form.getByText(/Purchase Order|\bPO\b/).count(), 'no "Purchase Order" / "PO" label on the Against NC form').toBe(0);

  const opts = await comboOptions(page, 'ncId', '');
  log('C2: NC picker offers ' + opts.length + ': ' + JSON.stringify(opts));
  expect(opts.some((o) => o.includes(s.ncCode!)), 'my NC is offered').toBe(true);
  for (const code of notEligible) {
    expect(opts.some((o) => o.includes(code)), code + ' (no issued challan) must NOT be offered').toBe(false);
  }
  const mine = opts.find((o) => o.includes(s.ncCode!))!;
  expect(mine, 'hint "JC · vendor"').toContain(s.jcCode!);
  expect(mine).toMatch(VENDOR_NAME);

  await pickFromCombo(page, 'ncId', s.ncCode!, new RegExp(s.ncCode!));
  await expect(page.locator('#ncJobCard')).toHaveValue(s.jcCode!, { timeout: 30_000 });
  await expect(page.locator('#ncReturnChallan')).toHaveValue(s.dcCode!, { timeout: 30_000 });
  await expect(page.locator('#ncVendor')).toHaveValue(VENDOR_NAME, { timeout: 30_000 });
  for (const id of ['ncJobCard', 'ncReturnChallan', 'ncVendor']) {
    await expect(page.locator('#' + id)).toHaveAttribute('readonly', '');
  }
  const reason = await form.getByText(/^Return reason:/).count();
  const reasonText = reason ? (await form.getByText(/^Return reason:/).first().innerText()).trim() : '(none)';
  log('C2: Job Card="' + (await page.locator('#ncJobCard').inputValue()) + '" Return Challan="' + (await page.locator('#ncReturnChallan').inputValue()) + '" Vendor="' + (await page.locator('#ncVendor').inputValue()) + '" reason line: ' + reasonText);
  expect(reason, 'a "Return reason: …" line').toBe(1);

  await expect(page.getByLabel('Receive now, line 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  const lines = await readNcTabLines(page);
  const itemCell = (await page.locator('form table.innovic-table tbody tr').first().locator('td').nth(1).innerText()).trim();
  log('C2: lines [sent, soFar, balance, receiveNow] = ' + JSON.stringify(lines) + ' item "' + itemCell + '"');
  expect(lines).toEqual([[QC_REJ, 0, QC_REJ, QC_REJ]]);
  expect(itemCell).toContain(ITEM_CODE);
  expect(await form.getByText(/Purchase Order|\bPO\b/).count(), 'still no PO label after the pick').toBe(0);
});

test('C3 - Receive Now 5 is refused inline; 3 creates the GRN and lands on its detail (Open NC + Open DC, "NC <code>", received 3)', async ({ page }) => {
  test.setTimeout(300_000);
  let s = readState();
  if (s.grnId) {
    test.skip(true, 'GRN ' + s.grnCode + ' already created');
    return;
  }
  await openNewGrn(page, 'nc_return');
  await pickFromCombo(page, 'ncId', s.ncCode!, new RegExp(s.ncCode!));
  const line1 = page.getByLabel('Receive now, line 1', { exact: true });
  await expect(line1).toHaveValue(String(QC_REJ), { timeout: 30_000 });

  await line1.fill(String(QC_REJ + 1));
  await expect(page.getByText(`Cannot receive more than Pending (${QC_REJ}).`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Save GRN/ }).click();
  await page.waitForTimeout(3000);
  const native = await line1.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow);
  const summary = await page.getByText('Fix the highlighted quantities.').count();
  await expect(page).toHaveURL(/goods-receipt-notes\/new/);
  await expect(page.getByText(`Cannot receive more than Pending (${QC_REJ}).`, { exact: true })).toBeVisible();
  log('C3: ' + (QC_REJ + 1) + ' -> "Cannot exceed balance of ' + QC_REJ + '." shown; Create refused (still on /new; native max block=' + native + ', form summary shown=' + (summary > 0) + ')');

  await line1.fill(String(FIRST_RECEIVE));
  await page.locator('#ncRemarks').fill('E2E_ GRN against NC - partial (3 of 4)');
  await page.getByRole('button', { name: /Save GRN/ }).click();
  await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const grnId = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const d = await readGrnDetail(page, grnId);
  s = writeState({ grnId, grnCode: d.code });
  log('C3: GRN ' + d.code + ' (' + grnId + ') NC=' + d.nc + ' DC No.=' + d.dcNo + ' vendor=' + d.vendor + ' OpenNC=' + d.openNc + ' OpenDC=' + d.openDc + ' OpenPO=' + d.openPo + ' PO pair shown=' + d.hasPoPair + ' received=' + JSON.stringify(d.received));
  expect(d.code).toMatch(/^IN-GRN-\d{5}$/);
  expect(d.openNc, '"Open NC" button').toBe(1);
  expect(d.openDc, '"Open DC" button').toBe(1);
  expect(d.openPo, 'no "Open PO" button').toBe(0);
  expect(d.nc).toBe(s.ncCode);
  expect(d.hasPoPair, 'grid shows NC, not PO').toBe(false);
  expect(d.dcNo).toBe(s.dcCode);
  expect(d.vendor).toMatch(VENDOR_NAME);
  expect(d.received).toEqual([FIRST_RECEIVE]);
});

test('C4 - NC detail Sent 4 / Received 3 + Received – QC Pending; DC has 1 receipt of 3 and stays issued; JC op strip shows the split', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  const nc = await readNcDetail(page, s.ncUrl!);
  log('C4: NC ' + s.ncCode + ' sent=' + nc.sent + ' received=' + nc.received + ' status="' + nc.status + '"');
  expect(nc.sent).toBe(QC_REJ);
  expect(nc.received).toBe(FIRST_RECEIVE);
  expect(nc.status).toMatch(/Received – QC Pending/i);

  const dc = await readDcDetail(page, s.dcId!);
  log('C4: DC ' + s.dcCode + ' status=' + dc.status + ' receipts panel "' + dc.count + '" received cells ' + JSON.stringify(dc.receipts));
  expect(dc.status).toBe('issued');
  expect(dc.count).toContain('1 receipt');
  expect(dc.receipts).toEqual([FIRST_RECEIVE.toFixed(2)]);

  const strip = await readJcNcStrip(page, s.jcUrl!);
  log('C4: JC ' + s.jcCode + ' op strip: "' + strip + '"');
  expect(strip).toMatch(new RegExp('Sent to Vendor\\s*' + (QC_REJ - FIRST_RECEIVE) + '\\b'));
  expect(strip).toMatch(new RegExp('Received – QC Pending\\s*' + FIRST_RECEIVE + '\\b'));
});

test('C5 - GRN list: my GRN card carries the red "Against NC" badge and "NC <code>"; click expands the lines', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/goods-receipt-notes', { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder(/Search GRN no/);
  await search.waitFor({ timeout: 60_000 });
  await search.fill(s.grnCode!);
  await page.waitForTimeout(3000);
  const card = page.locator('.panel').filter({ has: page.getByRole('link', { name: s.grnCode!, exact: true }) }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const badge = card.locator('.badge', { hasText: 'Against NC' });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/b-red/);
  const cardText = (await card.innerText()).replace(/\s+/g, ' ');
  log('C5: ' + s.grnCode + ' card badges: ' + (await card.locator('.badge').allInnerTexts()).join(' | ') + ' | text: ' + cardText.slice(0, 300));
  expect(cardText).toContain('NC ' + s.ncCode);
  expect(cardText, 'no "Against DC" on an NC GRN').not.toContain('Against DC');
  await card.getByText(VENDOR_NAME).first().click();
  await expect(card.locator('table.innovic-table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  const expanded = (await card.locator('table.innovic-table tbody tr').first().innerText()).replace(/\s+/g, ' ');
  log('C5: expanded line: ' + expanded);
  expect(expanded).toContain(ITEM_CODE);
});

test('C6 - Against NC again: balance 1 / Receive Now 1; clearing the picker blanks JC / challan / vendor and the table; re-pick restores', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  await openNewGrn(page, 'nc_return');
  await pickFromCombo(page, 'ncId', s.ncCode!, new RegExp(s.ncCode!));
  await expect(page.getByLabel('Receive now, line 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  const lines = await readNcTabLines(page);
  log('C6: lines after re-pick = ' + JSON.stringify(lines));
  expect(lines).toEqual([[QC_REJ, FIRST_RECEIVE, QC_REJ - FIRST_RECEIVE, QC_REJ - FIRST_RECEIVE]]);

  const box = page.locator('#ncId');
  await box.click();
  await box.fill('');
  await closeCombo(page);
  await expect(page.getByText('Pick an NC to load its return challan.')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#ncJobCard')).toHaveValue('');
  await expect(page.locator('#ncReturnChallan')).toHaveValue('');
  await expect(page.locator('#ncVendor')).toHaveValue('');
  expect(await page.getByLabel(/Receive now, line/).count()).toBe(0);
  expect(await page.locator('form').getByText(/^Return reason:/).count()).toBe(0);
  log('C6: cleared -> "Pick an NC to load its return challan.", JC / challan / vendor blank, no reason line, 0 lines');

  await pickFromCombo(page, 'ncId', s.ncCode!, new RegExp(s.ncCode!));
  await expect(page.getByLabel('Receive now, line 1', { exact: true })).toHaveValue(String(QC_REJ - FIRST_RECEIVE), { timeout: 30_000 });
  await expect(page.locator('#ncReturnChallan')).toHaveValue(s.dcCode!);
  log('C6: re-picked -> Receive Now ' + (QC_REJ - FIRST_RECEIVE) + ' again; nothing saved');
});

test('C7 - server guard via API: receiving 2 against a balance of 1 -> 409, NC received still 3', async ({ page }) => {
  test.setTimeout(180_000);
  const s = readState();
  const token = await bearer(page);
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const api = s.apiBase!;

  const dcRes = await page.request.get(api + '/delivery-challans/' + s.dcId, { headers });
  expect(dcRes.status()).toBe(200);
  const dc = (await dcRes.json()) as { code: string; lines: { id: string; lineNo: number; qty: number | string }[] };
  const l1 = dc.lines[0]!;
  log('C7: DC ' + dc.code + ' line 1 id ' + l1.id + ' qty ' + l1.qty);

  const over = await page.request.post(api + '/delivery-challans/' + s.dcId + '/receive', {
    headers,
    data: {
      receiptDate: today(),
      vendorInvoiceText: null,
      remarks: 'E2E_ API guard probe - must be refused',
      lines: [{ deliveryChallanLineId: l1.id, receivedQty: 2 }],
    },
  });
  const body = await over.text();
  log('C7: over-receipt (2 vs balance 1) -> HTTP ' + over.status() + ' ' + body);
  expect(over.status()).toBe(409);
  expect(body).toMatch(/cannot be more than Sent Qty|cannot be more than Pending/i);

  const ncRes = await page.request.get(api + '/nc-register/' + s.ncId, { headers });
  expect(ncRes.status()).toBe(200);
  const nc = (await ncRes.json()) as { rtvSentQty: number | string; rtvReceivedQty: number | string; status: string };
  log('C7: NC after probe: rtvSent=' + nc.rtvSentQty + ' rtvReceived=' + nc.rtvReceivedQty + ' status=' + nc.status);
  expect(Number(nc.rtvReceivedQty)).toBe(FIRST_RECEIVE);
  expect(nc.status).toBe('received_qc_pending');
});

test('D8 - old Challan -> Receive page still works for an NC challan: receive the last 1 -> DC received, new "Against NC" GRN, NC received 4, NC drops out of the picker', async ({ page }) => {
  test.setTimeout(400_000);
  let s = readState();
  if (!s.grn2Id) {
    await page.goto('/delivery-challans/' + s.dcId, { waitUntil: 'domcontentloaded' });
    const receiveLink = page.getByRole('link', { name: /Receive/ }).first();
    await receiveLink.waitFor({ timeout: 60_000 });
    await receiveLink.click();
    await expect(page).toHaveURL(/delivery-challans\/[0-9a-f-]{36}\/receive/, { timeout: 60_000 });
    await page.locator('#receiptDate').waitFor({ timeout: 60_000 });
    const qty = page.locator('table.innovic-table input[type="number"]');
    await expect(qty).toHaveCount(1, { timeout: 60_000 });
    const tds = page.locator('table.innovic-table tbody tr').first().locator('td');
    const [sent, already, remaining] = await Promise.all([2, 3, 4].map(async (i) => (await tds.nth(i).innerText()).trim()));
    log('D8: receive page line: sent=' + sent + ' already=' + already + ' remaining=' + remaining);
    expect([sent, already, remaining]).toEqual([String(QC_REJ), String(FIRST_RECEIVE), String(QC_REJ - FIRST_RECEIVE)]);
    await qty.first().fill(String(QC_REJ - FIRST_RECEIVE));
    await page.locator('#remarks').fill('E2E_ GRN against NC - balance via old Receive page (1 of 4)');
    const submit = page.getByRole('button', { name: /Record receipt/ });
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();
    await expect(page).toHaveURL(/delivery-challans\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    log('D8: receipt recorded -> back on DC detail ' + page.url());

    // Find the GRN the receive raised: the newest GRN carrying my NC code.
    const token = await bearer(page);
    const headers = { authorization: 'Bearer ' + token };
    const res = await page.request.get(s.apiBase + '/goods-receipt-notes?limit=50&offset=0', { headers });
    expect(res.status()).toBe(200);
    const list = (await res.json()) as { items: { id: string; code: string; ncId: string | null; poCodeText: string | null; totalReceivedQty: number | string }[] };
    const mine = list.items.filter((g) => g.ncId === s.ncId && g.id !== s.grnId);
    log('D8: GRNs on my NC other than ' + s.grnCode + ': ' + JSON.stringify(mine.map((g) => g.code + ' recv ' + g.totalReceivedQty)));
    expect(mine).toHaveLength(1);
    s = writeState({ grn2Id: mine[0]!.id, grn2Code: mine[0]!.code });
  }

  const dc = await readDcDetail(page, s.dcId!);
  log('D8: DC ' + s.dcCode + ' status=' + dc.status + ' receipts "' + dc.count + '" cells ' + JSON.stringify(dc.receipts));
  expect(dc.status).toBe('received');
  expect(dc.count).toContain('2 receipts');

  const d = await readGrnDetail(page, s.grn2Id!);
  log('D8: GRN ' + d.code + ' NC=' + d.nc + ' DC No.=' + d.dcNo + ' OpenNC=' + d.openNc + ' OpenDC=' + d.openDc + ' received=' + JSON.stringify(d.received));
  expect(d.nc).toBe(s.ncCode);
  expect(d.received).toEqual([QC_REJ - FIRST_RECEIVE]);

  await page.goto('/goods-receipt-notes', { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder(/Search GRN no/);
  await search.waitFor({ timeout: 60_000 });
  await search.fill(s.grn2Code!);
  await page.waitForTimeout(3000);
  const card = page.locator('.panel').filter({ has: page.getByRole('link', { name: s.grn2Code!, exact: true }) }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator('.badge', { hasText: 'Against NC' })).toBeVisible();
  log('D8: ' + s.grn2Code + ' card badges: ' + (await card.locator('.badge').allInnerTexts()).join(' | '));

  const nc = await readNcDetail(page, s.ncUrl!);
  log('D8: NC ' + s.ncCode + ' sent=' + nc.sent + ' received=' + nc.received + ' status="' + nc.status + '"');
  expect(nc.received).toBe(QC_REJ);
  expect(nc.status).toMatch(/Received – QC Pending/i);

  await openNewGrn(page, 'nc_return');
  const opts = await comboOptions(page, 'ncId', '');
  log('D8: Against NC picker now offers: ' + JSON.stringify(opts));
  expect(opts.some((o) => o.includes(s.ncCode!)), 'fully-received NC no longer offered').toBe(false);
});

test('AB9 - Against JWPO / DC: challan picker enabled with no JWPO, long labels; DC pick fills the JWPO; changing the JWPO clears the DC (nothing saved)', async ({ page }) => {
  test.setTimeout(300_000);
  await openNewGrn(page, 'job_work_return');
  const dcBox = page.locator('#dcId');
  await expect(dcBox, 'DC picker enabled before any JWPO').toBeEnabled();
  const dcOpts = await comboOptions(page, 'dcId', '');
  log('AB9: DC picker (no JWPO) offers ' + dcOpts.length + ': ' + JSON.stringify(dcOpts));
  expect(dcOpts.length).toBeGreaterThan(0);
  // Long label: "IN-DC-code — JWPO · vendor · date"
  const longLabel = /^IN-DC-\d+(?:\/R\d+)? — IN-[A-Z]*PO-\d+(?:\/R\d+)? · .+ · \d{4}-\d{2}-\d{2}$/;
  for (const o of dcOpts) expect(o, 'long label form').toMatch(longLabel);

  // Prefer a challan that is not the standing fixture; fall back to IN-DC-00002 read-only.
  const pick = dcOpts.find((o) => !o.startsWith('IN-DC-00002')) ?? dcOpts[0]!;
  const dcCode = /^IN-DC-\d+(?:\/R\d+)?/.exec(pick)![0];
  const poCode = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(pick)![0];
  await pickFromCombo(page, 'dcId', dcCode, new RegExp(dcCode.replace('/', '\\/')));
  await expect(page.locator('#jwpoId')).toHaveValue(new RegExp(poCode.replace('/', '\\/')), { timeout: 30_000 });
  await expect(page.locator('#dcVendor')).not.toHaveValue('', { timeout: 30_000 });
  log('AB9: picked ' + dcCode + ' -> JWPO box = "' + (await page.locator('#jwpoId').inputValue()) + '", vendor = "' + (await page.locator('#dcVendor').inputValue()) + '"');

  // Change the JWPO: pick a different one if there is one, else clear it.
  const jwpoOpts = await comboOptions(page, 'jwpoId', '');
  const other = jwpoOpts.find((o) => !o.includes(poCode));
  const jwpoBox = page.locator('#jwpoId');
  if (other) {
    const otherCode = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(other)![0];
    await pickFromCombo(page, 'jwpoId', otherCode, new RegExp(otherCode.replace('/', '\\/')));
    log('AB9: JWPO changed to ' + otherCode);
  } else {
    await jwpoBox.click();
    await jwpoBox.fill('');
    await closeCombo(page);
    log('AB9: no second JWPO on the stack — JWPO cleared instead');
  }
  await expect(dcBox).toHaveValue('', { timeout: 30_000 });
  await expect(page.locator('#dcVendor')).toHaveValue('');
  expect(await page.getByLabel(/Receive now, line/).count()).toBe(0);
  log('AB9: challan box cleared, vendor blank, 0 lines. Nothing saved.');
});

test('AB10 - Against PO: row 1 is Date · Purchase Order · Vendor; row 2 Invoice · DC/Challan No · Remarks; no GRN No. box (nothing saved)', async ({ page }) => {
  test.setTimeout(300_000);
  await openNewGrn(page, 'purchase');
  const form = page.locator('form');
  const rows = form.locator('.form-grid-4');
  // innerText carries the CSS text-transform (labels render uppercase), so compare case-insensitively.
  const row1 = (await rows.nth(0).locator('label').allInnerTexts()).map((t) => t.replace(/★/g, '').trim().toLowerCase());
  const row2 = (await rows.nth(1).locator('label').allInnerTexts()).map((t) => t.replace(/★/g, '').trim().toLowerCase());
  log('AB10: row 1 labels = ' + JSON.stringify(row1) + '; row 2 labels = ' + JSON.stringify(row2));
  expect(row1).toEqual(['date', 'purchase order', 'vendor']);
  expect(row2).toEqual(['invoice no.', 'dc / challan no.', 'remarks']);
  expect(await page.locator('.panel').first().innerText()).not.toMatch(/GRN No/i);

  const poOpts = await comboOptions(page, 'purchaseOrderId', 'IN-');
  log('AB10: Purchase Order picker offers: ' + JSON.stringify(poOpts.slice(0, 10)));
  const want = poOpts.find((o) => o.includes('IN-MPO-00001/R1')) ?? poOpts[0];
  expect(want, 'an open buying PO to pick').toBeTruthy();
  const poCode = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(want!)![0];
  await pickFromCombo(page, 'purchaseOrderId', poCode, new RegExp(poCode.replace('/', '\\/')));
  await expect(page.locator('#vendor')).not.toHaveValue('', { timeout: 30_000 });
  await expect(page.locator('#vendor')).toHaveAttribute('readonly', '');
  const n = await page.getByLabel(/Receive now, line/).count();
  log('AB10: picked ' + poCode + ' -> vendor "' + (await page.locator('#vendor').inputValue()) + '" (read-only), ' + n + ' pending line(s). Nothing saved.');
  expect(n).toBeGreaterThan(0);
});

test('11 - Incoming QC lists both NC GRN lines as pending inspection (read-only)', async ({ page }) => {
  test.setTimeout(180_000);
  const s = readState();
  await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Pending Inspection/)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  const pendingTable = page.locator('table').filter({ has: page.getByText('QC Pending', { exact: true }) }).first();
  const rowsText = (await pendingTable.locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  const mine = rowsText.filter((t) => t.includes(s.grnCode!) || t.includes(s.grn2Code ?? '§'));
  log('11: pending rows for my GRNs (' + mine.length + '):\n   ' + mine.join('\n   '));
  expect(rowsText.filter((t) => t.includes(s.grnCode!)), s.grnCode + ' line pending').toHaveLength(1);
  expect(rowsText.filter((t) => t.includes(s.grn2Code!)), s.grn2Code + ' line pending').toHaveLength(1);
  log('STATE: ' + JSON.stringify(readState()));
});
