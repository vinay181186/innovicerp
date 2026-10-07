// ADR-219 — CASE 1: a FULL send with pieces waiting to go back.
// =============================================================================
// File name note: the owner asked for an `adr219-` prefix. `playwright.pages.
// config.ts` only runs `flow-*.spec.ts`, so the name carries BOTH — the
// `adr219-case1` part keeps it distinct from the other agent's Case 2 specs.
//
// TEST STACK ONLY — https://innovic-erp.pages.dev → api-test-…railway.app →
// Supabase INNOVICERP-TEST. Test 00 refuses to go on if the API host is not the
// test one, so this can never write to production.
//
// WHAT IS BEING PROVED
// Before ADR-219, "+ New DC → Against PO" dropped any order whose sent qty had
// reached its ordered qty. An order that had shipped everything but had pieces
// rejected and waiting to go back to the vendor vanished from the picker, so the
// one screen that could tell the storekeeper what to do had removed it.
//
// The end state built here, on a BRAND-NEW chain (nothing existing is touched):
//   ordered 10 · all 10 sent · all 10 received · 4 failed Incoming QC ·
//   deviation disposed "Return to Vendor" · no return challan raised yet
//   → fresh still owed = 0, waiting to go back = 4.
//
// Then six proofs, 20…25 below.
//
// EVERYTHING CREATED CARRIES `ZZ-A219B-`
// Document numbers are locked to IN-XX-NNNNN and cannot carry it, so the marker
// goes in the free-text fields: the item code itself, the item/route-card names,
// the client PO reference, the Internal SO No., the operation name, and every
// remark. See the report for which field makes each row findable.
//
// RUN (from apps/web/):
//   npx playwright test --config=playwright.pages.config.ts \
//     e2e/flow-adr219-case1.spec.ts --reporter=list
//
// Resumable: ids/codes go to a state file, so a re-run skips what is already
// built. Delete the state file to build a brand-new chain.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';
import { clickRowMenuItem, findRowWithMenuItem, planningLineRows } from './row-menu';

// ── where the run keeps its notes ───────────────────────────────────────────
const SCRATCH =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/eaee5197-470c-4742-9cfb-792cc8dc9ee7/scratchpad';
const STATE_FILE = SCRATCH + '/adr219-case1-state.json';
const SHOT_DIR = SCRATCH + '/adr219-case1-shots';
const PROOF_FILE = SCRATCH + '/adr219-case1-proofs.json';

// ── the chain's shape ───────────────────────────────────────────────────────
const TAG = 'ZZ-A219B-';
const QTY = 10; // ordered
const SENT = 10; // all of it goes out
const ACC = 6; // passes Incoming QC
const REJ = 4; // fails Incoming QC → the deviation → return to vendor
const VENDOR_CODE = 'VND-959'; // the standing E2E vendor (e2e/FIXTURES.md)
const CLIENT_SEARCH = 'Adani';

interface State {
  apiBase?: string;
  stamp?: string;
  itemId?: string;
  itemCode?: string;
  rcCode?: string;
  rcUrl?: string;
  soCode?: string;
  soUrl?: string;
  internalSoNo?: string;
  planCode?: string;
  proCode?: string;
  proUrl?: string;
  jcCode?: string;
  jcUrl?: string;
  jwpoId?: string;
  jwpoCode?: string;
  dcId?: string;
  dcCode?: string;
  grnId?: string;
  grnCode?: string;
  qcDone?: boolean;
  ncCode?: string;
  ncId?: string;
  ncUrl?: string;
  disposed?: boolean;
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
function log(m: string): void {
  // eslint-disable-next-line no-console
  console.log('   ' + m);
}
/** Record one proof's verdict + the actual on-screen value, for the report. */
function proof(id: string, title: string, ok: boolean, actual: string): void {
  const all: Record<string, { title: string; verdict: string; actual: string }> = existsSync(
    PROOF_FILE,
  )
    ? (JSON.parse(readFileSync(PROOF_FILE, 'utf8')) as Record<
        string,
        { title: string; verdict: string; actual: string }
      >)
    : {};
  all[id] = { title, verdict: ok ? 'PASS' : 'FAIL', actual };
  mkdirSync(dirname(PROOF_FILE), { recursive: true });
  writeFileSync(PROOF_FILE, JSON.stringify(all, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'}  ${id} — ${title}\n     ${actual}\n`);
}
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true }).catch(() => {});
}
const today = (): string => new Date().toISOString().slice(0, 10);
const nowHm = (): string => new Date().toTimeString().slice(0, 5);
const norm = async (page: Page): Promise<string> =>
  (await page.locator('body').innerText()).replace(/\s+/g, ' ');

// ── generic screen helpers (lifted from the proven flow-erp-chain-report) ────

/** Pick a row out of a SearchableSelect by its element id. */
async function pickCombo(page: Page, id: string, term: string, want: RegExp): Promise<void> {
  const box = page.locator('#' + id);
  await box.click();
  await box.fill(term);
  const opt = page.getByRole('option').filter({ hasText: want }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.waitForTimeout(400);
}
/** Pick the FIRST option a searchable box offers (used for RM Grade / Size). */
async function pickFirst(page: Page, box: Locator, term: string): Promise<string> {
  await box.click();
  await box.fill(term);
  const opt = page
    .locator('[role="option"]')
    .filter({ hasNotText: /Loading/i })
    .first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  const label = (await opt.innerText()).replace(/\s+/g, ' ').trim();
  await opt.click();
  await page.waitForTimeout(400);
  return label;
}
async function colIndex(table: Locator, header: RegExp): Promise<number> {
  const ths = table.locator('thead th');
  for (let i = 0; i < (await ths.count()); i += 1) {
    if (header.test((await ths.nth(i).innerText()).trim())) return i;
  }
  throw new Error('no column matching ' + header);
}

// ── the API, read with the browser's own bearer (reads only) ─────────────────
let cachedBearer: string | null = null;
async function bearer(page: Page): Promise<string> {
  if (cachedBearer) return cachedBearer;
  const state = await page.context().storageState();
  for (const origin of state.origins) {
    for (const item of origin.localStorage) {
      if (item.name.startsWith('sb-') && item.name.endsWith('-auth-token')) {
        const parsed = JSON.parse(item.value) as { access_token?: string };
        if (parsed.access_token) {
          cachedBearer = parsed.access_token;
          return cachedBearer;
        }
      }
    }
  }
  throw new Error('no Supabase session token in the storage state');
}
async function apiGet<T>(page: Page, path: string): Promise<T> {
  const s = readState();
  const res = await page.request.get(s.apiBase + path, {
    headers: { authorization: 'Bearer ' + (await bearer(page)) },
  });
  if (res.status() !== 200) {
    throw new Error(
      'GET ' + path + ' -> HTTP ' + res.status() + ' ' + (await res.text()).slice(0, 300),
    );
  }
  return (await res.json()) as T;
}

interface PoListItem {
  id: string;
  code: string;
  poType: string;
  status: string;
  totalQty: number;
  dcSentQty: number;
  rtvAwaitingChallanQty?: number;
  vendorName?: string | null;
}
interface NcApi {
  id: string;
  code: string;
  status: string;
  disposition: string | null;
  rejectedQty: number | string;
  rtvSentQty: number | string;
  poCode?: string | null;
  sourceDeliveryChallanCode?: string | null;
  deliveryChallanId?: string | null;
  purchaseOrderLineId?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 00 — the guard. Nothing below runs if this is not the TEST stack.
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-00 — guard: this is the TEST stack', async ({ page }) => {
  test.setTimeout(180_000);
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).origin));
  await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const api = [...hosts].find((h) => h.includes('railway.app'));
  expect(api, 'no API host seen at all').toBeTruthy();
  expect(api, 'REFUSING TO WRITE — the API host is ' + api).toContain('api-test-');
  expect(page.url(), 'the web host must be the pages.dev test site').toContain(
    'innovic-erp.pages.dev',
  );
  const s = readState();
  writeState({ apiBase: api!, stamp: s.stamp ?? new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '') });
  log(`web ${page.url()} · api ${api}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 — the item and its Route Card. The Route Card is the ONLY author of
//      operations now (ADR-170/204/218), so an OUTSOURCE op has to come from
//      one. A brand-new item keeps this chain out of every existing master.
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-10 — build: item + Route Card with ONE outsource op', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();
  const stamp = s.stamp!;

  if (!s.itemCode) {
    const code = `${TAG}P${stamp}`.slice(0, 40);
    await page.goto('/items/new', { waitUntil: 'domcontentloaded' });
    await page.locator('#code').waitFor({ timeout: 60_000 });
    await page.locator('#code').fill(code);
    await page.locator('#name').fill(`${TAG}ADR-219 Case 1 test part`);
    await page.locator('#description').fill(`${TAG}created by the ADR-219 Case 1 e2e run — safe to delete`);
    await page.locator('#material').fill(`${TAG}EN24`);
    await page.locator('#uom').selectOption('NOS');
    await page.locator('#itemType').selectOption('component');
    await page.locator('#procurementType').selectOption('make');
    await page.getByRole('button', { name: /Save Item/i }).click();
    await page.waitForURL((u) => !/items\/new/.test(u.pathname), { timeout: 90_000 });
    await page.waitForTimeout(2500);
    const id = /items\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    s = writeState({ itemCode: code, ...(id ? { itemId: id } : {}) });
    log('item created: ' + code + ' (' + page.url() + ')');
  }
  expect(s.itemCode, 'the test item exists').toBeTruthy();

  if (!s.rcCode) {
    await page.goto('/route-cards/new', { waitUntil: 'domcontentloaded' });
    await page.locator('#rc-item').waitFor({ timeout: 60_000 });
    await pickCombo(page, 'rc-item', s.itemCode!, new RegExp(s.itemCode!.replace(/[-.]/g, '\\$&')));
    await page.waitForTimeout(1200);

    // RM Grade + RM Size are REQUIRED downstream: Create Production Order
    // refuses a plan with no raw material ("This plan has no raw material —
    // fill RM Grade and RM Size on the item's Route Card"), and the plan reads
    // both off this card (ADR-218). Master-only pickers, so take what is there.
    const grade = await pickFirst(page, page.locator('#rc-rm-grade'), 'a');
    const size = await pickFirst(page, page.locator('#rc-rm-size'), '');
    log(`route card RM: grade "${grade}" · size "${size}"`);

    await page.locator('#rc-remarks').fill(`${TAG}ADR-219 Case 1 route card — safe to cancel`);

    // ONE outsourced operation, on the standing E2E vendor.
    await page.getByRole('button', { name: /\+ Outsourced op/ }).click();
    await page.waitForTimeout(600);
    const opRow = page.locator('table tbody tr').filter({ hasText: /OSP/ }).first();
    await opRow.getByPlaceholder('Coating / Painting / HT…').fill(`${TAG}HEAT TREATMENT`);
    await pickFirst(page, page.locator('#rc-vend-0'), VENDOR_CODE);
    await page.waitForTimeout(600);
    await shot(page, '10-route-card-form');

    const save = page.getByRole('button', { name: /^Save Route Card$/ }).last();
    await expect(save, 'Save on the Route Card form').toBeEnabled({ timeout: 30_000 });
    await save.click();
    await page.waitForURL((u) => !/route-cards\/new/.test(u.pathname), { timeout: 120_000 });
    await page.waitForTimeout(3000);
    const body = await norm(page);
    const rc = /IN-RC-\d+/.exec(body)?.[0] ?? '';
    expect(rc, 'Route Card code after save, page said: ' + body.slice(0, 300)).toMatch(/IN-RC-\d+/);
    s = writeState({ rcCode: rc, rcUrl: page.url() });
    log('route card created: ' + rc);
  }
  expect(s.rcCode).toMatch(/IN-RC-\d+/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 — SO 10 → plan → Production Order → Job Card
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-11 — build: SO 10 → Plan → Production Order → Job Card', async ({ page }) => {
  test.setTimeout(1_500_000);
  let s = readState();
  const stamp = s.stamp!;

  // ── Sales Order ──
  if (!s.soCode) {
    const internal = `SO-${TAG}${stamp}`.slice(0, 30);
    await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const client = page.getByPlaceholder(/Type customer code or name/i);
    await client.click();
    await client.fill(CLIENT_SEARCH);
    const copt = page.locator('[role="option"], li').filter({ hasText: new RegExp(CLIENT_SEARCH) }).first();
    await copt.waitFor({ timeout: 45_000 });
    await copt.click();
    await page.getByPlaceholder(/Client PO reference/i).fill(`${TAG}CPO-${stamp}`);
    const item = page.getByPlaceholder(/Search item code or name/i).first();
    await item.click();
    await item.fill(s.itemCode!);
    const iopt = page.locator('[role="option"], li').filter({ hasText: s.itemCode! }).first();
    await iopt.waitFor({ timeout: 45_000 });
    await iopt.click();
    await page.getByPlaceholder('Qty', { exact: true }).first().fill(String(QTY));
    await page.getByPlaceholder('Rev', { exact: true }).first().fill('A').catch(() => {});
    await page.getByPlaceholder('₹ Rate', { exact: true }).first().fill('10').catch(() => {});
    await page.locator('#internalSoNo').fill(internal);
    await page.waitForTimeout(500);
    await shot(page, '11a-so-form');
    await page.getByRole('button', { name: /Save SO/i }).click();
    await page.waitForURL((u) => !/sales-orders\/new/.test(u.pathname), { timeout: 120_000 });
    await page.waitForTimeout(3000);
    const code = /IN-SO-\d+/.exec(await norm(page))?.[0] ?? '';
    expect(code, 'SO code after save').toMatch(/IN-SO-\d+/);
    s = writeState({ soCode: code, soUrl: page.url(), internalSoNo: internal });
    log('SO created: ' + code + ' (internal ' + internal + ')');
  }

  // ── Plan ──
  if (!s.planCode) {
    await page.goto('/planning', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.getByPlaceholder(/Search SO/i).fill(s.soCode!);
    await page.getByText(s.soCode!, { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.getByText(s.soCode!, { exact: true }).first().click();
    await page.waitForTimeout(2500);
    const rows = planningLineRows(page);
    await rows.first().waitFor({ state: 'visible', timeout: 60_000 });
    const row = await findRowWithMenuItem(page, rows, /^Plan \d/);
    expect(row, 'a Planning line offering "Plan N" in its ⋯').toBeTruthy();
    await clickRowMenuItem(page, row!, /^Plan \d/);
    await page.locator('#create-plan-qty').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('#create-plan-qty').fill(String(QTY));
    await page.locator('#create-plan-remark').fill(`${TAG}ADR-219 Case 1 plan`).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, '11b-create-plan');
    await page.getByRole('button', { name: /^Save Plan$/ }).click();
    await page.waitForTimeout(6000);
    const planCode = /PLN-\d+/.exec(await norm(page))?.[0] ?? '';
    expect(planCode, 'plan code after Save Plan').toMatch(/PLN-\d+/);
    s = writeState({ planCode });
    log('plan created: ' + planCode);
  }

  // ── Production Order (+ the Job Card it creates) ──
  if (!s.proCode) {
    await page.goto('/production-orders/new', { waitUntil: 'domcontentloaded' });
    await page.locator('#po-plan').waitFor({ timeout: 60_000 });
    await pickCombo(page, 'po-plan', s.planCode!, new RegExp(s.planCode!));
    await page.waitForTimeout(3000);
    // The Route Card select enables once the plan is picked; one card for a
    // brand-new item, so take the first real option.
    const rcSel = page.locator('#po-route-card');
    await expect(rcSel).toBeEnabled({ timeout: 60_000 });
    const values = await rcSel
      .locator('option')
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
    expect(values.length, 'a Route Card is offered for this plan').toBeGreaterThan(0);
    await rcSel.selectOption(values[0]!);
    await page.waitForTimeout(1500);
    await page.locator('#po-order-qty').fill(String(QTY));
    await page.locator('#po-target-date').fill(today());
    await page.locator('#po-remarks').fill(`${TAG}ADR-219 Case 1 production order`).catch(() => {});
    const rm = page.locator('#po-rm-available');
    if (!(await rm.isChecked())) await rm.check();
    await page.waitForTimeout(600);
    await shot(page, '11c-production-order');
    const save = page.getByRole('button', { name: /Save Production Order & Create JC/i });
    await expect(save, 'Save on the PRO form (tooltip says why if off)').toBeEnabled({
      timeout: 30_000,
    });
    await save.click();
    await page.waitForURL(/production-orders\/[0-9a-f-]{36}/, { timeout: 180_000 });
    await page.waitForTimeout(5000);
    const body = await norm(page);
    const pro = /IN-PRO-\d+/.exec(body)?.[0] ?? /PRO-\d+/.exec(body)?.[0] ?? '';
    s = writeState({ proCode: pro, proUrl: page.url() });
    log('production order created: ' + pro);
  }

  // ── the Job Card it raised ──
  if (!s.jcCode) {
    await page.goto(s.proUrl!, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const jc = /IN-JC-\d{2}-\d+/.exec(await norm(page))?.[0] ?? '';
    expect(jc, 'the Production Order names its Job Card').toMatch(/IN-JC-\d{2}-\d+/);
    s = writeState({ jcCode: jc });
    log('job card: ' + jc);
  }
  if (!s.jcUrl) {
    await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByPlaceholder(/Search JC no\./i).first().fill(s.jcCode!);
    await page.waitForTimeout(2500);
    const cell = page.getByText(s.jcCode!, { exact: true }).first();
    await cell.waitFor({ timeout: 60_000 });
    await cell.click();
    await expect(page).toHaveURL(/job-cards\/[0-9a-f-]{36}/, { timeout: 60_000 });
    s = writeState({ jcUrl: page.url() });
  }

  // The op really is an OUTSOURCE op, on our vendor — otherwise the rest of the
  // chain is meaningless.
  const ops = await apiGet<{ opSeq: number; operation: string; opType: string }[]>(
    page,
    '/op-entry/jc-ops?jobCardCode=' + encodeURIComponent(s.jcCode!),
  );
  log('ops: ' + ops.map((o) => `Op${o.opSeq} ${o.operation} [${o.opType}]`).join(' ;; '));
  expect(ops.length, 'exactly one operation on the job card').toBe(1);
  expect(ops[0]!.opType, 'the operation is an outsource op').toBe('outsource');
});

// ═══════════════════════════════════════════════════════════════════════════
// 12 — job-work PO → outward DC for ALL 10 → GRN for all 10
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-12 — build: JW PO → outward DC (all 10) → GRN 10', async ({ page }) => {
  test.setTimeout(1_500_000);
  let s = readState();

  // ── the job-work PO, from the op card's own "Gen PO" ──
  if (!s.jwpoCode) {
    await page.goto(s.jcUrl!, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const gen = page.getByRole('link', { name: /Gen PO/ }).first();
    await expect(gen, 'the op card offers "Gen PO"').toBeVisible({ timeout: 90_000 });
    await gen.click();
    await expect(page).toHaveURL(/purchase-orders\/from-pr\?prId=/, { timeout: 90_000 });
    await page.locator('#pof-code').waitFor({ timeout: 60_000 });
    await expect(page.locator('#pof-code')).not.toHaveValue('', { timeout: 60_000 });
    await expect(page.getByLabel('Item Code, line 1', { exact: true })).not.toHaveValue('', {
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
    const vbox = await page.locator('#pof-vendor').inputValue();
    if (!vbox.includes(VENDOR_CODE)) {
      await pickCombo(page, 'pof-vendor', VENDOR_CODE, new RegExp(VENDOR_CODE));
    }
    await page.locator('#pof-delivery-days').fill('14');
    const rate = page.getByLabel('Rate, line 1', { exact: true });
    if (!(await rate.inputValue()) || Number(await rate.inputValue()) === 0) await rate.fill('50');
    await page.locator('#pof-remarks').fill(`${TAG}ADR-219 Case 1 job-work PO — safe to cancel`);
    await shot(page, '12a-jwpo-form');
    const save = page.locator('button.pof-btn-go');
    const foot = await page.locator('.pof-foot-msg, .pof-foot-hint').first().innerText().catch(() => '');
    await expect(save, 'Save on the PO form; footer says: ' + foot).toBeEnabled({ timeout: 30_000 });
    await save.click();
    await expect(page).toHaveURL(/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 180_000 });
    const id = /purchase-orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    await page.waitForTimeout(5000);
    const code = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(await norm(page))?.[0] ?? '';
    expect(code, 'job-work PO code').toMatch(/IN-[A-Z]*PO-\d+/);
    s = writeState({ jwpoId: id, jwpoCode: code });
    log('job-work PO created: ' + code);

    // Approve it — material cannot leave against a draft order.
    const badge = page.locator('.panel-hdr .badge').first();
    await expect(badge).toBeVisible({ timeout: 60_000 });
    if ((await badge.innerText()).trim().toLowerCase() === 'draft') {
      await page.getByRole('button', { name: /^Approve$/ }).click();
      await page.getByRole('button', { name: 'Approve PO' }).click();
      await expect(page.locator('.panel-hdr .badge').first()).toHaveText(/open/i, {
        timeout: 90_000,
      });
    }
    log('job-work PO status: ' + (await page.locator('.panel-hdr .badge').first().innerText()).trim());
  }

  // ── the outward challan: ALL TEN pieces, so the order owes nothing fresh ──
  if (!s.dcCode) {
    await page.goto(s.jcUrl!, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const genDc = page.getByRole('link', { name: /Gen DC/ }).first();
    await expect(genDc, 'the op card offers "Gen DC"').toBeVisible({ timeout: 90_000 });
    log('op card offers: "' + (await genDc.innerText()).trim() + '"');
    await genDc.click();
    await expect(page).toHaveURL(/delivery-challans\/new\?poId=/, { timeout: 90_000 });
    await page.locator('#dc-code').waitFor({ timeout: 60_000 });
    await expect(page.locator('#dc-code')).not.toHaveValue('', { timeout: 60_000 });
    await page.locator('#dc-transport').fill(`${TAG}Shree Ganesh Roadlines`);
    await page.locator('#dc-vehicle-no').fill('GJ-23-ZZ-0219');
    const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
    await expect(qtyBoxes).toHaveCount(1, { timeout: 60_000 });
    await qtyBoxes.first().fill(String(SENT));
    const materials = page.locator('table.innovic-table input.innovic-input:not([type])');
    if (await materials.count()) await materials.first().fill(`${TAG}EN24`);
    await shot(page, '12b-outward-dc');
    const save = page.getByRole('button', { name: /Save DC/ });
    await expect(save).toBeEnabled({ timeout: 60_000 });
    await save.click();
    await expect(page).toHaveURL(/delivery-challans\/[0-9a-f-]{36}$/, { timeout: 180_000 });
    const id = /delivery-challans\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    await page.waitForTimeout(4000);
    const code = /IN-DC-\d+(?:\/R\d+)?/.exec(await norm(page))?.[0] ?? '';
    expect(code, 'outward DC code').toMatch(/IN-DC-\d+/);
    s = writeState({ dcId: id, dcCode: code });
    log('outward DC created: ' + code + ' for ' + SENT + ' pcs');
  }

  // ── the GRN: all ten back in ──
  if (!s.grnCode) {
    await page.goto('/goods-receipt-notes/new', { waitUntil: 'domcontentloaded' });
    const type = page.locator('#grnInwardType');
    await expect(type).toBeVisible({ timeout: 60_000 });
    await type.selectOption('job_work_return');
    await expect(page.locator('#jwpoId')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    await pickCombo(page, 'jwpoId', s.jwpoCode!, new RegExp(s.jwpoCode!.replace('/', '\\/')));
    await pickCombo(page, 'dcId', s.dcCode!, new RegExp(s.dcCode!.replace('/', '\\/')));
    const line1 = page.getByLabel('Receive now, line 1', { exact: true });
    await expect(line1).toHaveValue(String(SENT), { timeout: 60_000 });
    await page.locator('#dcRemarks').fill(`${TAG}ADR-219 Case 1 OSP return, ${SENT} of ${SENT}`);
    await shot(page, '12c-grn');
    await page.getByRole('button', { name: /Save GRN/ }).click();
    await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 180_000 });
    const id = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    await page.waitForTimeout(4000);
    const code = /IN-GRN-\d+/.exec(await norm(page))?.[0] ?? '';
    expect(code, 'GRN code').toMatch(/IN-GRN-\d+/);
    s = writeState({ grnId: id, grnCode: code });
    log('GRN created: ' + code);
  }

  // The order has now sent everything it ordered — the precondition the whole
  // case rests on.
  const po = (await apiGet<{ items: PoListItem[] }>(page, '/purchase-orders?limit=200&offset=0'))
    .items.find((p) => p.code === s.jwpoCode);
  expect(po, 'the job-work PO is in the list the picker reads').toBeTruthy();
  log(
    `${po!.code}: type=${po!.poType} status=${po!.status} sent ${po!.dcSentQty}/${po!.totalQty} ` +
      `returnChallanPending=${po!.rtvAwaitingChallanQty ?? 0}`,
  );
  expect(po!.dcSentQty, 'all ordered pieces have been sent').toBeGreaterThanOrEqual(po!.totalQty);
});

// ═══════════════════════════════════════════════════════════════════════════
// 13 — Incoming QC 6 / 4 → the deviation → "Return to Vendor" for 4
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-13 — build: Incoming QC 6 ok / 4 failed → deviation → Return to Vendor 4', async ({
  page,
}) => {
  test.setTimeout(1_500_000);
  let s = readState();

  if (!s.qcDone) {
    await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Pending Inspection/)).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(3000);
    const pending = page
      .locator('table')
      .filter({ has: page.getByText('QC Pending', { exact: true }) })
      .first();
    const row = pending.locator('tbody tr').filter({ hasText: s.grnCode! }).first();
    await expect(row, 'a pending Incoming QC row for ' + s.grnCode).toBeVisible({ timeout: 90_000 });
    await clickRowMenuItem(page, row, /^Inspect/);
    await expect(page).toHaveURL(/qc-call-register\?line=/, { timeout: 90_000 });
    await page.waitForTimeout(4000);
    const header = page.getByText(new RegExp('Incoming QC — ' + s.grnCode!));
    await expect(header, 'the inline Inspect form for ' + s.grnCode).toBeVisible({
      timeout: 90_000,
    });
    const qcBy = page.getByPlaceholder(/Select QC person/);
    if (!(await qcBy.inputValue()).trim()) {
      await qcBy.click();
      const opt = page.locator('[role="option"]').filter({ hasNotText: /Loading/i }).first();
      await opt.waitFor({ state: 'visible', timeout: 45_000 });
      await opt.click();
      await page.waitForTimeout(400);
    }
    await page.locator('.form-grp').filter({ hasText: /Accept Qty/ }).locator('input').fill(String(ACC));
    await page.locator('.form-grp').filter({ hasText: /Reject Qty/ }).locator('input').fill(String(REJ));
    await page.getByPlaceholder(/Observations/).fill(`${TAG}ADR-219 Case 1 — ${REJ} fail, to go back`);
    await shot(page, '13a-incoming-qc');
    await page.getByRole('button', { name: /Submit Inspection/i }).click();
    await page.waitForTimeout(2500);
    const alerts = page.getByRole('alert');
    if (await alerts.count()) {
      const t = (await alerts.first().innerText().catch(() => '')).trim();
      if (t) throw new Error('Incoming QC refused: ' + t);
    }
    await expect(header).toBeHidden({ timeout: 180_000 });
    await page.waitForTimeout(2000);
    s = writeState({ qcDone: true });
    log(`incoming QC done: accepted ${ACC}, failed ${REJ}`);
  }

  // ── the deviation the reject raised ──
  if (!s.ncCode) {
    await page.goto(`/nc-register?search=${s.jcCode}`, { waitUntil: 'domcontentloaded' });
    const pat = new RegExp('NC-AUTO-' + s.jcCode!.replace(/-/g, '\\-') + '-Op([0-9]+)-[0-9]+', 'i');
    const cell = page.getByText(pat).first();
    await cell.waitFor({ timeout: 120_000 });
    const code = pat.exec(await cell.innerText())![0];
    s = writeState({ ncCode: code });
    log('deviation raised: ' + code);
  }
  if (!s.ncUrl) {
    await page.goto(`/nc-register?search=${s.ncCode}`, { waitUntil: 'domcontentloaded' });
    const cell = page.getByText(s.ncCode!, { exact: false }).first();
    await cell.waitFor({ timeout: 90_000 });
    await cell.click();
    await expect(page).toHaveURL(/nc-register\/[0-9a-f-]{36}/, { timeout: 90_000 });
    s = writeState({
      ncUrl: page.url(),
      ncId: /nc-register\/([0-9a-f-]{36})/.exec(page.url())![1]!,
    });
  }

  // ── QC decides: Return to Vendor, all 4. No challan raised — that is the
  //    state the six proofs need. ──
  if (!s.disposed) {
    await page.goto(s.ncUrl!, { waitUntil: 'domcontentloaded' });
    const dispose = page.getByRole('button', { name: /Dispose/ });
    await dispose.waitFor({ timeout: 90_000 });
    await dispose.click();
    await page.waitForTimeout(1200);
    const offered = (await page.locator('#dispAction option').allInnerTexts())
      .map((t) => t.trim())
      .filter(Boolean);
    log('Dispose offers: [' + offered.join(', ') + ']');
    await page.locator('#dispAction').selectOption('return_to_vendor');
    await page.locator('#dispQty').fill(String(REJ));
    await page.locator('#dispRemarks').fill(`${TAG}ADR-219 Case 1 — send ${REJ} back to the vendor`);
    await shot(page, '13b-dispose');
    await page.getByRole('button', { name: /^Save Disposition$/ }).click();
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(3000);
      if (!(await page.locator('#dispAction').count())) break;
    }
    await page.waitForTimeout(2000);
    s = writeState({ disposed: true });
  }

  const nc = await apiGet<NcApi>(page, '/nc-register/' + s.ncId);
  log(
    `${nc.code}: status=${nc.status} disposition=${nc.disposition} rejected=${Number(nc.rejectedQty)} ` +
      `rtvSent=${Number(nc.rtvSentQty)} challan=${nc.deliveryChallanId ?? 'none'} ` +
      `poCode=${nc.poCode ?? '—'} sentOnDc=${nc.sourceDeliveryChallanCode ?? '—'}`,
  );
  expect(nc.disposition, 'the deviation is decided "return to vendor"').toBe('return_to_vendor');
  expect(nc.status, 'the deviation is disposed').toBe('disposed');
  expect(Number(nc.rejectedQty), 'the deviation is for ' + REJ + ' pcs').toBe(REJ);
  expect(nc.deliveryChallanId, 'no return challan has been raised yet').toBeFalsy();

  // And the picker's own figures, at header grain.
  const po = (await apiGet<{ items: PoListItem[] }>(page, '/purchase-orders?limit=200&offset=0'))
    .items.find((p) => p.code === s.jwpoCode)!;
  log(
    `END STATE ${po.code}: sent ${po.dcSentQty}/${po.totalQty} · ` +
      `Return Challan Pending ${po.rtvAwaitingChallanQty ?? 0}`,
  );
  expect(po.dcSentQty, 'fresh still owed = 0 (everything sent)').toBe(po.totalQty);
  expect(po.rtvAwaitingChallanQty ?? 0, 'waiting to go back = ' + REJ).toBe(REJ);
});

// ═══════════════════════════════════════════════════════════════════════════
// PROOF 1 — the headline. The order is STILL in the +New DC picker.
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-20 — PROOF 1: fully-sent order with pieces waiting is STILL listed, marked, Return Challan Pending = 4', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const s = readState();
  await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dc-source')).toBeVisible({ timeout: 90_000 });
  expect(await page.locator('#dc-source').inputValue(), 'Against PO is the default source').toBe('po');
  await page.locator('#dc-po-search').fill(s.jwpoCode!);
  await page.waitForTimeout(2500);

  const table = page.locator('table.innovic-table').first();
  const row = table.locator('tbody tr').filter({ hasText: s.jwpoCode! }).first();
  const listed = (await row.count()) > 0 && (await row.isVisible());
  await shot(page, '20-picker-row');

  let rowClass = '';
  let sentCell = '';
  let pendingCell = '';
  let noteShown = false;
  let headerPresent = false;
  if (listed) {
    rowClass = (await row.getAttribute('class')) ?? '';
    const iSent = await colIndex(table, /^Sent \/ Order Qty$/i);
    const iPend = await colIndex(table, /^Return Challan Pending$/i);
    headerPresent = true;
    sentCell = (await row.locator('td').nth(iSent).innerText()).replace(/\s+/g, ' ').trim();
    pendingCell = (await row.locator('td').nth(iPend).innerText()).trim();
    noteShown = /Marked orders have deviated pieces waiting to go back to the vendor/i.test(
      await norm(page),
    );
  }

  const actual = listed
    ? `row for ${s.jwpoCode} IS listed; row class "${rowClass}"; ` +
      `"Return Challan Pending" column present=${headerPresent}, cell="${pendingCell}"; ` +
      `"Sent / Order Qty" cell="${sentCell}"; note above the table shown=${noteShown}`
    : `row for ${s.jwpoCode} is NOT in the picker — the defect ADR-219 set out to fix`;
  const ok =
    listed && rowClass.includes('row-pending') && pendingCell === String(REJ) && sentCell === `${SENT} / ${QTY}`;
  proof('PROOF 1', 'the order is still in the picker, marked, Return Challan Pending = 4', ok, actual);

  expect(listed, 'the fully-sent order with pieces waiting is listed').toBeTruthy();
  expect(headerPresent, 'the picker has a "Return Challan Pending" column').toBeTruthy();
  expect(sentCell, 'Sent / Order Qty').toBe(`${SENT} / ${QTY}`);
  expect(pendingCell, 'Return Challan Pending').toBe(String(REJ));
  expect(rowClass, 'the row is given the orange wash (row-pending)').toContain('row-pending');
  expect(noteShown, 'the note explaining the marked rows is shown').toBeTruthy();
});

// ═══════════════════════════════════════════════════════════════════════════
// PROOF 2 — it offers nothing fresh. The 4 waiting pieces were NOT added to
//           the fresh cap.
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-21 — PROOF 2: Can Send Now = 0 — the waiting pieces are not offered as fresh', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const s = readState();
  await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-po-search').waitFor({ timeout: 90_000 });
  await page.locator('#dc-po-search').fill(s.jwpoCode!);
  await page.waitForTimeout(2500);
  const row = page.locator('tbody tr').filter({ hasText: s.jwpoCode! }).first();
  await row.getByRole('button', { name: 'Select' }).click();
  await page.locator('#dc-code').waitFor({ timeout: 90_000 });
  await page.waitForTimeout(4000);
  await shot(page, '21-send-now');

  const qtyBox = page.locator('table.innovic-table input[type="number"]').first();
  await expect(qtyBox).toBeVisible({ timeout: 60_000 });
  const maxAttr = await qtyBox.getAttribute('max');
  // The caption under the box: "Can send now: N", or "✓ Fully sent" once the
  // line has shipped everything. It is the input's own cell.
  const caption = (
    await qtyBox
      .locator('xpath=ancestor::td[1]')
      .innerText()
      .catch(() => '')
  )
    .replace(/\s+/g, ' ')
    .trim();
  const sendable = await apiGet<{
    lines: { maxSendNow: number; limitKind?: string; limitReason?: string }[];
  }>(page, '/delivery-challans/sendable/' + s.jwpoId).catch((e) => {
    log('sendable read failed: ' + (e as Error).message);
    return null;
  });

  const ok = maxAttr === '0';
  proof(
    'PROOF 2',
    'Can Send Now = 0 — the 4 waiting pieces are not in the fresh cap',
    ok,
    `Send Now box max="${maxAttr}"; caption under it: "${caption}"; ` +
      `api sendable: ${sendable ? JSON.stringify(sendable.lines) : '(not read)'}`,
  );
  expect(maxAttr, 'the Send Now box allows 0 fresh pieces').toBe('0');
});

// ═══════════════════════════════════════════════════════════════════════════
// PROOF 3 — the warning states the total and names the route.
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-22 — PROOF 3: the orange panel states 4 pcs and sends the user to Against NC', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const s = readState();
  await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-po-search').waitFor({ timeout: 90_000 });
  await page.locator('#dc-po-search').fill(s.jwpoCode!);
  await page.waitForTimeout(2500);
  await page
    .locator('tbody tr')
    .filter({ hasText: s.jwpoCode! })
    .first()
    .getByRole('button', { name: 'Select' })
    .click();
  await page.locator('#dc-code').waitFor({ timeout: 90_000 });
  await page.waitForTimeout(6000);
  await shot(page, '22-form-as-opened');

  const wantTitle = `${REJ} pcs on this PO must go back to the vendor — send them separately`;
  const panel = page.getByRole('alert').filter({ hasText: /must go back to the vendor/i }).first();
  const shownOnOpen = (await panel.count()) > 0;

  // DIAGNOSTIC ONLY (never an assertion, never saved): if the panel is not
  // there on open, put 1 in the Send Now box so the panel's own visibility
  // condition is satisfied, and read what it then says. This separates "the
  // panel is wrong" from "the panel is right but never shown".
  let shownAfterTyping = false;
  if (!shownOnOpen) {
    await page.locator('table.innovic-table input[type="number"]').first().fill('1');
    await page.waitForTimeout(3000);
    shownAfterTyping = (await panel.count()) > 0;
    await shot(page, '22-form-after-typing-1');
  }

  const body = await norm(page);
  const panelText = (await panel.count())
    ? (await panel.first().innerText()).replace(/\s+/g, ' ').trim()
    : '';
  const hasTitle = panelText.includes(wantTitle);
  const hasNotPartLine =
    /not\s*part of what this screen offers: Against PO sends fresh pieces only/i.test(panelText);
  const listsDeviation = panelText.includes(s.ncCode!) && new RegExp(`${REJ} pcs`).test(panelText);
  const buttonName = `Send the ${REJ} back → Against NC`;
  const hasButton =
    (await page.getByRole('button', { name: buttonName }).count()) > 0;
  const mentionsJwpoDc = /Against JW PO \/ DC/i.test(panelText);

  const ok =
    shownOnOpen && hasTitle && hasNotPartLine && listsDeviation && hasButton && !mentionsJwpoDc;
  proof(
    'PROOF 3',
    'the warning states the total (4) and names the route (Against NC)',
    ok,
    shownOnOpen
      ? `panel shown as soon as the order is opened. text: "${panelText}". ` +
          `title match=${hasTitle}; "not part of what this screen offers" line=${hasNotPartLine}; ` +
          `deviation ${s.ncCode} with ${REJ} pcs listed=${listsDeviation}; ` +
          `button "${buttonName}" present=${hasButton}; "Against JW PO / DC" in the panel=${mentionsJwpoDc}`
      : `NO warning panel is rendered when the order is opened — the page says nothing about the ${REJ} pcs ` +
          `waiting to go back. After typing 1 into Send Now the panel DOES appear (${shownAfterTyping}) ` +
          `and reads: "${panelText}" (title match=${hasTitle}; button present=${hasButton}; ` +
          `"Against JW PO / DC" in it=${mentionsJwpoDc}). ` +
          `Page text (first 400 chars): "${body.slice(0, 400)}"`,
  );

  expect(shownOnOpen, 'the warning panel is shown as soon as the order is opened').toBeTruthy();
  expect(panelText, 'panel title').toContain(wantTitle);
  expect(hasNotPartLine, 'the panel says those pieces are not part of what this screen offers').toBeTruthy();
  expect(listsDeviation, `the panel lists ${s.ncCode} with ${REJ} pcs`).toBeTruthy();
  expect(hasButton, `the panel has a "${buttonName}" button`).toBeTruthy();
  expect(mentionsJwpoDc, '"Against JW PO / DC" must NOT appear in the panel').toBeFalsy();
});

// ═══════════════════════════════════════════════════════════════════════════
// PROOF 4 — a FULLY-FINISHED order (everything sent, nothing waiting) is still
//           excluded. The list was widened only for the right reason.
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-23 — PROOF 4: a fully-finished job-work order is NOT in the picker', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const s = readState();
  // The picker reads exactly this page of the list, so choose the control from
  // the SAME 200 rows — otherwise "absent" could just mean "beyond the page".
  const list = await apiGet<{ items: PoListItem[] }>(page, '/purchase-orders?limit=200&offset=0');
  const finished = list.items.find(
    (p) =>
      (p.poType === 'job_work' || p.poType === 'service') &&
      p.status !== 'draft' &&
      p.status !== 'cancelled' &&
      p.totalQty > 0 &&
      p.dcSentQty >= p.totalQty &&
      (p.rtvAwaitingChallanQty ?? 0) === 0 &&
      p.code !== s.jwpoCode,
  );

  if (!finished) {
    proof(
      'PROOF 4',
      'a fully-finished order is still excluded',
      false,
      'BLOCKED — no job-work/service order on the first 200 rows is fully sent with nothing waiting to go back, ' +
        'so there is no control to test the exclusion with.',
    );
    expect(finished, 'a fully-finished control order to test the exclusion with').toBeTruthy();
    return;
  }
  log(
    `control: ${finished.code} type=${finished.poType} status=${finished.status} ` +
      `sent ${finished.dcSentQty}/${finished.totalQty} pending=${finished.rtvAwaitingChallanQty ?? 0}`,
  );

  await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-po-search').waitFor({ timeout: 90_000 });
  await page.locator('#dc-po-search').fill(finished.code);
  await page.waitForTimeout(3000);
  await shot(page, '23-finished-order-absent');
  const rows = page.locator('tbody tr').filter({ hasText: finished.code });
  const count = await rows.count();
  const empty = /No Job Work \/ Service PO is open for dispatch/i.test(await norm(page));

  const ok = count === 0;
  proof(
    'PROOF 4',
    'a fully-finished order is still excluded',
    ok,
    `control order ${finished.code} (sent ${finished.dcSentQty}/${finished.totalQty}, nothing waiting): ` +
      `rows matching it in the picker = ${count}; "no PO open for dispatch" message shown = ${empty}`,
  );
  expect(count, finished.code + ' must NOT be offered — it owes nothing and has nothing waiting').toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// PROOF 5 — the button lands correctly: Against NC, deviation number already
//           in the search box.
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-24 — PROOF 5: the button switches to Against NC with the deviation number in the search box', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const s = readState();
  await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-po-search').waitFor({ timeout: 90_000 });
  await page.locator('#dc-po-search').fill(s.jwpoCode!);
  await page.waitForTimeout(2500);
  await page
    .locator('tbody tr')
    .filter({ hasText: s.jwpoCode! })
    .first()
    .getByRole('button', { name: 'Select' })
    .click();
  await page.locator('#dc-code').waitFor({ timeout: 90_000 });
  await page.waitForTimeout(6000);

  const buttonName = `Send the ${REJ} back → Against NC`;
  let button = page.getByRole('button', { name: buttonName });
  let hadToType = false;
  if ((await button.count()) === 0) {
    // Same diagnostic as PROOF 3 — reach the button the only way the screen
    // currently renders it, so the landing itself can still be checked.
    await page.locator('table.innovic-table input[type="number"]').first().fill('1');
    await page.waitForTimeout(3000);
    hadToType = true;
    button = page.getByRole('button', { name: buttonName });
  }
  const buttonThere = (await button.count()) > 0;
  if (buttonThere) {
    await button.first().click();
    await page.waitForTimeout(1500);
    // Typing in the form makes the switch ask first ("Are you sure you want to
    // exit?") — confirm and go.
    const leave = page.getByRole('alertdialog').getByRole('button', { name: 'Exit' });
    if ((await leave.count()) > 0 && (await leave.first().isVisible())) {
      await leave.first().click();
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(3000);
  }
  await shot(page, '24-after-button');

  const source = buttonThere ? await page.locator('#dc-source').inputValue() : '(not reached)';
  const seeded =
    buttonThere && (await page.locator('#dc-nc-search').count()) > 0
      ? await page.locator('#dc-nc-search').inputValue()
      : '(no Against NC search box on screen)';

  const ok = buttonThere && !hadToType && source === 'nc' && seeded === s.ncCode;
  proof(
    'PROOF 5',
    'the button lands on Against NC with the deviation number in the search box',
    ok,
    `button "${buttonName}" found without typing a qty first = ${buttonThere && !hadToType}` +
      (hadToType ? ' (it only appeared AFTER 1 was typed into Send Now)' : '') +
      `; after pressing it: DC Against = "${source}", Against-NC search box = "${seeded}" ` +
      `(expected "${s.ncCode}")`,
  );
  expect(buttonThere, 'the hand-off button exists').toBeTruthy();
  expect(source, 'the source switched to Against NC').toBe('nc');
  expect(seeded, 'the deviation number is already in the search box').toBe(s.ncCode);
  expect(hadToType, 'the button was reachable without typing a fresh qty first').toBeFalsy();
});

// ═══════════════════════════════════════════════════════════════════════════
// PROOF 6 — Against NC fills itself in. STOPS BEFORE SAVING.
// ═══════════════════════════════════════════════════════════════════════════
test('A219C1-25 — PROOF 6: Against NC fills in JW PO No., Sent on DC No. and a read-only Qty to Return of 4', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const s = readState();
  await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dc-source')).toBeVisible({ timeout: 90_000 });
  await page.locator('#dc-source').selectOption('nc');
  await page.locator('#dc-nc-search').waitFor({ timeout: 60_000 });
  await page.locator('#dc-nc-search').fill(s.ncCode!);
  await page.waitForTimeout(3000);
  const row = page.locator('tbody tr').filter({ hasText: s.ncCode! }).first();
  await expect(row, 'the deviation is offered on Against NC').toBeVisible({ timeout: 90_000 });
  await row.getByRole('button', { name: 'Select' }).click();
  await page.waitForTimeout(5000);
  await expect(page.getByText(/Create Return-to-Vendor Challan/i)).toBeVisible({ timeout: 90_000 });
  await shot(page, '25-against-nc-form');

  // The read-only summary block: label on one line, value under it.
  const fact = async (label: string): Promise<string> => {
    const cell = page
      .locator('div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .last();
    const t = (await cell.innerText()).replace(/\s+/g, ' ').trim();
    return t.replace(new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*'), '').trim();
  };
  const jwpo = await fact('JW PO No.');
  const sentOn = await fact('Sent on DC No.');
  const qtyToReturn = await fact('Qty to Return');
  // Nothing in the read-only summary block may be typed into — it holds no
  // <input> at all. (The vendor / date / transporter fields are BELOW it.)
  const summary = page
    .locator('div')
    .filter({ has: page.getByText('Qty to Return', { exact: true }) })
    .filter({ has: page.getByText('JW PO No.', { exact: true }) })
    .last();
  const editableInSummary = await summary.locator('input').count();

  const nc = await apiGet<NcApi>(page, '/nc-register/' + s.ncId);
  const ok =
    jwpo === s.jwpoCode &&
    sentOn === s.dcCode &&
    qtyToReturn === `${REJ} pcs` &&
    nc.poCode === s.jwpoCode;
  proof(
    'PROOF 6',
    'Against NC fills itself in from the deviation',
    ok,
    `JW PO No. on screen = "${jwpo}" (expected the order the pieces were MADE under, ${s.jwpoCode}); ` +
      `Sent on DC No. = "${sentOn}" (expected ${s.dcCode}); ` +
      `Qty to Return = "${qtyToReturn}" (expected ${REJ} pcs, read-only — editable inputs found in the ` +
      `summary block: ${editableInSummary}); api nc.poCode = "${nc.poCode ?? '—'}", ` +
      `nc.sourceDeliveryChallanCode = "${nc.sourceDeliveryChallanCode ?? '—'}"`,
  );
  expect(jwpo, 'JW PO No. is the order the pieces were MADE under').toBe(s.jwpoCode);
  expect(sentOn, 'Sent on DC No. is the outward challan they went out on').toBe(s.dcCode);
  expect(qtyToReturn, 'Qty to Return').toBe(`${REJ} pcs`);
  expect(editableInSummary, 'nothing in the read-only summary can be typed into').toBe(0);

  // DELIBERATELY NOT SAVING. Saving the return challan consumes the state the
  // six proofs rest on; proving 1–6 is the job.
  log('STOPPED before Save — the return challan is deliberately NOT raised.');
  log('time: ' + today() + ' ' + nowHm());
});
