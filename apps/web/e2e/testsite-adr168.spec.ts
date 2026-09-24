// TEST STACK ONLY (https://innovic-erp.pages.dev -> api-test-....railway.app).
//
// ADR-168 — "Final Inspection" replaces DIR as the system-appended terminal
// QC op, and a QC op may no longer sit DIRECTLY after an OSP (outsource) op.
//
// Every record this spec creates carries the marker E2E_ADR168_ in a free-text
// field (client PO ref, remarks, op names, plan/route-card op names) so it can
// be found afterwards. Existing documents are touched ONLY where the brief asks
// for a remarks-only edit (S4 / S11 / S16); their previous remarks are recorded
// in the state file so they can be put back.
//
// Steps are serial and resumable: ids/codes are written to a state file so a
// re-run skips the builder steps already done. Delete the state file to start
// a brand-new chain.
//
//   cd apps/web && npx playwright test -c e2e/testsite-adr168.config.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const WEB = 'C:/Innovic_projects/innovic-erp/wt-test/apps/web';
const STATE_FILE = `${WEB}/.playwright/adr168-state.json`;
const RESULTS_FILE = `${WEB}/.playwright/reports/adr168-results.json`;
const SHOTS = `${WEB}/.playwright/reports/adr168-shots`;

const MARK = 'E2E_ADR168_';
const CLIENT_CODE = 'CLI-009';
const ITEM_CODE = '554117146000'; // LEVER CATCH RAMMER — on the TEST item master
const VENDOR_CODE = 'VND-959'; // standing E2E vendor (FIXTURES.md)
const MACHINE_A = 'cnc-1';
const MACHINE_B = 'cnc-2';
const JC_QTY = 5;
const JWSO_QTY = 200;
const PLAN_QTY = 10;
const OLD_DIR_JC = 'IN-JC-26-00005'; // last op DIR, open, no logs (S4)
const GRANDFATHERED_JC = 'IN-JC-26-00039'; // OSP -> dir already saved (S11)
const REWORK_JC = 'IN-JC-26-00024-RW1'; // rework child, OSP -> dir (S16)
const QC_DOCS_SO_WITH_DIR = 'IN-SO-00024'; // a JC on it carries a "DIR" op
const QC_DOCS_SO_WITHOUT_DIR = 'IN-SO-00035';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

/** The rule's message (shared/jc-op-sequence.ts). Op numbers vary per case. */
const RULE_RE = /Op (\d+) \(QC\) cannot directly follow Op (\d+) \(OSP\)\. Add a manufacturing operation between them/;
const ruleRe = (qc: number, osp: number): RegExp =>
  new RegExp(`Op ${qc} \\(QC\\) cannot directly follow Op ${osp} \\(OSP\\)\\. Add a manufacturing operation between them`);

// ─── state / results ───────────────────────────────────────────────────────

interface State {
  apiBase?: string;
  jwCode?: string;
  jwId?: string;
  jwLineId?: string;
  jcA?: { id: string; code: string }; // S1: P, P -> + Final Inspection
  jcB?: { id: string; code: string }; // S5: P, OSP
  jcC?: { id: string; code: string }; // S7: P, OSP, P, QC
  jcD?: { id: string; code: string }; // S8: P, QC
  oldRemarks?: Record<string, string | null>;
  planCode?: string;
  planId?: string;
  rcItem?: string;
  rcCode?: string;
  rcId?: string;
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

interface ResultRow {
  scenario: string;
  action: string;
  document: string;
  qty: string;
  headerStatus: string;
  overallStatus: string;
  result: 'pass' | 'fail' | 'by-design' | 'na';
  note: string;
}
function readResults(): ResultRow[] {
  if (!existsSync(RESULTS_FILE)) return [];
  return JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as ResultRow[];
}
function record(row: ResultRow): void {
  const rows = readResults();
  const key = (r: ResultRow): string => `${r.scenario}|${r.action}|${r.document}`;
  const idx = rows.findIndex((r) => key(r) === key(row));
  if (idx >= 0) rows[idx] = row;
  else rows.push(row);
  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  writeFileSync(RESULTS_FILE, JSON.stringify(rows, null, 2));
  // eslint-disable-next-line no-console
  console.log(`>> [${row.scenario}] ${row.result.toUpperCase()} | ${row.action} | ${row.document} | ${row.headerStatus} | ${row.note}`);
}
function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log('>> ' + msg);
}
async function snap(page: Page, name: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  return p;
}

// ─── read-only TEST database ───────────────────────────────────────────────

const apiRequire = createRequire('C:/Innovic_projects/innovic-erp/wt-test/apps/api/package.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postgres: any = apiRequire('postgres');
function testDbUrl(): string {
  const env = readFileSync('C:/Innovic_projects/innovic-erp/erp/.env.local', 'utf8');
  const m = /^TEST_DATABASE_URL=(.*)$/m.exec(env);
  const url = (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  if (!/uitsrhyulidubnddzcex/.test(url)) throw new Error('TEST_DATABASE_URL is not the TEST project');
  return url;
}
async function db<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('SELECT only');
  const sql = postgres(testDbUrl(), { ssl: 'require', max: 1, prepare: false });
  try {
    return (await sql.unsafe(query, params)) as T[];
  } finally {
    await sql.end();
  }
}
interface DbOp { op_seq: number; operation: string; op_type: string; vendor: string | null; deleted: boolean }
async function jcOps(code: string): Promise<DbOp[]> {
  return db<DbOp>(
    `SELECT o.op_seq, o.operation, o.op_type, o.outsource_vendor_text AS vendor, (o.deleted_at IS NOT NULL) AS deleted
       FROM jc_ops o JOIN job_cards jc ON jc.id = o.job_card_id
      WHERE jc.code = $1 AND jc.deleted_at IS NULL AND o.deleted_at IS NULL
      ORDER BY o.op_seq`,
    [code],
  );
}
async function jcStatus(code: string): Promise<string> {
  const r = await db<{ s: string; closed: boolean }>(
    `SELECT COALESCE(s.computed_status, 'no_ops') AS s, (jc.closed_at IS NOT NULL) AS closed
       FROM job_cards jc LEFT JOIN v_jc_status s ON s.job_card_id = jc.id WHERE jc.code = $1 AND jc.deleted_at IS NULL`,
    [code],
  );
  return r[0] ? r[0].s : '(missing)';
}
async function jcCount(): Promise<number> {
  const r = await db<{ n: string }>(`SELECT count(*)::text AS n FROM job_cards WHERE deleted_at IS NULL`);
  return Number(r[0]?.n ?? 0);
}
async function jcByCode(code: string): Promise<{ id: string; remarks: string | null; recovery_kind: string | null }> {
  const r = await db<{ id: string; remarks: string | null; recovery_kind: string | null }>(
    `SELECT id, remarks, recovery_kind FROM job_cards WHERE code = $1 AND deleted_at IS NULL`,
    [code],
  );
  expect(r[0], `${code} exists on TEST`).toBeTruthy();
  return r[0]!;
}
/** Record a pre-existing JC's remarks ONCE (first run) so they can be put back; returns the original. */
function rememberRemarks(code: string, current: string | null): string | null {
  const s = readState();
  const old = s.oldRemarks ?? {};
  if (!(code in old)) writeState({ oldRemarks: { ...old, [code]: current } });
  return (readState().oldRemarks ?? {})[code] ?? null;
}
const opsSummary = (ops: DbOp[]): string =>
  ops.map((o) => `${o.op_seq * 10}:${o.op_type}"${o.operation}"${o.vendor ? `[${o.vendor}]` : ''}`).join(' → ');

// ─── UI helpers ────────────────────────────────────────────────────────────

/** Refuse to write anywhere but the TEST API. Returns the API origin. */
async function assertTestStack(page: Page): Promise<string> {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).origin));
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const api = [...hosts].find((h) => h.includes('railway.app'));
  expect(api, 'no API host seen — is the session alive?').toBeTruthy();
  expect(api, 'refusing to write: API host is ' + api).toContain('api-test-');
  return api!;
}

/** Pick an option from a <SearchableSelect> given its input locator. */
async function pickCombo(page: Page, input: Locator, term: string, want: RegExp): Promise<void> {
  await input.click();
  if (term) await input.fill(term);
  const id = await input.getAttribute('id');
  const listbox = page.locator(`#${id}-listbox`);
  await expect(listbox).toBeVisible({ timeout: 30_000 });
  await expect(listbox).not.toContainText('Loading', { timeout: 60_000 });
  const option = listbox.getByRole('option').filter({ hasText: want }).first();
  await option.waitFor({ state: 'visible', timeout: 30_000 });
  await option.click();
  await page.waitForTimeout(300);
}
async function comboOptions(page: Page, input: Locator): Promise<string[]> {
  await input.click();
  const id = await input.getAttribute('id');
  const listbox = page.locator(`#${id}-listbox`);
  await expect(listbox).toBeVisible({ timeout: 30_000 });
  await expect(listbox).not.toContainText('Loading', { timeout: 60_000 });
  await page.waitForTimeout(500);
  const out = (await listbox.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('.section-hdr').first().click({ force: true }).catch(() => {});
  return out;
}

/** The editable op CARD for Sr No n (10, 20, 30 …) on the JC create / edit form. */
function opCard(page: Page, n: number): Locator {
  return page
    .locator('span.mono.fw-700[style*="height: 28px"]')
    .filter({ hasText: new RegExp(`^${n * 10}$`) })
    .locator('xpath=ancestor::div[3]');
}
function editCards(page: Page): Locator {
  return page.locator('span.mono.fw-700[style*="height: 28px"]');
}
/** Read-only op cards on the JC Status view. */
function viewCards(page: Page): Locator {
  return page.locator('span.mono.fw-700[style*="height: 24px"]');
}
const hint = (page: Page): Locator => page.getByRole('alert').filter({ hasText: RULE_RE });
const saveJc = (page: Page): Locator => page.getByRole('button', { name: /Save Job Card/ });

async function addProcessOp(page: Page, n: number, name: string, machine: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add Op', exact: true }).click();
  await page.waitForTimeout(400);
  const card = opCard(page, n);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByPlaceholder('Operation name ★').fill(name);
  await pickCombo(page, card.locator('input[id^="jc-edit-mach-"]'), machine, new RegExp(machine, 'i'));
}
async function addOspOp(page: Page, n: number, name: string, vendor: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add OSP Op', exact: true }).click();
  await page.waitForTimeout(400);
  const card = opCard(page, n);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByPlaceholder('Operation name ★').fill(name);
  await pickCombo(page, card.locator('input[id^="jc-edit-vend-"]'), vendor, new RegExp(vendor));
}
async function addQcOp(page: Page, n: number, process: string): Promise<void> {
  await page.getByRole('button', { name: '+ Add QC Op', exact: true }).click();
  await page.waitForTimeout(400);
  const card = opCard(page, n);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await pickCombo(page, card.locator('input[id^="jc-edit-qcproc-"]'), process, new RegExp(`^${process}$`));
}

/** Open /job-cards/new, pick the JWSO source line, set qty + remarks. */
async function startJcCreate(page: Page, s: State, remarks: string): Promise<void> {
  await page.goto('/job-cards/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const source = page.locator('input[list="dlJcSource"]');
  await expect(source).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await page.locator('#dlJcSource option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value))).some((v) => v.includes(s.jwCode!)), {
      timeout: 60_000,
      message: `the JWSO ${s.jwCode} is offered as a JC source`,
    })
    .toBe(true);
  const values = await page.locator('#dlJcSource option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  const label = values.find((v) => v.includes(s.jwCode!))!;
  await source.fill(label);
  await page.waitForTimeout(800);
  await expect(page.getByText(/Already in JCs/)).toBeVisible({ timeout: 15_000 });
  const qty = page.locator('.form-grp').filter({ has: page.locator('label', { hasText: /^Order Qty/ }) }).locator('input');
  await qty.fill(String(JC_QTY));
  await page.locator('textarea.innovic-textarea').fill(remarks);
}

/** Click Save on the JC form and return the created/updated JC from the API response. */
async function saveJcExpectOk(page: Page, method: 'POST' | 'PATCH'): Promise<{ id: string; code: string }> {
  const resp = page.waitForResponse(
    (r) => r.request().method() === method && /\/job-cards(\/[0-9a-f-]{36})?$/.test(new URL(r.url()).pathname),
    { timeout: 60_000 },
  );
  await saveJc(page).click();
  const r = await resp;
  const body = (await r.json().catch(() => ({}))) as { id?: string; code?: string; message?: string };
  expect(r.status(), `save ${method} /job-cards -> ${r.status()} ${body.message ?? ''}`).toBeLessThan(300);
  // Create returns to the list; the JC Status edit form returns to the JC's own page.
  await page.waitForURL((u) => !/\/(new|edit)\/?$/.test(u.pathname), { timeout: 60_000 });
  return { id: body.id!, code: body.code! };
}

async function sessionToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('sb-uitsrhyulidubnddzcex-auth-token');
    if (!raw) return '';
    return (JSON.parse(raw) as { access_token?: string }).access_token ?? '';
  });
  expect(token, 'Supabase access token in localStorage').toBeTruthy();
  return token;
}

// ═══════════════════════════════════════════════════════════════════════════

test('00 - this is the test stack and the saved session is alive', async ({ page }) => {
  const api = await assertTestStack(page);
  await expect(page.getByText(/sign in|log in/i).first()).toHaveCount(0);
  await expect(page.locator('body')).toContainText(/Job Card/i, { timeout: 30_000 });
  writeState({ apiBase: api });
  log('API: ' + api);
});

test('01 - build the JWSO the job cards hang off (E2E_ADR168_)', async ({ page }) => {
  test.setTimeout(600_000);
  let s = readState();
  if (!s.jwCode) {
    await page.goto('/job-work-orders/new', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await pickCombo(page, page.locator('#clientId'), CLIENT_CODE, new RegExp(CLIENT_CODE));
    await page.getByPlaceholder(/Client PO reference/i).fill(`${MARK}JWSO-${STAMP}`);
    const lineCodeBoxes = page.locator('input[name$=".itemCodeText"]');
    if ((await lineCodeBoxes.count()) === 0) {
      await page.getByRole('button', { name: /Add Line/i }).first().click();
      await page.waitForTimeout(800);
    }
    await page.locator('input[name="lines.0.itemCodeText"]').fill(ITEM_CODE);
    await page.waitForTimeout(2500);
    await expect(page.locator('input[name="lines.0.partName"]')).not.toHaveValue('', { timeout: 30_000 });
    await page.locator('input[name="lines.0.orderQty"]').fill(String(JWSO_QTY));
    // Drawing Rev is mandatory on a JWSO line ("Line 1: enter the drawing Rev").
    await page.locator('input[name="lines.0.revision"]').fill('A');
    await page.locator('input[name="lines.0.rate"]').fill('10');
    await page.waitForTimeout(400);
    const resp = page.waitForResponse((r) => r.request().method() === 'POST' && /\/job-work-orders$/.test(new URL(r.url()).pathname), { timeout: 90_000 });
    await page.getByRole('button', { name: /Save JW/i }).click();
    const r = await resp;
    const body = (await r.json()) as { id: string; code: string; message?: string; lines?: { id: string }[] };
    expect(r.status(), 'JWSO saved: ' + JSON.stringify(body).slice(0, 200)).toBeLessThan(300);
    s = writeState({ jwCode: body.code, jwId: body.id, jwLineId: body.lines?.[0]?.id });
    log(`JWSO ${s.jwCode} (${s.jwId}) line ${s.jwLineId} — client PO ref ${MARK}JWSO-${STAMP}, qty ${JWSO_QTY}`);
  }
  if (!s.jwLineId) {
    const r = await db<{ id: string }>(
      `SELECT l.id FROM job_work_order_lines l JOIN job_work_orders j ON j.id = l.job_work_order_id WHERE j.code = $1 ORDER BY l.line_no LIMIT 1`,
      [s.jwCode],
    );
    s = writeState({ jwLineId: r[0]?.id });
  }
  const st = await db<{ status: string }>(`SELECT status FROM job_work_orders WHERE code = $1`, [s.jwCode]);
  record({
    scenario: 'Setup', action: 'Create job-work order', document: s.jwCode!, qty: `${JWSO_QTY}`,
    headerStatus: st[0]?.status ?? '?', overallStatus: 'open, 1 line', result: 'pass',
    note: `client PO ref ${MARK}JWSO-…; line 1 = ${ITEM_CODE}`,
  });
});

// ─── Final Inspection replaces DIR ─────────────────────────────────────────

test('S1 (+) JW JC with two in-house ops gets a 3rd op "Final Inspection" (not DIR)', async ({ page }) => {
  test.setTimeout(600_000);
  let s = readState();
  // Reuse JC A only while it is still in its S1 shape — S9 later retypes it.
  const shapeA = s.jcA ? (await jcOps(s.jcA.code)).map((o) => o.op_type).join(',') : '';
  if (!s.jcA || shapeA !== 'process,process,qc') {
    await startJcCreate(page, s, `${MARK}S1 two in-house ops, no QC`);
    await addProcessOp(page, 1, `${MARK}Turning`, MACHINE_A);
    await addProcessOp(page, 2, `${MARK}Milling`, MACHINE_B);
    await expect(hint(page)).toHaveCount(0);
    const jc = await saveJcExpectOk(page, 'POST');
    s = writeState({ jcA: jc });
    log(`S1: JC A ${jc.code} (${jc.id})`);
  }
  const jc = s.jcA!;
  await page.goto(`/job-cards/${jc.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(jc.code, { timeout: 60_000 });
  await expect(viewCards(page)).toHaveCount(3, { timeout: 60_000 });
  const third = viewCards(page).nth(2).locator('xpath=ancestor::div[1]');
  const thirdText = (await third.innerText()).replace(/\s+/g, ' ');
  await snap(page, 'S1-status');
  const ops = await jcOps(jc.code);
  log(`S1: screen op 30 = "${thirdText}" | DB: ${opsSummary(ops)}`);
  const ok = ops.length === 3 && ops[2]!.op_type === 'qc' && ops[2]!.operation === 'Final Inspection' && /Final Inspection/.test(thirdText) && !/\bDIR\b/i.test(thirdText);
  record({
    scenario: 'S1', action: 'Save two in-house ops', document: jc.code, qty: `${JC_QTY}`,
    headerStatus: await jcStatus(jc.code), overallStatus: `3 ops: ${opsSummary(ops)}`, result: ok ? 'pass' : 'fail',
    note: `op 30 on screen: "${thirdText}"`,
  });
  expect(ops.map((o) => o.op_type)).toEqual(['process', 'process', 'qc']);
  expect(ops[2]!.operation, 'terminal QC op is named Final Inspection').toBe('Final Inspection');
  expect(thirdText).toMatch(/Final Inspection/);
  expect(thirdText).not.toMatch(/\bDIR\b/i);
});

test('S2 (+) the JC form QC-op picker offers "Final Inspection" and "dir"', async ({ page }) => {
  await page.goto('/job-cards/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: '+ Add QC Op', exact: true }).click();
  await page.waitForTimeout(400);
  const opts = await comboOptions(page, opCard(page, 1).locator('input[id^="jc-edit-qcproc-"]'));
  log('S2: QC picker options = ' + JSON.stringify(opts));
  const hasFinal = opts.some((o) => /^Final Inspection\b/.test(o));
  const hasDir = opts.some((o) => /^dir$/i.test(o));
  record({
    scenario: 'S2', action: 'Open QC process picker', document: 'QC Process: Final Inspection', qty: '',
    headerStatus: 'Active', overallStatus: `offered: ${opts.map((o) => o.split(' — ')[0]).join(', ')}`, result: hasFinal && hasDir ? 'pass' : 'fail',
    note: 'both "Final Inspection" and "dir" are offered on the JC form',
  });
  expect(hasFinal, 'Final Inspection offered').toBe(true);
  expect(hasDir, 'dir offered as an ordinary row').toBe(true);
});

test('S3 (−) QC Process Master refuses to delete "Final Inspection" (system-added) and "dir" (in use)', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/qc-processes', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const search = page.getByPlaceholder('Search this list…');
  await expect(search).toBeVisible({ timeout: 30_000 });

  const tryDelete = async (code: string): Promise<string> => {
    await search.fill(code);
    await page.waitForTimeout(2000);
    const row = page.locator('tbody tr').filter({ hasText: new RegExp(`^\\s*\\d+\\s+${code}\\b`) }).first();
    const rowAny = (await row.count()) ? row : page.locator('tbody tr').filter({ hasText: code }).first();
    await expect(rowAny).toBeVisible({ timeout: 30_000 });
    const del = rowAny.getByRole('button', { name: /^Delete$/  /* icon-only Action column, 2026-09-21 */ });
    expect(await del.count(), `Del button visible for ${code} (needs L5 edit+approve)`).toBeGreaterThan(0);
    await del.click();
    const banner = page.getByRole('alert').filter({ hasText: /cannot be deleted|Set it to Inactive/ });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    return (await banner.innerText()).replace(/\s+/g, ' ').trim();
  };

  const finalMsg = await tryDelete('Final Inspection');
  await snap(page, 'S3-final-inspection-refused');
  log('S3: Final Inspection -> ' + finalMsg);
  const dirMsg = await tryDelete('dir');
  await snap(page, 'S3-dir-refused');
  log('S3: dir -> ' + dirMsg);

  const rows = await db<{ code: string; is_active: boolean; deleted_at: string | null }>(
    `SELECT code, is_active, deleted_at FROM qc_processes WHERE code IN ('Final Inspection', 'dir') ORDER BY code`,
  );
  const fi = rows.find((r) => r.code === 'Final Inspection');
  const dr = rows.find((r) => r.code === 'dir');
  const finalOk = /adds it automatically/i.test(finalMsg) && !!fi && fi.deleted_at === null;
  const dirOk = /in use by \d+ job card op/i.test(dirMsg) && !!dr && dr.deleted_at === null;
  record({
    scenario: 'S3', action: 'Delete system QC process', document: 'QC Process: Final Inspection', qty: '',
    headerStatus: fi?.is_active ? 'Active' : 'Inactive', overallStatus: 'row still present', result: finalOk ? 'by-design' : 'fail',
    note: finalMsg,
  });
  record({
    scenario: 'S3', action: 'Delete in-use QC process', document: 'QC Process: dir', qty: '',
    headerStatus: dr?.is_active ? 'Active' : 'Inactive', overallStatus: 'row still present', result: dirOk ? 'by-design' : 'fail',
    note: dirMsg,
  });
  expect(finalMsg).toMatch(/adds it automatically/i);
  expect(dirMsg).toMatch(/in use by \d+ job card op/i);
  expect(finalMsg).not.toBe(dirMsg);
  expect(fi?.deleted_at ?? null).toBeNull();
  expect(dr?.deleted_at ?? null).toBeNull();
});

test('S4 (+) an old JC ending in DIR keeps exactly its ops after a remarks-only edit', async ({ page }) => {
  test.setTimeout(600_000);
  const jc = await jcByCode(OLD_DIR_JC);
  const before = await jcOps(OLD_DIR_JC);
  const status = await jcStatus(OLD_DIR_JC);
  log(`S4: ${OLD_DIR_JC} status=${status} recovery=${jc.recovery_kind} ops=${opsSummary(before)}`);
  if (jc.recovery_kind || !/^(open|qc_pending)$/.test(status) || !/^dir$/i.test(before[before.length - 1]?.operation ?? '')) {
    record({
      scenario: 'S4', action: 'Save with remark change', document: OLD_DIR_JC, qty: '',
      headerStatus: status, overallStatus: opsSummary(before), result: 'na',
      note: `not editable as required: recovery=${jc.recovery_kind}, status=${status}`,
    });
    test.skip(true, 'no editable old DIR job card');
  }
  const orig4 = rememberRemarks(OLD_DIR_JC, jc.remarks);

  await page.goto(`/job-cards/${jc.id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(editCards(page)).toHaveCount(before.length, { timeout: 60_000 });
  await expect(hint(page)).toHaveCount(0);
  await page.locator('.form-grp').filter({ has: page.locator('label', { hasText: /^Remarks/ }) }).locator('textarea, input').first().fill(`${MARK}S4 remarks-only edit (was: ${orig4 ?? ''})`);
  await saveJcExpectOk(page, 'PATCH');
  const after = await jcOps(OLD_DIR_JC);
  await page.goto(`/job-cards/${jc.id}`, { waitUntil: 'domcontentloaded' });
  await expect(viewCards(page)).toHaveCount(after.length, { timeout: 60_000 });
  const screenCount = await viewCards(page).count();
  await snap(page, 'S4-status');
  const ok = after.length === before.length && screenCount === before.length && !after.some((o) => o.operation === 'Final Inspection') && after.map((o) => o.operation).join('|') === before.map((o) => o.operation).join('|');
  log(`S4: after=${opsSummary(after)} screen cards=${screenCount}`);
  record({
    scenario: 'S4', action: 'Save with remark change', document: OLD_DIR_JC, qty: '',
    headerStatus: await jcStatus(OLD_DIR_JC), overallStatus: `${after.length} ops unchanged: ${opsSummary(after)}`, result: ok ? 'pass' : 'fail',
    note: 'no "Final Inspection" appended; old DIR op kept as-is',
  });
  expect(after.map((o) => o.operation)).toEqual(before.map((o) => o.operation));
  expect(screenCount).toBe(before.length);
});

test('S5 (+) JW JC ending in an OSP op gets NO Final Inspection', async ({ page }) => {
  test.setTimeout(600_000);
  let s = readState();
  const shapeB = s.jcB ? (await jcOps(s.jcB.code)).map((o) => o.op_type).join(',') : '';
  if (!s.jcB || shapeB !== 'process,outsource') {
    await startJcCreate(page, s, `${MARK}S5 process then OSP`);
    await addProcessOp(page, 1, `${MARK}Turning`, MACHINE_A);
    await addOspOp(page, 2, `${MARK}Heat treatment`, VENDOR_CODE);
    await expect(hint(page)).toHaveCount(0);
    const jc = await saveJcExpectOk(page, 'POST');
    s = writeState({ jcB: jc });
    log(`S5: JC B ${jc.code} (${jc.id})`);
  }
  const jc = s.jcB!;
  await page.goto(`/job-cards/${jc.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toContainText(jc.code, { timeout: 60_000 });
  await expect(viewCards(page)).toHaveCount(2, { timeout: 60_000 });
  await snap(page, 'S5-status');
  const ops = await jcOps(jc.code);
  log(`S5: DB ${opsSummary(ops)}`);
  const ok = ops.length === 2 && ops[1]!.op_type === 'outsource' && !ops.some((o) => o.operation === 'Final Inspection');
  record({
    scenario: 'S5', action: 'Save process then OSP', document: jc.code, qty: `${JC_QTY}`,
    headerStatus: await jcStatus(jc.code), overallStatus: `2 ops: ${opsSummary(ops)}`, result: ok ? 'pass' : 'fail',
    note: 'ends with the OSP op; no Final Inspection appended (Rule B)',
  });
  expect(ops.map((o) => o.op_type)).toEqual(['process', 'outsource']);
  expect(await page.locator('body').innerText()).not.toMatch(/Final Inspection/);
});

test('S15 (+) QC Documents columns are MIR, MCR, Final Inspection, TPI (+ DIR only when a JC has it)', async ({ page }) => {
  const headersFor = async (so: string): Promise<string[]> => {
    await page.goto('/qc-docs', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await pickCombo(page, page.locator('#qc-docs-so'), so, new RegExp(so));
    await expect(page.locator('body')).toContainText(so, { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const ths = await page.locator('table.innovic-table thead tr').first().locator('th').allInnerTexts();
    return ths.map((t) => t.trim());
  };
  const withDir = await headersFor(QC_DOCS_SO_WITH_DIR);
  await snap(page, 'S15-with-dir');
  log(`S15: ${QC_DOCS_SO_WITH_DIR} headers = ${withDir.join(' | ')}`);
  const withoutDir = await headersFor(QC_DOCS_SO_WITHOUT_DIR);
  await snap(page, 'S15-without-dir');
  log(`S15: ${QC_DOCS_SO_WITHOUT_DIR} headers = ${withoutDir.join(' | ')}`);
  const up = (a: string[]): string[] => a.map((x) => x.toUpperCase());
  const fixedInOrder = (a: string[]): boolean => {
    const u = up(a);
    const i = ['MIR', 'MCR', 'FINAL INSPECTION', 'TPI'].map((c) => u.indexOf(c));
    return i.every((x) => x >= 0) && i[0]! < i[1]! && i[1]! < i[2]! && i[2]! < i[3]!;
  };
  const dirRows = await db<{ n: string }>(
    `SELECT count(*)::text AS n FROM jc_ops o JOIN job_cards jc ON jc.id=o.job_card_id JOIN sales_order_lines l ON l.id=jc.source_so_line_id JOIN sales_orders so ON so.id=l.sales_order_id
      WHERE so.code=$1 AND o.op_type='qc' AND upper(o.operation)='DIR' AND o.deleted_at IS NULL AND jc.deleted_at IS NULL`,
    [QC_DOCS_SO_WITH_DIR],
  );
  const ok1 = fixedInOrder(withDir) && up(withDir).includes('DIR');
  const ok2 = fixedInOrder(withoutDir) && !up(withoutDir).includes('DIR');
  record({
    scenario: 'S15', action: 'Open QC documents list', document: QC_DOCS_SO_WITH_DIR, qty: '',
    headerStatus: 'SO view', overallStatus: `columns: ${withDir.join(', ')}`, result: ok1 ? 'pass' : 'fail',
    note: `${dirRows[0]?.n ?? '?'} DIR op(s) on this SO's job cards -> DIR column shown after the fixed four`,
  });
  record({
    scenario: 'S15', action: 'Open QC documents list', document: QC_DOCS_SO_WITHOUT_DIR, qty: '',
    headerStatus: 'SO view', overallStatus: `columns: ${withoutDir.join(', ')}`, result: ok2 ? 'pass' : 'fail',
    note: 'no DIR op on this SO -> no DIR column; fixed four still present in order',
  });
  expect(ok1, 'SO with a DIR op: fixed four in order + DIR').toBe(true);
  expect(ok2, 'SO without a DIR op: fixed four only').toBe(true);
});

// ─── No QC directly after OSP ──────────────────────────────────────────────

test('S6 (−) create Process → OSP → QC: live hint, Save refused, no JC created; S7 (+) insert a Process between them → saves', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();
  const countBefore = await jcCount();
  await startJcCreate(page, s, `${MARK}S6-S7 OSP then QC`);
  await addProcessOp(page, 1, `${MARK}Turning`, MACHINE_A);
  await addOspOp(page, 2, `${MARK}Heat treatment`, VENDOR_CODE);
  await addQcOp(page, 3, 'dir');
  await expect(hint(page)).toBeVisible({ timeout: 15_000 });
  const hintText = (await hint(page).innerText()).replace(/\s+/g, ' ').trim();
  log('S6: hint = ' + hintText);
  await saveJc(page).click();
  await page.waitForTimeout(2500);
  const msgs = page.getByText(RULE_RE);
  await expect(msgs).toHaveCount(2, { timeout: 15_000 }); // hint + red error banner
  const bannerText = (await msgs.nth(1).innerText()).replace(/\s+/g, ' ').trim();
  await snap(page, 'S6-refused');
  expect(page.url(), 'still on the create form').toContain('/job-cards/new');
  const countAfter = await jcCount();
  log(`S6: banner = ${bannerText}; JC count ${countBefore} -> ${countAfter}`);
  const s6ok = ruleRe(30, 20).test(hintText) && ruleRe(30, 20).test(bannerText) && countAfter === countBefore;
  record({
    scenario: 'S6', action: 'Add QC after OSP', document: '(new JC — not created)', qty: `${JC_QTY}`,
    headerStatus: '—', overallStatus: `no JC created (count ${countBefore} → ${countAfter})`, result: s6ok ? 'by-design' : 'fail',
    note: `hint + banner: "${bannerText}"`,
  });
  expect(hintText).toMatch(ruleRe(30, 20));
  expect(bannerText).toMatch(ruleRe(30, 20));
  expect(countAfter).toBe(countBefore);

  // S7: add a manufacturing op and move it up between the OSP and the QC.
  await addProcessOp(page, 4, `${MARK}Deburr`, MACHINE_B);
  await opCard(page, 4).getByTitle('Move up').click();
  await page.waitForTimeout(500);
  await expect(hint(page)).toHaveCount(0, { timeout: 10_000 });
  await snap(page, 'S7-hint-gone');
  const shapeC = s.jcC ? (await jcOps(s.jcC.code)).map((o) => o.op_type).join(',') : '';
  let jc: { id: string; code: string };
  if (s.jcC && shapeC === 'process,outsource,process,qc') {
    // Already proven on an earlier run — do not raise a second JC C; leave the form unsaved.
    jc = s.jcC;
    log('S7: JC C already exists from an earlier run (' + jc.code + ') — form left unsaved');
    await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  } else {
    jc = await saveJcExpectOk(page, 'POST');
    s = writeState({ jcC: jc });
  }
  const ops = await jcOps(jc.code);
  log(`S7: JC C ${jc.code} — ${opsSummary(ops)}`);
  const s7ok = ops.map((o) => o.op_type).join(',') === 'process,outsource,process,qc';
  record({
    scenario: 'S7', action: 'Insert process between OSP and QC', document: jc.code, qty: `${JC_QTY}`,
    headerStatus: await jcStatus(jc.code), overallStatus: `4 ops: ${opsSummary(ops)}`, result: s7ok ? 'pass' : 'fail',
    note: 'hint disappeared once a manufacturing op sat between OSP and QC; Save succeeded',
  });
  expect(ops.map((o) => o.op_type)).toEqual(['process', 'outsource', 'process', 'qc']);
});

test('S8 (+) create Process → QC saves (QC is not blocked in general)', async ({ page }) => {
  test.setTimeout(600_000);
  let s = readState();
  if (!s.jcD) {
    await startJcCreate(page, s, `${MARK}S8 process then QC`);
    await addProcessOp(page, 1, `${MARK}Turning`, MACHINE_A);
    await addQcOp(page, 2, 'dir');
    await expect(hint(page)).toHaveCount(0);
    const jc = await saveJcExpectOk(page, 'POST');
    s = writeState({ jcD: jc });
  }
  const jc = s.jcD!;
  const ops = await jcOps(jc.code);
  log(`S8: JC D ${jc.code} — ${opsSummary(ops)}`);
  const ok = ops.map((o) => o.op_type).join(',') === 'process,qc' && ops[1]!.operation === 'dir';
  record({
    scenario: 'S8', action: 'Save process then QC', document: jc.code, qty: `${JC_QTY}`,
    headerStatus: await jcStatus(jc.code), overallStatus: `2 ops: ${opsSummary(ops)}`, result: ok ? 'pass' : 'fail',
    note: 'QC after an in-house op is allowed; no extra Final Inspection (routing already ends in QC)',
  });
  expect(ops.map((o) => o.op_type)).toEqual(['process', 'qc']);
});

test('S9 (+) edit JC A: retype its last in-house op to OSP → no hint, Save drops the stale Final Inspection', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  const jc = s.jcA!;
  const before = await jcOps(jc.code);
  if (before.some((o) => o.op_type === 'outsource')) {
    log('S9 already applied earlier: ' + opsSummary(before));
  } else {
    await page.goto(`/job-cards/${jc.id}/edit`, { waitUntil: 'domcontentloaded' });
    await expect(editCards(page)).toHaveCount(3, { timeout: 60_000 });
    const card = opCard(page, 2);
    await card.locator('input[type="checkbox"]').check();
    await page.waitForTimeout(400);
    await pickCombo(page, card.locator('input[id^="jc-edit-vend-"]'), VENDOR_CODE, new RegExp(VENDOR_CODE));
    await page.waitForTimeout(500);
    await expect(hint(page)).toHaveCount(0);
    await snap(page, 'S9-before-save');
    await saveJcExpectOk(page, 'PATCH');
  }
  const after = await jcOps(jc.code);
  await page.goto(`/job-cards/${jc.id}`, { waitUntil: 'domcontentloaded' });
  await expect(viewCards(page)).toHaveCount(after.length, { timeout: 60_000 });
  const body = await page.locator('body').innerText();
  await snap(page, 'S9-status');
  log(`S9: ${jc.code} now ${opsSummary(after)}`);
  const ok = after.map((o) => o.op_type).join(',') === 'process,outsource' && after[1]!.vendor === VENDOR_CODE && !after.some((o) => o.operation === 'Final Inspection') && !/Final Inspection/.test(body);
  record({
    scenario: 'S9', action: 'Retype last op to OSP', document: jc.code, qty: `${JC_QTY}`,
    headerStatus: await jcStatus(jc.code), overallStatus: `2 ops: ${opsSummary(after)}`, result: ok ? 'pass' : 'fail',
    note: 'stale system "Final Inspection" dropped automatically; JC ends with the OSP op',
  });
  expect(after.map((o) => o.op_type)).toEqual(['process', 'outsource']);
  expect(body).not.toMatch(/Final Inspection/);
});

test('S10 (−) edit JC B (Process, OSP): add a QC op after the OSP → hint, Save refused, JC unchanged', async ({ page }) => {
  test.setTimeout(600_000);
  const s = readState();
  const jc = s.jcB!;
  const before = await jcOps(jc.code);
  await page.goto(`/job-cards/${jc.id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(editCards(page)).toHaveCount(before.length, { timeout: 60_000 });
  await addQcOp(page, before.length + 1, 'dir');
  await expect(hint(page)).toBeVisible({ timeout: 15_000 });
  const hintText = (await hint(page).innerText()).replace(/\s+/g, ' ').trim();
  await saveJc(page).click();
  await page.waitForTimeout(2500);
  const msgs = page.getByText(RULE_RE);
  await expect(msgs).toHaveCount(2, { timeout: 15_000 });
  const bannerText = (await msgs.nth(1).innerText()).replace(/\s+/g, ' ').trim();
  await snap(page, 'S10-refused');
  expect(page.url()).toContain('/edit');
  const after = await jcOps(jc.code);
  log(`S10: hint="${hintText}" banner="${bannerText}" ops ${opsSummary(after)}`);
  const ok = ruleRe(30, 20).test(hintText) && ruleRe(30, 20).test(bannerText) && after.map((o) => o.operation).join('|') === before.map((o) => o.operation).join('|');
  record({
    scenario: 'S10', action: 'Add QC after OSP', document: jc.code, qty: `${JC_QTY}`,
    headerStatus: await jcStatus(jc.code), overallStatus: `unchanged: ${opsSummary(after)}`, result: ok ? 'by-design' : 'fail',
    note: `"${bannerText}"`,
  });
  expect(bannerText).toMatch(ruleRe(30, 20));
  expect(after.length).toBe(before.length);
});

test('S11 (+) grandfathered OSP→QC JC: remarks-only save works; adding a NEW QC right after the OSP is refused', async ({ page }) => {
  test.setTimeout(600_000);
  const jc = await jcByCode(GRANDFATHERED_JC);
  const before = await jcOps(GRANDFATHERED_JC);
  const status = await jcStatus(GRANDFATHERED_JC);
  log(`S11: ${GRANDFATHERED_JC} status=${status} ops=${opsSummary(before)}`);
  expect(before.map((o) => o.op_type).slice(0, 2), 'fixture still is OSP → QC').toEqual(['outsource', 'qc']);
  const orig11 = rememberRemarks(GRANDFATHERED_JC, jc.remarks);

  // Part 1: remarks-only edit saves without any hint.
  await page.goto(`/job-cards/${jc.id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(editCards(page)).toHaveCount(before.length, { timeout: 60_000 });
  await expect(hint(page)).toHaveCount(0);
  await snap(page, 'S11-no-hint');
  await page.locator('.form-grp').filter({ has: page.locator('label', { hasText: /^Remarks/ }) }).locator('textarea, input').first().fill(`${MARK}S11 grandfathered remarks-only edit (was: ${orig11 ?? ''})`);
  const resp = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/job-cards\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname), { timeout: 60_000 });
  await saveJc(page).click();
  const r = await resp;
  const body = (await r.json().catch(() => ({}))) as { message?: string };
  const savedOk = r.status() < 300;
  await page.waitForTimeout(1500);
  const after1 = await jcOps(GRANDFATHERED_JC);
  const rem = await jcByCode(GRANDFATHERED_JC);
  log(`S11 part 1: PATCH -> ${r.status()} ${body.message ?? ''}; remarks now "${rem.remarks}"`);
  const p1ok = savedOk && /E2E_ADR168_S11/.test(rem.remarks ?? '') && after1.map((o) => o.operation).join('|') === before.map((o) => o.operation).join('|');
  record({
    scenario: 'S11', action: 'Save with remark change', document: GRANDFATHERED_JC, qty: '',
    headerStatus: await jcStatus(GRANDFATHERED_JC), overallStatus: `ops unchanged: ${opsSummary(after1)}`, result: p1ok ? 'pass' : 'fail',
    note: savedOk ? 'existing OSP → QC pair is grandfathered: no hint, Save OK' : `save refused: ${body.message ?? r.status()}`,
  });
  expect(savedOk, `remarks-only save on a grandfathered JC: ${body.message ?? ''}`).toBe(true);

  // Part 2: a NEW QC op moved directly after the OSP is refused; nothing saved.
  await page.goto(`/job-cards/${jc.id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(editCards(page)).toHaveCount(after1.length, { timeout: 60_000 });
  await addQcOp(page, after1.length + 1, 'dir');
  // Walk the new op up until it sits right after op 10 (the OSP).
  for (let pos = after1.length + 1; pos > 2; pos--) {
    await opCard(page, pos).getByTitle('Move up').click();
    await page.waitForTimeout(400);
  }
  await expect(hint(page)).toBeVisible({ timeout: 15_000 });
  const hintText = (await hint(page).innerText()).replace(/\s+/g, ' ').trim();
  await saveJc(page).click();
  await page.waitForTimeout(2500);
  const msgs = page.getByText(RULE_RE);
  await expect(msgs).toHaveCount(2, { timeout: 15_000 });
  const bannerText = (await msgs.nth(1).innerText()).replace(/\s+/g, ' ').trim();
  await snap(page, 'S11-new-qc-refused');
  const after2 = await jcOps(GRANDFATHERED_JC);
  log(`S11 part 2: hint="${hintText}" banner="${bannerText}" ops ${opsSummary(after2)}`);
  const p2ok = ruleRe(20, 10).test(bannerText) && after2.length === after1.length;
  record({
    scenario: 'S11', action: 'Add new QC after OSP', document: GRANDFATHERED_JC, qty: '',
    headerStatus: await jcStatus(GRANDFATHERED_JC), overallStatus: `unchanged: ${opsSummary(after2)}`, result: p2ok ? 'by-design' : 'fail',
    note: `"${bannerText}" — bad state not saved`,
  });
  // Revert: leave without saving.
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  expect(bannerText).toMatch(ruleRe(20, 10));
  expect(after2.length).toBe(after1.length);
});

test('S16 (+) rework child (OSP → QC) is exempt: no hint, remarks-only save works', async ({ page }) => {
  test.setTimeout(600_000);
  const jc = await jcByCode(REWORK_JC);
  const before = await jcOps(REWORK_JC);
  const status = await jcStatus(REWORK_JC);
  log(`S16: ${REWORK_JC} status=${status} recovery=${jc.recovery_kind} ops=${opsSummary(before)}`);
  expect(jc.recovery_kind, 'fixture is a rework child').toBeTruthy();
  const orig16 = rememberRemarks(REWORK_JC, jc.remarks);
  await page.goto(`/job-cards/${jc.id}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(editCards(page)).toHaveCount(before.length, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  const hintCount = await hint(page).count();
  await snap(page, 'S16-no-hint');
  await page.locator('.form-grp').filter({ has: page.locator('label', { hasText: /^Remarks/ }) }).locator('textarea, input').first().fill(`${MARK}S16 rework exempt remarks-only edit (was: ${(orig16 ?? '').slice(0, 120)})`);
  const resp = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/job-cards\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname), { timeout: 60_000 });
  await saveJc(page).click();
  const r = await resp;
  const body = (await r.json().catch(() => ({}))) as { message?: string };
  await page.waitForTimeout(1500);
  const after = await jcOps(REWORK_JC);
  const rem = await jcByCode(REWORK_JC);
  log(`S16: hint count=${hintCount}; PATCH -> ${r.status()} ${body.message ?? ''}; remarks "${(rem.remarks ?? '').slice(0, 60)}"`);
  const frozen = r.status() >= 400;
  const ok = hintCount === 0 && r.status() < 300 && /E2E_ADR168_S16/.test(rem.remarks ?? '') && after.length === before.length;
  record({
    scenario: 'S16', action: 'Save with remark change', document: REWORK_JC, qty: '',
    headerStatus: await jcStatus(REWORK_JC), overallStatus: `ops unchanged: ${opsSummary(after)}`, result: ok ? 'pass' : frozen ? 'na' : 'fail',
    note: hintCount === 0 ? (frozen ? `no hint shown, but the save was refused (${body.message ?? r.status()}) — JC is ${status}` : 'rework child exempt: no hint, Save OK') : 'hint WAS shown on a rework child',
  });
  expect(hintCount, 'no OSP→QC hint on a rework child').toBe(0);
  if (frozen) test.skip(true, `save refused because the JC is ${status}: ${body.message ?? ''}`);
});

test('S12 (−/+) Planning: OSP → QC plan is refused on Save; OSP → Process → QC saves', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/Search SO/i).fill(s.jwCode!);
  await page.waitForTimeout(2500);
  await page.getByText(s.jwCode!, { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText(s.jwCode!, { exact: true }).first().click();
  await page.waitForTimeout(2500);

  const modal = page.locator('table.ops-routing').locator('xpath=ancestor::div[contains(@class,"modal") or @role="dialog"][1]');
  const planStatusNow = s.planId ? (await db<{ plan_status: string }>(`SELECT plan_status FROM plans WHERE id = $1 AND deleted_at IS NULL`, [s.planId]))[0]?.plan_status : undefined;
  if (!s.planId || !planStatusNow || !/^(in_planning|planned)$/.test(planStatusNow)) {
    await page.getByRole('button', { name: /\+ ?Plan/i }).first().click();
    await page.waitForTimeout(1500);
    const planQty = page.locator('.form-grp:has(label:has-text("Plan Qty")) input[type="number"]').first();
    await planQty.waitFor({ state: 'visible', timeout: 30_000 });
    await planQty.fill(String(PLAN_QTY));
    const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/plans$/.test(new URL(r.url()).pathname), { timeout: 60_000 });
    await page.getByRole('button', { name: /^Save$/ }).click();
    const cr = await created;
    const cbody = (await cr.json().catch(() => ({}))) as { id?: string; code?: string };
    s = writeState({ planId: cbody.id, planCode: cbody.code });
    log(`S12: plan ${s.planCode} (${s.planId}) created on ${s.jwCode}, qty ${PLAN_QTY}`);
  } else {
    // Re-open the existing plan for editing ("✏ Edit" while in_planning, "✏" once planned).
    log(`S12: re-opening ${s.planCode} (${planStatusNow}) for edit`);
    const planRow = page.locator('div').filter({ hasText: s.planCode! }).filter({ has: page.getByRole('button', { name: /✏/ }) }).last();
    await planRow.getByRole('button', { name: /✏/ }).first().click();
    await page.waitForTimeout(1500);
  }
  await expect(page.locator('table.ops-routing')).toBeVisible({ timeout: 60_000 });
  // The item's route card (auto-saved from the JCs above) seeds its ops into
  // the table, and the modal RE-SEEDS them whenever the table becomes empty —
  // so add the new ops first, then remove the seeded rows.
  await page.waitForTimeout(4000);
  const rows = page.locator('table.ops-routing tbody tr');
  const seeded = await rows.count();
  log(`S12: ${seeded} seeded op row(s) from the item's route card`);

  // OSP → QC
  await page.getByRole('button', { name: '+ Add OSP Op', exact: true }).click();
  await page.waitForTimeout(400);
  await rows.nth(seeded).getByPlaceholder('Operation name').fill(`${MARK}Heat treatment`);
  await pickCombo(page, rows.nth(seeded).locator('input[id^="plan-osp-vend-"]'), VENDOR_CODE, new RegExp(VENDOR_CODE));
  await page.getByRole('button', { name: '+ Add QC Op', exact: true }).click();
  await page.waitForTimeout(400);
  await rows.nth(seeded + 1).locator('select').selectOption('dir');
  for (let i = seeded - 1; i >= 0; i--) {
    await rows.nth(i).locator('button.btn-danger').click();
    await page.waitForTimeout(300);
  }
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: /Save Plan/i }).click();
  const err = page.getByText(RULE_RE);
  await expect(err.first()).toBeVisible({ timeout: 30_000 });
  const errText = (await err.first().innerText()).replace(/\s+/g, ' ').trim();
  await snap(page, 'S12-refused');
  const st1 = await db<{ plan_status: string }>(`SELECT plan_status FROM plans WHERE id = $1`, [s.planId]);
  log(`S12 refused: "${errText}"; plan status ${st1[0]?.plan_status}`);
  record({
    scenario: 'S12', action: 'Save plan OSP then QC', document: s.planCode!, qty: `${PLAN_QTY}`,
    headerStatus: st1[0]?.plan_status ?? '?', overallStatus: 'not saved (server refused)', result: ruleRe(20, 10).test(errText) ? 'by-design' : 'fail',
    note: `"${errText}"`,
  });
  expect(errText).toMatch(ruleRe(20, 10));

  // OSP → Process → QC: drop the QC row, add a process op, re-add QC.
  await rows.nth(1).locator('button.btn-danger').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '+ Add Op', exact: true }).click();
  await page.waitForTimeout(400);
  await rows.nth(1).getByPlaceholder('Operation name').fill(`${MARK}Deburr`);
  await pickCombo(page, rows.nth(1).locator('input[id^="plan-mach-"]'), MACHINE_A, new RegExp(MACHINE_A, 'i'));
  await page.getByRole('button', { name: '+ Add QC Op', exact: true }).click();
  await page.waitForTimeout(400);
  await rows.nth(2).locator('select').selectOption('dir');
  const updated = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/plans\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname), { timeout: 60_000 });
  await page.getByRole('button', { name: /Save Plan/i }).click();
  const ur = await updated;
  const ubody = (await ur.json().catch(() => ({}))) as { message?: string };
  log(`S12: PATCH /plans -> ${ur.status()} ${ubody.message ?? ''}`);
  // The modal closes once update + finalize are through.
  await expect(page.locator('table.ops-routing')).toBeHidden({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const st2 = await db<{ plan_status: string }>(`SELECT plan_status FROM plans WHERE id = $1`, [s.planId]);
  const pops = await db<{ op_seq: number; operation: string; op_type: string }>(
    `SELECT op_seq, operation, op_type FROM plan_ops WHERE plan_id = $1 AND deleted_at IS NULL ORDER BY op_seq`, [s.planId],
  );
  const summary = pops.map((o) => `${o.op_seq * 10}:${o.op_type}"${o.operation}"`).join(' → ');
  log(`S12 saved: status ${st2[0]?.plan_status}; ops ${summary}`);
  const ok = pops.map((o) => o.op_type).join(',') === 'outsource,process,qc';
  record({
    scenario: 'S12', action: 'Save plan OSP, process, QC', document: s.planCode!, qty: `${PLAN_QTY}`,
    headerStatus: st2[0]?.plan_status ?? '?', overallStatus: `3 ops: ${summary}`, result: ok ? 'pass' : 'fail',
    note: 'plan saved (not executed — no job card raised from it)',
  });
  void modal;
  expect(pops.map((o) => o.op_type)).toEqual(['outsource', 'process', 'qc']);
});

/** Re-run path: the route card from an earlier run exists — exercise the EDIT
 *  screen instead of creating a second card (OSP → QC refused, then fixed). */
async function routeCardEditPath(page: Page, s: State): Promise<void> {
  const rcLabel = `${s.rcCode} (${s.rcItem})`;
  await page.goto(`/route-cards/${s.rcId}/edit`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const rows = page.locator('table tbody tr').filter({ has: page.locator('input') });
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  const del = rows.locator('button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i--) {
    await del.nth(i).click();
    await page.waitForTimeout(250);
  }
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: /Add OSP Op/ }).click();
  await page.waitForTimeout(300);
  await rows.nth(0).getByPlaceholder(/Vendor code/).fill(VENDOR_CODE);
  await rows.nth(0).getByPlaceholder(/Coating \/ Painting/).fill(`${MARK}Heat treatment`);
  await page.getByRole('button', { name: /Add QC Op/ }).click();
  await page.waitForTimeout(300);
  await rows.nth(1).getByPlaceholder(/DIR \/ MIR/).fill('dir');
  const saveBtn = page.getByRole('button', { name: /Save Route Card/ });
  await expect(saveBtn).toBeEnabled({ timeout: 15_000 });
  const isPut = (r: { request: () => { method: () => string }; url: () => string }): boolean =>
    r.request().method() === 'PUT' && /\/route-cards\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname);
  const refused = page.waitForResponse(isPut, { timeout: 60_000 });
  await saveBtn.click();
  const rr = await refused;
  const rbody = (await rr.json().catch(() => ({}))) as { message?: string };
  const formErr = page.locator('.form-error').filter({ hasText: RULE_RE });
  await expect(formErr.first()).toBeVisible({ timeout: 30_000 });
  const errText = (await formErr.first().innerText()).replace(/\s+/g, ' ').trim();
  await snap(page, 'S13-edit-refused');
  log(`S13 (edit) refused: HTTP ${rr.status()} "${errText}"`);
  record({
    scenario: 'S13', action: 'Save route card OSP then QC', document: rcLabel, qty: '',
    headerStatus: 'edit', overallStatus: 'not saved (server refused)', result: rr.status() === 400 && ruleRe(20, 10).test(errText) ? 'by-design' : 'fail',
    note: `HTTP ${rr.status()} "${rbody.message ?? errText}"`,
  });
  expect(rr.status()).toBe(400);
  expect(errText).toMatch(ruleRe(20, 10));

  await rows.nth(1).locator('button.btn-danger').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Add Op$/ }).click();
  await page.waitForTimeout(300);
  await rows.nth(1).getByPlaceholder(/Machine code/).fill(MACHINE_A);
  await rows.nth(1).getByPlaceholder(/od turn/).fill(`${MARK}Deburr`);
  await page.getByRole('button', { name: /Add QC Op/ }).click();
  await page.waitForTimeout(300);
  await rows.nth(2).getByPlaceholder(/DIR \/ MIR/).fill('dir');
  const saved = page.waitForResponse(isPut, { timeout: 60_000 });
  await saveBtn.click();
  const sr = await saved;
  const sbody = (await sr.json().catch(() => ({}))) as { message?: string };
  expect(sr.status(), `route card edit saved: ${sbody.message ?? ''}`).toBeLessThan(300);
  const rops = await db<{ op_seq: number; operation: string; op_type: string }>(
    `SELECT op_seq, operation, op_type FROM route_card_ops WHERE route_card_id = $1 AND deleted_at IS NULL ORDER BY op_seq`, [s.rcId],
  );
  const rc = await db<{ current_revision: string | null }>(`SELECT current_revision FROM route_cards WHERE id = $1`, [s.rcId]);
  const summary = rops.map((o) => `${o.op_seq * 10}:${o.op_type}"${o.operation}"`).join(' → ');
  log(`S13 (edit) saved: ${s.rcCode} rev ${rc[0]?.current_revision} ops ${summary}`);
  const ok = rops.map((o) => o.op_type).join(',') === 'outsource,process,qc';
  record({
    scenario: 'S13', action: 'Save route card OSP, process, QC', document: rcLabel, qty: '',
    headerStatus: `rev ${rc[0]?.current_revision ?? '?'}`, overallStatus: `3 ops: ${summary}`, result: ok ? 'pass' : 'fail',
    note: 'route card edited (existing card from an earlier run)',
  });
  expect(rops.map((o) => o.op_type)).toEqual(['outsource', 'process', 'qc']);
}

test('S13 (−/+) Route Card: OSP → QC refused; OSP → Process → QC saves', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();
  if (s.rcId) {
    await routeCardEditPath(page, s);
    return;
  }
  const cand = await db<{ code: string }>(
    `SELECT i.code FROM items i WHERE i.deleted_at IS NULL AND i.code <> $1
        AND NOT EXISTS (SELECT 1 FROM route_cards rc WHERE rc.item_id = i.id AND rc.deleted_at IS NULL)
      ORDER BY i.code LIMIT 1`,
    [ITEM_CODE],
  );
  const rcItem = cand[0]?.code;
  expect(rcItem, 'an item without a route card exists').toBeTruthy();
  s = writeState({ rcItem });
  await page.goto('/route-cards/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await pickCombo(page, page.locator('#rc-item'), rcItem!, new RegExp(rcItem!));
  await page.getByPlaceholder(/Optional manufacturing notes/i).fill(`${MARK}route card routing check`).catch(() => {});
  const rows = page.locator('table tbody tr').filter({ has: page.locator('input') });
  // A new route card starts with one blank process row — clear it first.
  const del = rows.locator('button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i--) {
    await del.nth(i).click();
    await page.waitForTimeout(250);
  }
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: /Add OSP Op/ }).click();
  await page.waitForTimeout(300);
  await rows.nth(0).getByPlaceholder(/Vendor code/).fill(VENDOR_CODE);
  await rows.nth(0).getByPlaceholder(/Coating \/ Painting/).fill(`${MARK}Heat treatment`);
  await page.getByRole('button', { name: /Add QC Op/ }).click();
  await page.waitForTimeout(300);
  await rows.nth(1).getByPlaceholder(/DIR \/ MIR/).fill('dir');
  const saveBtn = page.getByRole('button', { name: /Save Route Card/ });
  await expect(saveBtn).toBeEnabled({ timeout: 15_000 });
  const refused = page.waitForResponse((r) => r.request().method() === 'POST' && /\/route-cards$/.test(new URL(r.url()).pathname), { timeout: 60_000 });
  await saveBtn.click();
  const rr = await refused;
  const rbody = (await rr.json().catch(() => ({}))) as { message?: string };
  const formErr = page.locator('.form-error').filter({ hasText: RULE_RE });
  await expect(formErr.first()).toBeVisible({ timeout: 30_000 });
  const errText = (await formErr.first().innerText()).replace(/\s+/g, ' ').trim();
  await snap(page, 'S13-refused');
  log(`S13 refused: HTTP ${rr.status()} "${errText}"`);
  record({
    scenario: 'S13', action: 'Save route card OSP then QC', document: `Route card for ${rcItem}`, qty: '',
    headerStatus: '—', overallStatus: 'not created (server refused)', result: rr.status() === 400 && ruleRe(20, 10).test(errText) ? 'by-design' : 'fail',
    note: `HTTP ${rr.status()} "${rbody.message ?? errText}"`,
  });
  expect(rr.status()).toBe(400);
  expect(errText).toMatch(ruleRe(20, 10));

  // OSP → Process → QC
  await rows.nth(1).locator('button.btn-danger').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Add Op$/ }).click();
  await page.waitForTimeout(300);
  await rows.nth(1).getByPlaceholder(/Machine code/).fill(MACHINE_A);
  await rows.nth(1).getByPlaceholder(/od turn/).fill(`${MARK}Deburr`);
  await page.getByRole('button', { name: /Add QC Op/ }).click();
  await page.waitForTimeout(300);
  await rows.nth(2).getByPlaceholder(/DIR \/ MIR/).fill('dir');
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/route-cards$/.test(new URL(r.url()).pathname), { timeout: 60_000 });
  await saveBtn.click();
  const cr = await created;
  const cbody = (await cr.json().catch(() => ({}))) as { id?: string; code?: string; message?: string };
  expect(cr.status(), `route card saved: ${cbody.message ?? ''}`).toBeLessThan(300);
  s = writeState({ rcId: cbody.id, rcCode: cbody.code });
  const rops = await db<{ op_seq: number; operation: string; op_type: string }>(
    `SELECT op_seq, operation, op_type FROM route_card_ops WHERE route_card_id = $1 AND deleted_at IS NULL ORDER BY op_seq`, [cbody.id],
  );
  const rc = await db<{ current_revision: string | null }>(`SELECT current_revision FROM route_cards WHERE id = $1`, [cbody.id]);
  const summary = rops.map((o) => `${o.op_seq * 10}:${o.op_type}"${o.operation}"`).join(' → ');
  log(`S13 saved: ${cbody.code} rev ${rc[0]?.current_revision} ops ${summary}`);
  const ok = rops.map((o) => o.op_type).join(',') === 'outsource,process,qc';
  record({
    scenario: 'S13', action: 'Save route card OSP, process, QC', document: `${cbody.code} (${rcItem})`, qty: '',
    headerStatus: `rev ${rc[0]?.current_revision ?? '?'}`, overallStatus: `3 ops: ${summary}`, result: ok ? 'pass' : 'fail',
    note: 'route card created for an item that had none',
  });
  expect(rops.map((o) => o.op_type)).toEqual(['outsource', 'process', 'qc']);
});

test('S14 (−) server enforcement without the UI: POST /job-cards with OSP → QC → HTTP 400, no JC created', async ({ page }) => {
  test.setTimeout(300_000);
  const s = readState();
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const token = await sessionToken(page);
  const api = s.apiBase ?? 'https://api-test-production-19ca.up.railway.app';
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const src = await page.request.get(`${api}/job-cards/source-options`, { headers });
  expect(src.status(), 'source-options reachable with the session token').toBe(200);
  const options = (await src.json()) as { lineId: string; code: string; type: string; itemCode: string | null; remaining: number }[];
  const line = options.find((o) => o.code === s.jwCode && o.type === 'jw');
  expect(line, `${s.jwCode} is an open JW source line`).toBeTruthy();
  const countBefore = await jcCount();
  const payload = {
    jcDate: new Date().toISOString().slice(0, 10),
    sourceJwLineId: line!.lineId,
    itemCode: line!.itemCode ?? ITEM_CODE,
    orderQty: JC_QTY,
    priority: 'normal',
    remarks: `${MARK}S14 direct API OSP then QC (must be refused)`,
    ops: [
      { operation: `${MARK}Heat treatment`, opType: 'outsource', outsourceVendorCode: VENDOR_CODE, cycleTimeMin: 0, qcRequired: false, outsourceCost: 0 },
      { operation: 'dir', opType: 'qc', cycleTimeMin: 0, qcRequired: true, outsourceCost: 0 },
    ],
    qcDocs: [],
  };
  const res = await page.request.post(`${api}/job-cards`, { headers, data: payload });
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  const countAfter = await jcCount();
  const stray = await db<{ code: string }>(`SELECT code FROM job_cards WHERE remarks LIKE $1 AND deleted_at IS NULL`, [`${MARK}S14%`]);
  log(`S14: HTTP ${res.status()} ${JSON.stringify(body)}; JC count ${countBefore} -> ${countAfter}; stray=${stray.length}`);
  const ok = res.status() === 400 && ruleRe(20, 10).test(body.message ?? '') && countAfter === countBefore && stray.length === 0;
  record({
    scenario: 'S14', action: 'Post OSP then QC to API', document: '(new JC — not created)', qty: `${JC_QTY}`,
    headerStatus: '—', overallStatus: `HTTP ${res.status()}; JC count ${countBefore} → ${countAfter}`, result: ok ? 'by-design' : 'fail',
    note: `${body.error ?? ''}: "${body.message ?? ''}"`,
  });
  expect(res.status()).toBe(400);
  expect(body.message ?? '').toMatch(ruleRe(20, 10));
  expect(countAfter).toBe(countBefore);
  expect(stray).toHaveLength(0);
});

test('99 - summary', async () => {
  const rows = readResults();
  const s = readState();
  log('STATE: ' + JSON.stringify(s));
  for (const r of rows) log(`${r.scenario.padEnd(6)} ${r.result.padEnd(9)} ${r.action.padEnd(34)} ${r.document.padEnd(28)} ${r.headerStatus.padEnd(12)} ${r.note.slice(0, 90)}`);
  const counts = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.result]: (a[r.result] ?? 0) + 1 }), {});
  log('COUNTS: ' + JSON.stringify(counts));
});
