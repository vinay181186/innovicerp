// TEST STACK ONLY — https://innovic-erp.pages.dev → api-test-…railway.app,
// Supabase TEST project uitsrhyulidubnddzcex. Never production.
//
// ADR-182 end-to-end: a plan may be covered by SEVERAL Production Orders up to
// its Plan Qty, raw material is confirmed on Create, and an order can be Short
// Closed at any stage — after which every server-side write on its Job Card
// (and on any rework child of it) is refused.
//
// Everything this spec creates carries the marker PRO-T2- in a free-text field
// (item code/name, route-card notes, client PO ref, SO/plan/order remarks,
// operation names, short-close reasons) so it can be found and undone.
//
//   cd apps/web
//   npx playwright test --config=playwright.pages.config.ts \
//     e2e/flow-pro-cap-shortclose.spec.ts --reporter=list
//
// Serial and resumable: ids/codes land in .playwright/pro-t2-state.json, so a
// re-run skips the builder steps that already succeeded. Delete that file to
// start a brand-new chain.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

// ─── constants ─────────────────────────────────────────────────────────────

const MARK = 'PRO-T2-';
const ITEM_CODE = 'PRO-T2-MAKE';
const ITEM_NAME = 'PRO-T2- Make test part';
const MACHINE = 'vmc-1'; // free on TEST; cnc-1 is held by a running session
const OP_NAME = 'PRO-T2- Turning';
const CLIENT_SEARCH = 'Adani Power Limited';
const SO_QTY = 50;
const PLAN_QTY = 50;
const ACTUAL_SIZE = 'PRO-T2- 32mm bar';
const SHORT_CLOSE_REASON_UNTOUCHED = 'PRO-T2- material scrapped';
const SHORT_CLOSE_REASON_WORKED = 'PRO-T2- customer cancelled mid-route';

const API_BASE = process.env.E2E_API_BASE ?? 'https://api-test-production-19ca.up.railway.app';
const SHOTS = '.playwright';
const STATE_FILE = '.playwright/pro-t2-state.json';

const NO_RAW_MATERIAL = 'No raw material — you cannot create the production order.';

// ─── tiny plumbing ─────────────────────────────────────────────────────────

interface State {
  itemId?: string;
  routeCardId?: string;
  routeCardCode?: string;
  soCode?: string;
  planId?: string;
  planCode?: string;
  po1?: { id: string; code: string; jcId: string; jcCode: string };
  po2?: { id: string; code: string };
  po3?: { id: string; code: string }; // the concurrency winner
  /** The one-shot race can only be run while the plan still has 10 Pending, so
   *  its outcome is recorded and re-asserted on every later run. */
  race?: { statuses: number[]; loserMessage: string };
  po4?: { id: string; code: string }; // raised after the short close freed 20
  turningOpId?: string;
  finalQcOpId?: string;
  ncId?: string;
  reworkJc?: { id: string; code: string };
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
async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/pro-${name}.png`, fullPage: true }).catch(() => {});
}
const today = (): string => new Date().toISOString().slice(0, 10);
const nowHm = (): string => new Date().toTimeString().slice(0, 5);

// ─── read-only TEST database ───────────────────────────────────────────────

const apiRequire = createRequire(
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/eaee5197-470c-4742-9cfb-792cc8dc9ee7/scratchpad/hn/apps/api/package.json',
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres: any = apiRequire('postgres');
function testDbUrl(): string {
  const env = readFileSync('C:/Innovic_projects/innovic-erp/erp/.env.local', 'utf8');
  const m = /^TEST_DATABASE_URL=(.*)$/m.exec(env);
  const url = (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  if (!/uitsrhyulidubnddzcex/.test(url)) {
    throw new Error('TEST_DATABASE_URL is not the TEST project — refusing to run');
  }
  return url;
}
/** SELECT only. Every query this spec runs is printed, so the report can quote it. */
async function db<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('SELECT only');
  const sql = postgres(testDbUrl(), { ssl: 'require', max: 1, prepare: false });
  try {
    const rows = (await sql.unsafe(query, params)) as T[];
    log('SQL ' + query.replace(/\s+/g, ' ').trim() + '  ' + JSON.stringify(params));
    log('  → ' + JSON.stringify(rows));
    return rows;
  } finally {
    await sql.end();
  }
}

/** Plan Qty / Covered / Pending straight from the database, with exactly the
 *  filter ADR-182 specifies (live orders, short-closed excluded). */
async function planCoverage(
  planCode: string,
): Promise<{ planQty: number; covered: number; pending: number; orders: number }> {
  const r = await db<{ plan_qty: number; covered: string; orders: string }>(
    `SELECT p.plan_qty,
            COALESCE((SELECT SUM(po.order_qty) FROM production_orders po
                       WHERE po.plan_id = p.id AND po.deleted_at IS NULL
                         AND po.status <> 'short_closed'), 0)::text AS covered,
            (SELECT count(*) FROM production_orders po
              WHERE po.plan_id = p.id AND po.deleted_at IS NULL)::text AS orders
       FROM plans p WHERE p.code = $1 AND p.deleted_at IS NULL`,
    [planCode],
  );
  const row = r[0]!;
  const covered = Number(row.covered);
  return {
    planQty: row.plan_qty,
    covered,
    pending: Math.max(0, row.plan_qty - covered),
    orders: Number(row.orders),
  };
}

// ─── API through the browser's own session ─────────────────────────────────

/** The Supabase access token the app itself sends as the Bearer.
 *
 *  Since 2026-09-19 the session lives in a SESSION COOKIE, chunked across
 *  `sb-<ref>-auth-token.0`, `.1`, … (lib/browser-session.ts), not in
 *  localStorage — so reading storageState().origins finds nothing. Reassemble
 *  the chunks in cookie-name order, then URL-decode, exactly as the app's own
 *  readChunked() does. localStorage is still checked first for a session left
 *  by the pre-cookie build. */
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
  const cookies = await page.context().cookies();
  const keys = new Set(
    cookies.map((c) => c.name.replace(/\.\d+$/, '')).filter((n) => /^sb-.+-auth-token$/.test(n)),
  );
  for (const key of keys) {
    const whole = cookies.find((c) => c.name === key);
    let raw = whole ? decodeURIComponent(whole.value) : null;
    if (raw === null) {
      const parts: string[] = [];
      for (let i = 0; ; i += 1) {
        const chunk = cookies.find((c) => c.name === `${key}.${i}`);
        if (!chunk) break;
        parts.push(chunk.value);
      }
      raw = parts.length > 0 ? decodeURIComponent(parts.join('')) : null;
    }
    if (!raw) continue;
    const json = raw.startsWith('base64-')
      ? Buffer.from(raw.slice(7), 'base64').toString('utf8')
      : raw;
    try {
      const parsed = JSON.parse(json) as { access_token?: string };
      if (parsed.access_token) {
        cachedBearer = parsed.access_token;
        return cachedBearer;
      }
    } catch {
      /* not this cookie */
    }
  }
  throw new Error('no Supabase session token in the storage state or cookies');
}
interface ApiAnswer {
  status: number;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}
async function apiPost(page: Page, path: string, json: unknown, key?: string): Promise<ApiAnswer> {
  const res = await page.request.post(API_BASE + path, {
    headers: {
      authorization: 'Bearer ' + (await bearer(page)),
      'content-type': 'application/json',
      'idempotency-key': key ?? `pro-t2-${Math.random().toString(16).slice(2)}-${Date.now()}`,
    },
    data: json,
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  const message = (body?.message ?? body?.error ?? text.slice(0, 200)) as string;
  log(`POST ${path} → ${res.status()} ${message}`);
  return { status: res.status(), message, body };
}
async function apiPatch(page: Page, path: string, json: unknown): Promise<ApiAnswer> {
  const res = await page.request.patch(API_BASE + path, {
    headers: {
      authorization: 'Bearer ' + (await bearer(page)),
      'content-type': 'application/json',
      'idempotency-key': `pro-t2-${Math.random().toString(16).slice(2)}-${Date.now()}`,
    },
    data: json,
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  const message = (body?.message ?? body?.error ?? text.slice(0, 200)) as string;
  log(`PATCH ${path} → ${res.status()} ${message}`);
  return { status: res.status(), message, body };
}
async function apiDelete(page: Page, path: string): Promise<ApiAnswer> {
  const res = await page.request.delete(API_BASE + path, {
    headers: {
      authorization: 'Bearer ' + (await bearer(page)),
      'idempotency-key': `pro-t2-${Math.random().toString(16).slice(2)}-${Date.now()}`,
    },
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  const message = (body?.message ?? body?.error ?? text.slice(0, 200)) as string;
  log(`DELETE ${path} → ${res.status()} ${message}`);
  return { status: res.status(), message, body };
}

/** The ADR-182 stop sentence, for the Job Card / order under test. */
function stopRe(poCode: string): RegExp {
  return new RegExp(
    `Production Order ${poCode} was short closed(?: on \\d{4}-\\d{2}-\\d{2})? — no further work is allowed on Job Card `,
  );
}

// ─── shared UI helpers ─────────────────────────────────────────────────────

/** Type-to-search combobox: click, type, pick the option that matches. */
async function pickOption(box: Locator, term: string, match: RegExp | string): Promise<void> {
  await box.click();
  await box.fill(term);
  const page = box.page();
  const opt = page.locator('[role="option"], li').filter({ hasText: match }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.waitForTimeout(400);
}

/** Navigate, retrying a dropped connection. The Cloudflare Pages edge closes
 *  the odd request (ERR_CONNECTION_CLOSED) — a transport hiccup, not a finding
 *  about the app, so it must not be allowed to fail a test. */
async function gotoApp(page: Page, path: string): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.waitForTimeout(1500);
      return;
    } catch (e) {
      lastErr = e;
      log(`goto ${path} failed (${(e as Error).message.slice(0, 60)}…) — retrying`);
      await page.waitForTimeout(3000);
    }
  }
  throw lastErr;
}

/** Open the Create Production Order screen already on our plan. */
async function openCreateOrder(page: Page, s: State): Promise<void> {
  await gotoApp(page, `/production-orders/new?planId=${s.planId}&planCode=${s.planCode}`);
  await expect(page.locator('#po-order-qty')).toBeVisible({ timeout: 60_000 });
  // The plan summary only paints once the deep-linked plan row arrives.
  await expect(page.getByText(`Plan Qty ${PLAN_QTY} ·`)).toBeVisible({ timeout: 60_000 });
}

/** Fill + submit the Create Production Order form. Returns the created order. */
async function createOrderViaUi(
  page: Page,
  s: State,
  qty: number,
  actualSize: string | null,
): Promise<{ id: string; code: string }> {
  await openCreateOrder(page, s);
  await expect(page.locator('#po-route-card')).toBeEnabled({ timeout: 60_000 });
  await page.locator('#po-order-qty').fill(String(qty));
  await page.locator('#po-rm-available').check();
  if (actualSize) await page.locator('#po-actual-size').fill(actualSize);
  await page.locator('#po-remarks').fill(`${MARK}ADR-182 verification`);
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && /\/production-orders$/.test(new URL(r.url()).pathname),
    { timeout: 120_000 },
  );
  await page.getByRole('button', { name: /Create JC/i }).click();
  const res = await created;
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    code?: string;
    message?: string;
  };
  expect(res.status(), `order for ${qty} created: ${body.message ?? ''}`).toBeLessThan(300);
  log(`created ${body.code} for ${qty}`);
  return { id: body.id!, code: body.code! };
}

/** Load a job card on the Op Entry screen. */
async function loadJcInOpEntry(page: Page, jcCode: string): Promise<void> {
  await gotoApp(page, '/op-entry');
  const box = page.locator('#jc-input');
  await box.click();
  await box.fill(jcCode);
  const opt = page.locator('[role="option"]').filter({ hasText: jcCode }).first();
  await opt.waitFor({ state: 'visible', timeout: 60_000 });
  await opt.click();
  await page.locator('table tbody tr').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
}
function opRow(page: Page, opName: string | RegExp): Locator {
  return page.locator('tr').filter({ hasText: opName }).first();
}
async function fillEntryHeader(page: Page, who: string): Promise<void> {
  await page.locator('#opf-date').fill(today());
  await page.locator('#opf-time').fill(nowHm());
  await page.locator('#opf-shift').selectOption('day');
  await page
    .getByPlaceholder(/Operator name|QC inspector name/i)
    .first()
    .fill(who)
    .catch(() => {});
}
async function popupGone(page: Page): Promise<void> {
  await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden', timeout: 180_000 });
  await page.waitForTimeout(800);
}

// ═══════════════════════════════════════════════════════════════════════════
// T1 — build the chain: item, route card, sales order, plan
// ═══════════════════════════════════════════════════════════════════════════

test('T1 build — item PRO-T2-MAKE, route card (Turning), SO qty 50, plan 50', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();

  // ── item ────────────────────────────────────────────────────────────────
  if (!s.itemId) {
    const already = await db<{ id: string }>(
      `SELECT id FROM items WHERE code = $1 AND deleted_at IS NULL`,
      [ITEM_CODE],
    );
    if (already[0]) {
      s = writeState({ itemId: already[0].id });
    } else {
      await gotoApp(page, '/items/new');
      await expect(page.locator('#code')).toBeVisible({ timeout: 60_000 });
      await page.locator('#code').fill(ITEM_CODE);
      await page.locator('#name').fill(ITEM_NAME);
      // Source defaults to Make (item-form.tsx CREATE_DEFAULTS) — assert it
      // rather than assume, because the whole chain depends on it.
      await expect(page.locator('#procurementType')).toHaveValue('make');
      await shot(page, '01-item-form');
      await page.getByRole('button', { name: /^Save$/ }).click();
      await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      s = writeState({ itemId: page.url().match(/\/items\/([0-9a-f-]{36})/)![1]! });
    }
  }
  const itemRow = await db<{ code: string; name: string; procurement_type: string }>(
    `SELECT code, name, procurement_type FROM items WHERE id = $1`,
    [s.itemId],
  );
  expect(itemRow[0]?.code).toBe(ITEM_CODE);
  expect(itemRow[0]?.procurement_type).toBe('make');

  // ── route card: one Turning op on a free machine ────────────────────────
  // One route card per item is the rule, so a rebuilt chain REUSES the card
  // rather than trying to add a second one the server would refuse.
  if (!s.routeCardId) {
    const existingRc = await db<{ id: string; code: string }>(
      `SELECT id, code FROM route_cards WHERE item_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [s.itemId],
    );
    if (existingRc[0])
      s = writeState({ routeCardId: existingRc[0].id, routeCardCode: existingRc[0].code });
  }
  if (!s.routeCardId) {
    await gotoApp(page, `/route-cards/new?itemId=${s.itemId}&itemCode=${ITEM_CODE}`);
    await expect(page.locator('#rc-item')).toBeVisible({ timeout: 60_000 });
    const rcItemVal = await page
      .locator('#rc-item')
      .inputValue()
      .catch(() => '');
    if (!rcItemVal.includes(ITEM_CODE)) {
      await pickOption(page.locator('#rc-item'), ITEM_CODE, ITEM_CODE);
    }
    await page
      .getByPlaceholder(/Optional manufacturing notes/i)
      .fill(`${MARK}ADR-182 cap + short close`)
      .catch(() => {});
    // The form opens with one blank process row — fill it rather than add one.
    const rows = page.locator('table tbody tr').filter({ has: page.locator('input') });
    await expect(rows).toHaveCount(1, { timeout: 30_000 });
    await rows
      .nth(0)
      .getByPlaceholder(/Machine code/)
      .fill(MACHINE);
    await rows
      .nth(0)
      .getByPlaceholder(/od turn/)
      .fill(OP_NAME);
    await shot(page, '02-route-card-form');
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/route-cards$/.test(new URL(r.url()).pathname),
      { timeout: 120_000 },
    );
    await page.getByRole('button', { name: /Save Route Card/ }).click();
    const rr = await saved;
    const rb = (await rr.json().catch(() => ({}))) as {
      id?: string;
      code?: string;
      message?: string;
    };
    expect(rr.status(), `route card saved: ${rb.message ?? ''}`).toBeLessThan(300);
    s = writeState({ routeCardId: rb.id!, routeCardCode: rb.code! });
  }
  const rcOps = await db<{ op_seq: number; operation: string; op_type: string }>(
    `SELECT op_seq, operation, op_type FROM route_card_ops
      WHERE route_card_id = $1 AND deleted_at IS NULL ORDER BY op_seq`,
    [s.routeCardId],
  );
  expect(rcOps.map((o) => o.op_type)).toEqual(['process']);
  expect(rcOps[0]?.operation).toContain('Turning');
  log(
    `route card ${s.routeCardCode}: ${rcOps.map((o) => `${o.op_type}"${o.operation}"`).join(' → ')}`,
  );

  // ── sales order, one line, qty 50 ───────────────────────────────────────
  if (!s.soCode) {
    await gotoApp(page, '/sales-orders/new');
    await page.waitForTimeout(2000);
    await pickOption(
      page.getByPlaceholder(/Type client code or name/i).first(),
      'Adani Power',
      new RegExp(CLIENT_SEARCH.slice(0, 12)),
    );
    await page.getByPlaceholder(/Client PO reference/i).fill(`${MARK}${Date.now()}`);
    await page
      .locator('#remarks')
      .fill(`${MARK}ADR-182 qty cap / short close verification`)
      .catch(() => {});
    await pickOption(
      page.getByPlaceholder(/Search item code or name/i).first(),
      ITEM_CODE,
      ITEM_CODE,
    );
    await page.getByPlaceholder('Qty', { exact: true }).first().fill(String(SO_QTY));
    await page
      .getByPlaceholder('Rev', { exact: true })
      .first()
      .fill('A')
      .catch(() => {});
    await page
      .getByPlaceholder('POL', { exact: true })
      .first()
      .fill('1')
      .catch(() => {});
    await page
      .getByPlaceholder('₹ Rate', { exact: true })
      .first()
      .fill('100')
      .catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, '03-sales-order-form');
    const soSaved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/sales-orders$/.test(new URL(r.url()).pathname),
      { timeout: 120_000 },
    );
    await page.getByRole('button', { name: /Save SO/i }).click();
    const sr = await soSaved;
    const sb = (await sr.json().catch(() => ({}))) as { code?: string; message?: string };
    expect(sr.status(), `SO saved: ${sb.message ?? ''}`).toBeLessThan(300);
    s = writeState({ soCode: sb.code! });
    log(`SO ${sb.code} created, one line qty ${SO_QTY}`);
  }

  // ── plan for the whole 50 ───────────────────────────────────────────────
  if (!s.planId) {
    // Deep-link straight to the order (workflow.tsx `?soId=`) rather than
    // typing into the level-1 list — one navigation, no search race.
    const so = await db<{ id: string }>(
      `SELECT id FROM sales_orders WHERE code = $1 AND deleted_at IS NULL`,
      [s.soCode],
    );
    await gotoApp(page, `/planning?soId=${so[0]!.id}`);
    const planBtn = page.getByRole('button', { name: /^\+ Plan \d+$/ }).first();
    await planBtn.waitFor({ state: 'visible', timeout: 90_000 });
    await shot(page, '04a-planning-line');
    await planBtn.click();
    const planQtyBox = page
      .locator('.form-grp:has(label:has-text("Plan Qty")) input[type="number"]')
      .first();
    await planQtyBox.waitFor({ state: 'visible', timeout: 60_000 });
    await planQtyBox.fill(String(PLAN_QTY));
    await page.locator('#create-plan-remark').fill(`${MARK}plan for the cap test`);
    await shot(page, '04-create-plan');
    const planSaved = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/plans$/.test(new URL(r.url()).pathname),
      { timeout: 120_000 },
    );
    await page.getByRole('button', { name: /^Create Plan$/ }).click();
    const pr = await planSaved;
    const pb = (await pr.json().catch(() => ({}))) as {
      id?: string;
      code?: string;
      message?: string;
    };
    expect(pr.status(), `plan saved: ${pb.message ?? ''}`).toBeLessThan(300);
    s = writeState({ planId: pb.id!, planCode: pb.code! });
  }
  const plan = await db<{
    code: string;
    plan_qty: number;
    ops_source: string;
    plan_status: string;
    item_code_text: string;
  }>(
    `SELECT code, plan_qty, ops_source, plan_status, item_code_text
       FROM plans WHERE id = $1 AND deleted_at IS NULL`,
    [s.planId],
  );
  expect(plan[0]?.plan_qty).toBe(PLAN_QTY);
  expect(plan[0]?.ops_source).toBe('route_card');
  expect(plan[0]?.item_code_text).toBe(ITEM_CODE);
  log(
    `chain ready: item ${ITEM_CODE} · RC ${s.routeCardCode} · SO ${s.soCode} · plan ${s.planCode} qty ${PLAN_QTY}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// T2 — Create screen: Order Qty, the raw-material tick, Actual Size
// ═══════════════════════════════════════════════════════════════════════════

test('T2 create order #1 — Order Qty defaults to Pending, no tick means no order', async ({
  page,
}) => {
  test.setTimeout(600_000);
  let s = readState();
  expect(s.planId, 'T1 built the plan').toBeTruthy();

  // Whatever the plan's Pending is right now — 50 on the first run, less once
  // later tests have raised orders against it. The claim is "Order Qty starts
  // at Pending", not "Order Qty starts at 50".
  const cov0 = await planCoverage(s.planCode!);
  await openCreateOrder(page, s);

  await expect(page.locator('#po-order-qty'), 'Order Qty defaults to the plan Pending').toHaveValue(
    String(cov0.pending),
  );
  await expect(
    page.getByText(`Plan Qty ${PLAN_QTY} · Covered ${cov0.covered} · Pending`),
  ).toBeVisible();
  // The three ADR-182 controls are on the form.
  await expect(page.getByText('Order Qty', { exact: false }).first()).toBeVisible();
  await expect(page.locator('#po-rm-available')).toBeVisible();
  await expect(page.locator('#po-actual-size')).toBeVisible();
  // The subtitle no longer claims one order per plan.
  await expect(page.locator('body')).not.toContainText('One Production Order per plan');

  // ── unticked → Create is blocked and the message is the server's own ────
  await expect(page.locator('#po-rm-available')).not.toBeChecked();
  const createBtn = page.getByRole('button', { name: /Create JC/i });
  await expect(createBtn).toBeDisabled();
  const alert = page.locator('[role="alert"]').filter({ hasText: 'No raw material' }).first();
  await expect(alert).toBeVisible();
  expect((await alert.innerText()).replace(/\s+/g, ' ')).toContain(NO_RAW_MATERIAL);
  await shot(page, '05-create-blocked-no-raw-material');
  log(`Create blocked with: "${NO_RAW_MATERIAL}"`);

  // The server says the same thing when the tick is bypassed entirely.
  const bypass = await apiPost(page, '/production-orders', {
    planId: s.planId,
    routeCardId: s.routeCardId,
    targetDate: today(),
    // Any qty: the raw-material refusal is thrown before anything is read.
    orderQty: 1,
    rawMaterialAvailable: false,
    actualSize: null,
    remarks: `${MARK}raw-material bypass attempt`,
  });
  expect(bypass.status).toBe(400);
  expect(bypass.message).toBe(NO_RAW_MATERIAL);

  // ── tick, Order Qty 20, Actual Size, Create ─────────────────────────────
  if (!s.po1) {
    await page.locator('#po-rm-available').check();
    await expect(createBtn).toBeEnabled();
    await page.locator('#po-order-qty').fill('20');
    await page.locator('#po-actual-size').fill(ACTUAL_SIZE);
    await page.locator('#po-remarks').fill(`${MARK}first order of the plan`);
    await shot(page, '06-create-filled');
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && /\/production-orders$/.test(new URL(r.url()).pathname),
      { timeout: 180_000 },
    );
    await createBtn.click();
    const res = await created;
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      code?: string;
      message?: string;
    };
    expect(res.status(), `order created: ${body.message ?? ''}`).toBeLessThan(300);
    await expect(page).toHaveURL(/\/production-orders\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const jc = await db<{ id: string; code: string }>(
      `SELECT jc.id, jc.code FROM job_cards jc
        JOIN production_orders po ON po.job_card_id = jc.id WHERE po.id = $1`,
      [body.id],
    );
    s = writeState({
      po1: { id: body.id!, code: body.code!, jcId: jc[0]!.id, jcCode: jc[0]!.code },
    });
    // "Born open" is a fact about the moment of creation — T6 short closes this
    // same order later, so it is asserted here rather than at the end.
    const born = await db<{ status: string }>(
      `SELECT status FROM production_orders WHERE id = $1`,
      [body.id],
    );
    expect(born[0]?.status, 'a new Production Order starts open').toBe('open');
  }

  // ── the detail screen shows what was recorded ───────────────────────────
  await gotoApp(page, `/production-orders/${s.po1!.id}`);
  await expect(page.getByText(s.po1!.code).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Raw material available')).toBeVisible();
  await expect(page.getByText('✓ Yes')).toBeVisible();
  await expect(page.getByText(ACTUAL_SIZE)).toBeVisible();
  await expect(page.getByText('Order Qty')).toBeVisible();
  await shot(page, '07-order1-detail');

  // ── DB ──────────────────────────────────────────────────────────────────
  const po = await db<{
    code: string;
    order_qty: number;
    raw_material_available: boolean;
    actual_size: string | null;
    status: string;
    jc_code_text: string;
  }>(
    `SELECT code, order_qty, raw_material_available, actual_size, status, jc_code_text
       FROM production_orders WHERE id = $1 AND deleted_at IS NULL`,
    [s.po1!.id],
  );
  expect(po[0]?.order_qty).toBe(20);
  expect(po[0]?.raw_material_available).toBe(true);
  expect(po[0]?.actual_size).toBe(ACTUAL_SIZE);

  const jcRow = await db<{ code: string; order_qty: number; actual_size: string | null }>(
    `SELECT code, order_qty, actual_size FROM job_cards WHERE id = $1 AND deleted_at IS NULL`,
    [s.po1!.jcId],
  );
  expect(jcRow[0]?.order_qty, 'the JC is built for the ORDER qty, not the plan qty').toBe(20);
  expect(jcRow[0]?.actual_size).toBe(ACTUAL_SIZE);

  const jcOps = await db<{ op_seq: number; operation: string; op_type: string; id: string }>(
    `SELECT id, op_seq, operation, op_type FROM jc_ops
      WHERE job_card_id = $1 AND deleted_at IS NULL ORDER BY op_seq`,
    [s.po1!.jcId],
  );
  expect(jcOps.map((o) => o.op_type)).toEqual(['process', 'qc']);
  expect(jcOps[1]?.operation).toBe('Final Inspection');
  writeState({ turningOpId: jcOps[0]!.id, finalQcOpId: jcOps[1]!.id });
  log(
    `${s.po1!.code} → JC ${s.po1!.jcCode} qty 20, ops ${jcOps.map((o) => `${o.op_type}"${o.operation}"`).join(' → ')}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// T3 — a second order fits; a third that overflows the plan is refused
// ═══════════════════════════════════════════════════════════════════════════

test('T3 second order of 20 fits (Covered 40 / Pending 10); a third of 30 is refused', async ({
  page,
}) => {
  test.setTimeout(600_000);
  let s = readState();
  expect(s.po1, 'T2 created the first order').toBeTruthy();

  if (!s.po2) {
    const po2 = await createOrderViaUi(page, s, 20, `${MARK}32mm bar (2nd lot)`);
    s = writeState({ po2 });
  }

  // These are assertions about ONE moment in the plan's life — 40 covered of
  // 50. Later tests short close orders and raise replacements, so on a re-run
  // over an already-advanced chain they are skipped rather than made vague.
  const atForty = (await planCoverage(s.planCode!)).covered === 40;
  test.skip(
    !atForty,
    'the chain has moved past "40 covered of 50" — delete .playwright/pro-t2-state.json to rebuild',
  );

  // ── the Create screen now reads Covered 40 / Pending 10 ─────────────────
  await openCreateOrder(page, s);
  await expect(page.getByText(`Plan Qty ${PLAN_QTY} · Covered 40 · Pending`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('#po-order-qty')).toHaveValue('10');
  // The plan summary panel carries the same three facts.
  await expect(page.getByText('Covered', { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await shot(page, '08-create-covered40-pending10');

  // ── the screen refuses 30 before the click ──────────────────────────────
  await page.locator('#po-rm-available').check();
  await page.locator('#po-order-qty').fill('30');
  await expect(page.getByRole('button', { name: /Create JC/i })).toBeDisabled();
  await expect(
    page.getByText('Order Qty must be between 1 and 10 — that is all this plan has Pending.'),
  ).toBeVisible();
  await shot(page, '09-create-30-refused-by-screen');

  // ── and the server refuses it in the ADR-182 words, naming 10 and 50 ────
  const refused = await apiPost(page, '/production-orders', {
    planId: s.planId,
    routeCardId: s.routeCardId,
    targetDate: today(),
    orderQty: 30,
    rawMaterialAvailable: true,
    actualSize: null,
    remarks: `${MARK}over-cap attempt`,
  });
  expect(refused.status).toBe(400);
  expect(refused.message).toBe(
    `Plan ${s.planCode} has only 10 left of ${PLAN_QTY} — reduce the qty.`,
  );
  log(`cap refusal: "${refused.message}"`);

  // ── the Plans list shows Covered / Pending too ──────────────────────────
  await gotoApp(page, `/plans?search=${s.planCode}`);
  const planRow = page.locator('tr').filter({ hasText: s.planCode! }).first();
  await planRow.waitFor({ timeout: 60_000 });
  const rowText = (await planRow.innerText()).replace(/\s+/g, ' ');
  expect(rowText).toContain('Covered 40');
  expect(rowText).toContain('Pending 10');
  await shot(page, '10-plans-list-covered-pending');

  // ── DB: exactly two live orders, 40 covered ─────────────────────────────
  const orders = await db<{ code: string; order_qty: number; status: string }>(
    `SELECT code, order_qty, status FROM production_orders
      WHERE plan_id = $1 AND deleted_at IS NULL ORDER BY code`,
    [s.planId],
  );
  expect(orders).toHaveLength(2);
  expect(orders.reduce((n, o) => n + o.order_qty, 0)).toBe(40);
  const cov = await planCoverage(s.planCode!);
  expect(cov).toMatchObject({ planQty: 50, covered: 40, pending: 10 });
});

// ═══════════════════════════════════════════════════════════════════════════
// T4 — two simultaneous creates of 10 against a Pending of 10
// ═══════════════════════════════════════════════════════════════════════════

test('T4 concurrency — two creates of 10 fired together, exactly one wins', async ({ page }) => {
  test.setTimeout(600_000);
  let s = readState();
  expect(s.po2, 'T3 created the second order').toBeTruthy();

  if (!s.po3) {
    const before = await planCoverage(s.planCode!);
    expect(before.pending, 'Pending is 10 before the race').toBe(10);

    // Same session, two different idempotency keys, fired together — the
    // plan's SELECT … FOR UPDATE is what has to serialise them.
    const body = (tag: string) => ({
      planId: s.planId,
      routeCardId: s.routeCardId,
      targetDate: today(),
      orderQty: 10,
      rawMaterialAvailable: true,
      actualSize: `${MARK}race ${tag}`,
      remarks: `${MARK}concurrency ${tag}`,
    });
    const [a, b] = await Promise.all([
      apiPost(page, '/production-orders', body('A'), `pro-t2-race-a-${Date.now()}`),
      apiPost(page, '/production-orders', body('B'), `pro-t2-race-b-${Date.now()}`),
    ]);
    const answers = [a, b];
    const winners = answers.filter((r) => r.status < 300);
    const losers = answers.filter((r) => r.status >= 400);
    log(`race results: ${answers.map((r) => r.status).join(' / ')}`);
    expect(winners, 'exactly one create succeeds').toHaveLength(1);
    expect(losers, 'the other is refused').toHaveLength(1);
    s = writeState({
      po3: { id: winners[0]!.body.id, code: winners[0]!.body.code },
      race: { statuses: answers.map((r) => r.status), loserMessage: losers[0]!.message },
    });
  }

  // The race consumes the plan's last 10, so it can only run once. Its recorded
  // outcome is re-asserted on every run.
  const race = s.race!;
  expect(
    race.statuses.filter((n) => n < 300),
    'exactly one create succeeded',
  ).toHaveLength(1);
  expect(
    race.statuses.filter((n) => n >= 400),
    'the other was refused',
  ).toHaveLength(1);
  log(`recorded race: statuses ${race.statuses.join('/')} · loser said "${race.loserMessage}"`);
  // What the loser was TOLD is asserted below against the same code path,
  // deterministically, because the race itself can only be run once.

  // ── DB: the sum never exceeded the plan ─────────────────────────────────
  const orders = await db<{ code: string; order_qty: number; status: string }>(
    `SELECT code, order_qty, status FROM production_orders
      WHERE plan_id = $1 AND deleted_at IS NULL ORDER BY code`,
    [s.planId],
  );
  const live = orders.filter((o) => o.status !== 'short_closed');
  expect(
    live.reduce((n, o) => n + o.order_qty, 0),
    'SUM(order_qty) of the live orders never exceeds the plan qty',
  ).toBeLessThanOrEqual(PLAN_QTY);
  const raceWinner = orders.find((o) => o.code === s.po3!.code);
  expect(raceWinner?.order_qty, 'the race winner is a real order of 10').toBe(10);

  // ── the refusal, deterministically ──────────────────────────────────────
  // The race itself can only be run once, so the wording is proved on the same
  // code path instead: top the plan back up to fully covered, then ask for one
  // more piece. This is exactly the state the losing racer met, and it can be
  // re-run any number of times.
  const cov = await planCoverage(s.planCode!);
  if (cov.pending > 0) {
    const topUp = await apiPost(page, '/production-orders', {
      planId: s.planId,
      routeCardId: s.routeCardId,
      targetDate: today(),
      orderQty: cov.pending,
      rawMaterialAvailable: true,
      actualSize: `${MARK}top-up to fully covered`,
      remarks: `${MARK}top-up so the fully-covered refusal can be re-tested`,
    });
    expect(topUp.status, 'the plan can be topped up to fully covered').toBeLessThan(300);
    log(`topped the plan up with ${topUp.body.code} for ${cov.pending}`);
  }
  const full = await planCoverage(s.planCode!);
  expect(full.pending, 'the plan is now fully covered').toBe(0);

  const overflow = await apiPost(page, '/production-orders', {
    planId: s.planId,
    routeCardId: s.routeCardId,
    targetDate: today(),
    orderQty: 1,
    rawMaterialAvailable: true,
    actualSize: null,
    remarks: `${MARK}fully-covered attempt`,
  });
  expect(overflow.status).toBe(400);
  expect(overflow.message, 'a fully covered plan is refused in the ADR-182 words').toBe(
    `Plan ${s.planCode} is fully covered by its Production Orders (${PLAN_QTY} of ${PLAN_QTY}).`,
  );
  const unchanged = await planCoverage(s.planCode!);
  expect(unchanged.covered, 'the refused create added nothing').toBe(full.covered);

  // ── the screen agrees: nothing left to order on this plan ───────────────
  // NOT by showing the "fully covered" sentence on the Create form: the create
  // picker (and the deep link behind it) both filter on `poPending`, which
  // since ADR-182 means Pending > 0, so a fully covered plan is never OFFERED
  // in the first place. That is the stronger guarantee, and it is what is
  // asserted here. (The `pendingQty === 0` branch inside new.tsx is therefore
  // effectively unreachable — reported, not worked around.)
  await gotoApp(page, '/production-orders/new');
  const planBox = page.locator('#po-plan');
  await planBox.waitFor({ state: 'visible', timeout: 60_000 });
  await planBox.click();
  await planBox.fill(s.planCode!);
  await page.waitForTimeout(2500);
  await expect(
    page.locator('[role="option"]').filter({ hasText: s.planCode! }),
    'a fully covered plan is not offered on the Create screen',
  ).toHaveCount(0);
  await shot(page, '11-plan-fully-covered');

  // The Plans list says the same in numbers, and offers no way to raise one.
  await gotoApp(page, `/plans?search=${s.planCode}`);
  const planRow = page.locator('tr').filter({ hasText: s.planCode! }).first();
  await planRow.waitFor({ timeout: 60_000 });
  const rowText = (await planRow.innerText()).replace(/\s+/g, ' ');
  expect(rowText, 'the plan reads Covered 50 / Pending 0').toContain(`Covered ${PLAN_QTY}`);
  expect(rowText).toContain('Pending 0');
  await expect(
    planRow.getByRole('link', { name: /Create Production Order/ }),
    'no "+ Create Production Order" action on a fully covered plan',
  ).toHaveCount(0);
  await shot(page, '11b-plans-list-fully-covered');
});

// ═══════════════════════════════════════════════════════════════════════════
// T5 — short close an untouched order: its qty goes back to the plan
// ═══════════════════════════════════════════════════════════════════════════

test('T5 short close the untouched order #2 — 20 pcs go back to the plan and can be re-ordered', async ({
  page,
}) => {
  test.setTimeout(900_000);
  let s = readState();
  expect(s.po2, 'order #2 exists').toBeTruthy();

  const before = await db<{ status: string }>(
    `SELECT status FROM production_orders WHERE id = $1`,
    [s.po2!.id],
  );
  if (before[0]?.status !== 'short_closed') {
    await gotoApp(page, `/production-orders/${s.po2!.id}`);
    await expect(page.getByText(s.po2!.code).first()).toBeVisible({ timeout: 60_000 });
    await expect(
      page
        .locator('.badge')
        .filter({ hasText: /^open$/ })
        .first(),
    ).toBeVisible();
    await shot(page, '12-order2-open');

    const btn = page.getByRole('button', { name: /Short Close/i }).first();
    await expect(btn).toBeVisible({ timeout: 30_000 });
    await btn.click();
    await expect(page.locator('#po-short-close-reason')).toBeVisible({ timeout: 30_000 });
    // The reason is mandatory — the confirm button stays off until it is typed.
    const modalBtn = page
      .locator('[role="dialog"]')
      .getByRole('button', { name: /^\s*Short\s*Close\s*$/i })
      .first();
    await expect(modalBtn).toBeDisabled();
    await page.locator('#po-short-close-reason').fill(SHORT_CLOSE_REASON_UNTOUCHED);
    await expect(modalBtn).toBeEnabled();
    await shot(page, '13-short-close-modal');
    const done = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/short-close$/.test(new URL(r.url()).pathname),
      { timeout: 180_000 },
    );
    await modalBtn.click();
    const dr = await done;
    expect(dr.status(), 'short close accepted').toBeLessThan(300);
    await page.waitForTimeout(2500);
  }

  // ── the screen: red badge + the who/when/why panel ──────────────────────
  await gotoApp(page, `/production-orders/${s.po2!.id}`);
  await expect(page.getByText(s.po2!.code).first()).toBeVisible({ timeout: 60_000 });
  const badge = page
    .locator('.badge')
    .filter({ hasText: /short closed/i })
    .first();
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveClass(/b-red/);
  const panel = page.getByText(/⛔ Short closed on \d{4}-\d{2}-\d{2} by /).first();
  await expect(panel).toBeVisible();
  expect(await panel.innerText()).toContain(SHORT_CLOSE_REASON_UNTOUCHED);
  // A stopped order offers neither Short Close again nor Close.
  await expect(page.getByRole('button', { name: /Short Close/i })).toHaveCount(0);
  await shot(page, '14-order2-short-closed');

  // ── DB ──────────────────────────────────────────────────────────────────
  const row = await db<{
    code: string;
    status: string;
    short_closed_at: string | null;
    short_closed_by: string | null;
    short_close_reason: string | null;
  }>(
    `SELECT code, status, short_closed_at::text, short_closed_by::text, short_close_reason
       FROM production_orders WHERE id = $1`,
    [s.po2!.id],
  );
  expect(row[0]?.status).toBe('short_closed');
  expect(row[0]?.short_closed_at).toBeTruthy();
  expect(row[0]?.short_closed_by).toBeTruthy();
  expect(row[0]?.short_close_reason).toBe(SHORT_CLOSE_REASON_UNTOUCHED);

  // ── the plan gets its 20 back ───────────────────────────────────────────
  const cov = await planCoverage(s.planCode!);
  const atThirty = cov.covered === 30 && cov.pending === 20;
  test.skip(
    !atThirty,
    'the chain has moved past "30 covered of 50" — delete .playwright/pro-t2-state.json to rebuild',
  );
  expect(cov, 'short-closed order is excluded from Covered').toMatchObject({
    planQty: 50,
    covered: 30,
    pending: 20,
  });

  await gotoApp(page, `/plans?search=${s.planCode}`);
  const planRow = page.locator('tr').filter({ hasText: s.planCode! }).first();
  await planRow.waitFor({ timeout: 60_000 });
  const rowText = (await planRow.innerText()).replace(/\s+/g, ' ');
  expect(rowText).toContain('Covered 30');
  expect(rowText).toContain('Pending 20');
  await shot(page, '15-plans-list-after-short-close');

  // ── and a fresh order for those 20 can be raised ────────────────────────
  if (!s.po4) {
    const po4 = await createOrderViaUi(page, s, 20, `${MARK}32mm bar (replacement lot)`);
    s = writeState({ po4 });
  }
  const po4Row = await db<{ code: string; order_qty: number; status: string }>(
    `SELECT code, order_qty, status FROM production_orders WHERE id = $1 AND deleted_at IS NULL`,
    [s.po4!.id],
  );
  expect(po4Row[0]?.order_qty, 'the replacement order is for the released 20').toBe(20);
  const after = await planCoverage(s.planCode!);
  expect(after.covered, 'Covered never exceeds Plan Qty').toBeLessThanOrEqual(50);
  log(`replacement order ${s.po4!.code} raised for the 20 the short close released`);
});

// ═══════════════════════════════════════════════════════════════════════════
// T6 — short close an order that has been worked; everything is then refused
// ═══════════════════════════════════════════════════════════════════════════

test('T6 short close the worked order #1 — every further write on its Job Card is refused', async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  let s = readState();
  expect(s.po1, 'order #1 exists').toBeTruthy();
  const JC = s.po1!.jcCode;

  const alreadyStopped =
    (
      await db<{ status: string }>(`SELECT status FROM production_orders WHERE id = $1`, [
        s.po1!.id,
      ])
    )[0]?.status === 'short_closed';
  // Coverage before the stop, so the release can be measured as a DELTA rather
  // than against a number that depends on how many earlier tests have run.
  const covBefore = await planCoverage(s.planCode!);
  const coveredBefore = alreadyStopped ? covBefore.covered + 20 : covBefore.covered;
  const pendingBefore = alreadyStopped ? covBefore.pending - 20 : covBefore.pending;

  if (!alreadyStopped) {
    // ── work the card: log Turning 20, then QC ────────────────────────────
    const done = await db<{ completed: string }>(
      `SELECT COALESCE(SUM(qty),0)::text AS completed FROM op_log
        WHERE jc_op_id = $1 AND log_type <> 'qc'`,
      [s.turningOpId],
    );
    if (Number(done[0]?.completed ?? 0) < 20) {
      await loadJcInOpEntry(page, JC);
      await shot(page, '16-op-entry-before-stop');
      await opRow(page, OP_NAME).getByRole('button', { name: /Start/ }).click();
      await page.waitForTimeout(1500);
      await fillEntryHeader(page, 'PRO-T2- Operator');
      await page.getByRole('button', { name: /Start Operation/i }).click();
      await popupGone(page);

      await loadJcInOpEntry(page, JC);
      await opRow(page, OP_NAME).getByRole('button', { name: /Log/ }).click();
      await page.waitForTimeout(1500);
      await fillEntryHeader(page, 'PRO-T2- Operator');
      await page.locator('#opf-qty').fill('20');
      await page.locator('#opf-rej').fill('0');
      // Stop books the 20 AND frees the machine.
      await page.getByRole('button', { name: /^Stop/ }).click();
      await popupGone(page);
      log(`logged 20 on ${OP_NAME} of ${JC}`);
    }

    const qcDone = await db<{ accepted: string }>(
      `SELECT COALESCE(SUM(qty),0)::text AS accepted FROM op_log
        WHERE jc_op_id = $1 AND log_type = 'qc'`,
      [s.finalQcOpId],
    );
    if (Number(qcDone[0]?.accepted ?? 0) < 15) {
      await loadJcInOpEntry(page, JC);
      await opRow(page, 'Final Inspection').getByRole('button', { name: /QC/ }).click();
      await page.waitForTimeout(1500);
      await fillEntryHeader(page, 'PRO-T2- Inspector');
      await page.locator('#opf-qty').fill('15');
      await page.locator('#opf-rej').fill('3');
      await page.getByRole('button', { name: /Submit QC inspection/i }).click();
      await popupGone(page);
      log('Final Inspection: 15 accepted, 3 rejected (auto-NC expected)');
    }

    // ── the rejects raised an NC; send it to rework so a child JC exists ──
    const nc = await db<{ id: string; code: string; status: string }>(
      `SELECT id, code, status FROM nc_register
        WHERE job_card_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [s.po1!.jcId],
    );
    if (nc[0]) {
      s = writeState({ ncId: nc[0].id });
      const existingChild = await db<{ id: string; code: string }>(
        `SELECT id, code FROM job_cards
          WHERE parent_job_card_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [s.po1!.jcId],
      );
      if (existingChild[0]) {
        s = writeState({ reworkJc: existingChild[0] });
      } else {
        const disp = await apiPost(page, `/nc-register/${nc[0].id}/dispose`, {
          action: 'rework',
          remarks: `${MARK}rework the 3 rejected pieces`,
        });
        if (disp.status < 300) {
          const child = await db<{ id: string; code: string }>(
            `SELECT id, code FROM job_cards
              WHERE parent_job_card_id = $1 AND deleted_at IS NULL LIMIT 1`,
            [s.po1!.jcId],
          );
          if (child[0]) s = writeState({ reworkJc: child[0] });
        } else {
          log(`rework disposition not taken (${disp.status} ${disp.message}) — T7 will skip`);
        }
      }
    }

    // ── short close order #1 through the screen ──────────────────────────
    await gotoApp(page, `/production-orders/${s.po1!.id}`);
    await expect(page.getByText(s.po1!.code).first()).toBeVisible({ timeout: 60_000 });
    await shot(page, '17-order1-before-short-close');
    await page
      .getByRole('button', { name: /Short Close/i })
      .first()
      .click();
    await expect(page.locator('#po-short-close-reason')).toBeVisible({ timeout: 30_000 });
    await page.locator('#po-short-close-reason').fill(SHORT_CLOSE_REASON_WORKED);
    const done2 = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/short-close$/.test(new URL(r.url()).pathname),
      { timeout: 180_000 },
    );
    await page
      .locator('[role="dialog"]')
      .getByRole('button', { name: /^\s*Short\s*Close\s*$/i })
      .first()
      .click();
    const d2 = await done2;
    expect(d2.status(), 'short close of the worked order accepted').toBeLessThan(300);
    await page.waitForTimeout(2500);
  }

  // ── DB: the order is stopped ────────────────────────────────────────────
  const po = await db<{
    code: string;
    status: string;
    short_closed_at: string | null;
    short_close_reason: string | null;
  }>(
    `SELECT code, status, short_closed_at::text, short_close_reason
       FROM production_orders WHERE id = $1`,
    [s.po1!.id],
  );
  expect(po[0]?.status).toBe('short_closed');
  expect(po[0]?.short_close_reason).toBe(SHORT_CLOSE_REASON_WORKED);

  // ── the Job Card page shows the red banner ──────────────────────────────
  // (What the page still OFFERS is a separate claim — see T6b, so that a UI
  //  gap cannot hide the state of the server-side refusals below.)
  await gotoApp(page, `/job-cards/${s.po1!.jcId}`);
  await expect(page.getByText(JC).first()).toBeVisible({ timeout: 90_000 });
  const banner = page
    .getByText(/was short closed(?: on \d{4}-\d{2}-\d{2})? — no further work/)
    .first();
  await expect(banner).toBeVisible({ timeout: 60_000 });
  const bannerBlock = page
    .locator('div')
    .filter({ hasText: /no further work/ })
    .last();
  expect((await bannerBlock.innerText()).replace(/\s+/g, ' ')).toContain(s.po1!.code);
  await shot(page, '18-jc-stopped-banner');

  const re = stopRe(s.po1!.code);

  // ── 1. production log ───────────────────────────────────────────────────
  const opLog = await apiPost(page, '/op-entry/op-log', {
    jcOpId: s.turningOpId,
    qty: 1,
    rejectQty: 0,
    logDate: today(),
    logTime: nowHm(),
    shift: 'day',
    operatorName: 'PRO-T2- Operator',
  });
  expect(opLog.status, 'POST /op-entry/op-log is refused').toBe(400);
  expect(opLog.message).toMatch(re);
  expect(opLog.message).toContain(JC);

  // ── 2. start an operation ───────────────────────────────────────────────
  const start = await apiPost(page, '/op-entry/start', {
    jcOpId: s.turningOpId,
    startDate: today(),
    startTime: nowHm(),
    shift: 'day',
    operatorName: 'PRO-T2- Operator',
  });
  expect(start.status, 'POST /op-entry/start is refused').toBe(400);
  expect(start.message).toMatch(re);

  // ── 3. QC log ───────────────────────────────────────────────────────────
  const qcLog = await apiPost(page, '/op-entry/qc-log', {
    jcOpId: s.finalQcOpId,
    qty: 1,
    rejectQty: 0,
    logDate: today(),
    logTime: nowHm(),
    shift: 'day',
    operatorName: 'PRO-T2- Inspector',
  });
  expect(qcLog.status, 'POST /op-entry/qc-log is refused').toBe(400);
  expect(qcLog.message).toMatch(re);

  // ── 4. NC create ────────────────────────────────────────────────────────
  const ncCreate = await apiPost(page, '/nc-register', {
    code: `${MARK}NC-${Date.now()}`,
    ncDate: today(),
    jobCardId: s.po1!.jcId,
    itemId: s.itemId,
    rejectedQty: 1,
    reason: `${MARK}must be refused`,
  });
  expect(ncCreate.status, 'POST /nc-register is refused').toBe(400);
  expect(ncCreate.message).toMatch(re);

  // ── 5. Job Card edit ────────────────────────────────────────────────────
  // PATCH /job-cards/:id takes the whole write shape (jobCardWriteInputSchema),
  // so the payload has to be a valid one — otherwise Zod refuses at the route
  // and the guard is never reached, which would prove nothing.
  const patch = await apiPatch(page, `/job-cards/${s.po1!.jcId}`, {
    jcDate: today(),
    itemCode: ITEM_CODE,
    orderQty: 20,
    priority: 'normal',
    remarks: `${MARK}must not be editable`,
  });
  expect(patch.status, 'PATCH /job-cards/:id is refused').toBe(400);
  expect(patch.message).toMatch(re);

  // ── 6. Job Card delete ──────────────────────────────────────────────────
  const del = await apiDelete(page, `/job-cards/${s.po1!.jcId}`);
  expect(del.status, 'DELETE /job-cards/:id is refused').toBe(400);
  expect(del.message).toMatch(re);
  const stillThere = await db<{ deleted: boolean }>(
    `SELECT (deleted_at IS NOT NULL) AS deleted FROM job_cards WHERE id = $1`,
    [s.po1!.jcId],
  );
  expect(stillThere[0]?.deleted, 'the card was NOT deleted').toBe(false);

  // ── 7. the order's own close ────────────────────────────────────────────
  const close = await apiPost(page, `/production-orders/${s.po1!.id}/close`, {
    lostQty: 0,
    remarks: `${MARK}must be refused`,
  });
  expect(close.status, 'POST /production-orders/:id/close is refused').toBe(400);
  expect(close.message).toMatch(new RegExp(`Production Order ${s.po1!.code} was short closed`));

  // ── 8. reverse-close ────────────────────────────────────────────────────
  // The body needs a real `closeId` (reverseProductionOrderCloseInputSchema),
  // otherwise Zod refuses at the route and the guard is never reached. A
  // well-formed uuid is enough: the guard runs BEFORE the close-ledger lookup.
  const rev = await apiPost(page, `/production-orders/${s.po1!.id}/reverse-close`, {
    closeId: '00000000-0000-4000-8000-000000000000',
    remarks: `${MARK}must be refused`,
  });
  expect(rev.status, 'POST /production-orders/:id/reverse-close is refused').toBe(400);
  expect(rev.message).toMatch(new RegExp(`Production Order ${s.po1!.code} was short closed`));

  // ── 9. short close twice ────────────────────────────────────────────────
  // 409 Conflict, not 400: the order is not being asked for something invalid,
  // it is already in the state being asked for.
  const twice = await apiPost(page, `/production-orders/${s.po1!.id}/short-close`, {
    reason: `${MARK}already stopped`,
  });
  expect(twice.status, 'a second short close is refused').toBe(409);
  expect(twice.message).toBe(`Production Order ${s.po1!.code} is already short closed`);

  // ── 10. the stopped card's pieces are not offered for dispatch ──────────
  // There is deliberately NO dispatch guard (production-order-stop.ts footnote):
  // one SO line may be covered by several orders, so the stopped card is simply
  // left OUT of the readiness list instead of the whole line being blocked.
  const so = await db<{ id: string }>(
    `SELECT id FROM sales_orders WHERE code = $1 AND deleted_at IS NULL`,
    [s.soCode],
  );
  const disp = await page.request.get(API_BASE + `/customer-dispatches/dispatchable/${so[0]!.id}`, {
    headers: { authorization: 'Bearer ' + (await bearer(page)) },
  });
  log(`dispatchable probe → HTTP ${disp.status()}`);
  expect(disp.ok(), 'the dispatchable list still loads for the SO').toBe(true);
  const dispText = await disp.text();
  log(`dispatchable body: ${dispText.slice(0, 400)}`);
  expect(dispText, 'the stopped Job Card is not offered for dispatch').not.toContain(JC);

  // ── the plan gets the un-produced qty back ──────────────────────────────
  const cov = await planCoverage(s.planCode!);
  const shortClosed = await db<{ n: string }>(
    `SELECT COALESCE(SUM(order_qty),0)::text AS n FROM production_orders
      WHERE plan_id = $1 AND deleted_at IS NULL AND status = 'short_closed'`,
    [s.planId],
  );
  // Note the total of ALL order rows can exceed Plan Qty once a stopped order's
  // qty has been re-ordered (that is the point of releasing it). The invariant
  // is about the LIVE orders only.
  expect(Number(shortClosed[0]!.n), 'order #1 joined the stopped total').toBeGreaterThanOrEqual(20);
  expect(cov.covered, 'Covered counts only the live orders, and never exceeds Plan Qty').toBe(
    coveredBefore - 20,
  );
  expect(cov.pending, 'stopping #1 released its 20 back to Pending').toBe(pendingBefore + 20);
});

// ═══════════════════════════════════════════════════════════════════════════
// T6b — what the stopped Job Card still OFFERS
// ═══════════════════════════════════════════════════════════════════════════

test('T6b stopped Job Card offers no action that the server would refuse', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  const stopped = (
    await db<{ status: string }>(`SELECT status FROM production_orders WHERE id = $1`, [s.po1!.id])
  )[0]?.status;
  expect(stopped, 'T6 short closed order #1').toBe('short_closed');

  await gotoApp(page, `/job-cards/${s.po1!.jcId}`);
  await expect(page.getByText(s.po1!.jcCode).first()).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByText(/was short closed(?: on \d{4}-\d{2}-\d{2})? — no further work/).first(),
  ).toBeVisible({ timeout: 60_000 });
  await shot(page, '18b-jc-stopped-actions');

  // "hide, never disable" is this codebase's own rule for an action the server
  // will refuse (jc-op-actions.tsx) — so nothing that leads to a refused write
  // may still be offered on a frozen card.
  // Anchored on the real labels — a bare /NC/i also matches "Ca-NC-el".
  for (const name of [/Op Entry/, /QC Call/, /⚠ NC/, /Send to vendor/i, /Raise PR/i]) {
    await expect(page.getByRole('button', { name }), `button "${name}" hidden`).toHaveCount(0);
    await expect(page.getByRole('link', { name }), `link "${name}" hidden`).toHaveCount(0);
  }

  // …and POSITIVELY: the Documents tab still SHOWS both records, with their
  // counts, as plain unclickable tiles carrying a reason. Records stay; only
  // the way into a write the server would refuse is gone.
  const qcCard = page.locator('[title]').filter({ hasText: 'QC Calls' }).first();
  await expect(qcCard, 'the QC Calls tile is still shown').toBeVisible({ timeout: 30_000 });
  expect(await qcCard.getAttribute('title'), 'the QC Calls tile says why it is not clickable').toBe(
    'The Production Order was short closed — no QC can be called on this job card.',
  );
  expect(await qcCard.evaluate((el) => el.tagName), 'the QC Calls tile is not a link').not.toBe(
    'A',
  );
  log(
    `QC Calls tile: "${(await qcCard.innerText()).replace(/\s+/g, ' ')}" · hint "${await qcCard.getAttribute('title')}"`,
  );

  const ncCard = page.locator('[title]').filter({ hasText: 'NC Report' }).first();
  await expect(ncCard, 'the NC Report tile is still shown').toBeVisible({ timeout: 30_000 });
  expect(
    await ncCard.getAttribute('title'),
    'the NC Report tile says why it is not clickable',
  ).toBe('The Production Order was short closed — these NCs are a record only.');
  expect(await ncCard.evaluate((el) => el.tagName), 'the NC Report tile is not a link').not.toBe(
    'A',
  );
  log(
    `NC Report tile: "${(await ncCard.innerText()).replace(/\s+/g, ' ')}" · hint "${await ncCard.getAttribute('title')}"`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// T7 — the rework child of a stopped card is refused too
// ═══════════════════════════════════════════════════════════════════════════

test('T7 rework child — the same refusal applies down the parent chain', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  test.skip(!s.reworkJc, 'no rework child job card was raised — nothing to check');

  const child = await db<{ id: string; code: string; parent: string | null }>(
    `SELECT id, code, parent_job_card_id::text AS parent FROM job_cards
      WHERE id = $1 AND deleted_at IS NULL`,
    [s.reworkJc!.id],
  );
  expect(child[0]?.parent, "the child hangs off the stopped order's card").toBe(s.po1!.jcId);
  // A rework child never carries production_order_id itself — the guard has to
  // walk up parent_job_card_id to find the stopped order.
  const link = await db<{ po: string | null }>(
    `SELECT production_order_id::text AS po FROM job_cards WHERE id = $1`,
    [s.reworkJc!.id],
  );
  expect(link[0]?.po, 'the child carries no order link of its own').toBeNull();

  const re = stopRe(s.po1!.code);
  const patch = await apiPatch(page, `/job-cards/${s.reworkJc!.id}`, {
    jcDate: today(),
    itemCode: ITEM_CODE,
    orderQty: 3,
    priority: 'normal',
    remarks: `${MARK}child must be frozen too`,
  });
  expect(patch.status, 'PATCH on the rework child is refused').toBe(400);
  expect(patch.message).toMatch(re);
  expect(patch.message).toContain(s.reworkJc!.code);

  const childOps = await db<{ id: string; op_type: string; operation: string }>(
    `SELECT id, op_type, operation FROM jc_ops
      WHERE job_card_id = $1 AND deleted_at IS NULL ORDER BY op_seq`,
    [s.reworkJc!.id],
  );
  const firstProcess = childOps.find((o) => o.op_type === 'process');
  if (firstProcess) {
    const opLog = await apiPost(page, '/op-entry/op-log', {
      jcOpId: firstProcess.id,
      qty: 1,
      rejectQty: 0,
      logDate: today(),
      logTime: nowHm(),
      shift: 'day',
      operatorName: 'PRO-T2- Operator',
    });
    expect(opLog.status, 'production log on the rework child is refused').toBe(400);
    expect(opLog.message).toMatch(re);
  }

  await gotoApp(page, `/job-cards/${s.reworkJc!.id}`);
  await expect(
    page.getByText(/was short closed(?: on \d{4}-\d{2}-\d{2})? — no further work/).first(),
  ).toBeVisible({ timeout: 90_000 });
  await shot(page, '19-rework-child-stopped');
});
