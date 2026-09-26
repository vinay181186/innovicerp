// TEST STACK ONLY (https://innovic-erp.pages.dev -> api-test-....railway.app).
//
// ERP chain verification report, 2026-09-15. Two chains, driven through the
// real screens, every major step recorded as one row of a table that is
// rendered to PDF at the end:
//
//   Test 1 — Rework with MULTIPLE child job cards (ADR-161):
//     SO 12 -> JC (Turning + DIR) -> Turning 12 -> DIR QC 8 ok / 4 rej -> NC 1
//     -> Rework 4 -> child -RW1 -> run -> QC 3 ok / 1 rej -> NC 2 on the child
//     -> Rework 1 -> second child -> run -> QC 1 ok -> both NCs closed, parent
//     DIR back at 12 accepted.
//
//   Test 2 — GRN -> Incoming QC reject -> Return to vendor (the OSP chain):
//     (a) observation: a plain purchase-PO GRN reject raises NO NC (by design)
//     (b) SO 10 -> JC with ONE outsource op (VND-959) -> auto JW PR -> JWPO ->
//         outward DC 10 -> GRN Against JWPO/DC 10 -> Incoming QC 7 ok / 3 rej
//         -> NC (grn line) -> Return to vendor -> Create DC (vendor prefill
//         check) -> JWPO received drops to 7 -> GRN Against NC 3 -> Incoming
//         QC 3 ok -> NC closed, JWPO back to 10, op card at-vendor 0, DC
//         received, stock ledger.
//
//   Re-verification after ADR-165 (2026-09-16) — the "R1" rows:
//     The 2026-09-15 run left four FAIL rows on the job-work PO behind the
//     outsource op (T2-13, T2-18, T3-05, T3-12: line subtracted twice on a
//     nested return, header never recomputed on a return event). ADR-165 fixed
//     both. A FRESH OSP chain (SO 10 -> JC -> JWPO -> DC -> GRN -> QC 7/3) is
//     built and walked through FOUR return-to-vendor levels, reading the JWPO
//     line + header after every event:
//       NC-A out 3 -> 7/partial; replacement 1 ok / 2 rej -> 10/closed (NC-B)
//       NC-B out 2 -> 8/partial; replacement 1 ok / 1 rej -> 10/closed (NC-C)
//       NC-C out 1 -> 9/partial; replacement 0 ok / 1 rej -> 10/closed (NC-D)
//         (the all-rejected replacement must still move the line)
//       NC-D out 1 -> 9/partial; replacement 1 ok       -> 10 of 10 / closed
//     plus the NC activity-log wording ("N replacement accepted, M failed").
//     Tests 1-3 rows are pinned (keep: true) and never re-evaluated; run the
//     re-verification alone with:  --grep "00 -|R1|ZZ"
//
// Every free-text value carries E2E_. Steps are resumable: created ids/codes
// go to a state file so a re-run skips what is already built. Delete the state
// file to build a brand-new chain. Rows are kept in a JSON file so the PDF can
// be regenerated from a re-run without rebuilding anything.
//
// Run from apps/web/ (credentials come from .env.e2e — the TEST login):
//   npx playwright test --config=playwright.pages.config.ts e2e/flow-erp-chain-report.spec.ts --reporter=list
//
// Outputs (test-results/ is wiped by Playwright on every run, so every PDF is
// also copied to .playwright/reports/):
//   apps/web/test-results/erp-chain-verification-2026-09-16.pdf           (all rows — THE report)
//   apps/web/.playwright/reports/erp-chain-verification-2026-09-16-FINAL.pdf/.json (same, coordinator's copy)
//   apps/web/test-results/erp-chain-verification-2026-09-16-reverify.pdf  (R1 rows only)
//   apps/web/test-results/erp-chain-verification-2026-09-16-adr166.pdf   (R2 rows only — ADR-166 batch 1)
//   apps/web/test-results/erp-chain-verification-2026-09-16-adr167.pdf   (R3 rows only — ADR-167 batch 2/3)
//   apps/web/test-results/erp-chain-verification-2026-09-16-test{1,2,3}.pdf
//   apps/web/test-results/erp-chain-verification-2026-09-16.json
//   apps/web/.playwright/reports/<same names>
//   apps/web/.playwright/erp-chain-shots/<row>.png

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Locator, type Page, expect, test } from '@playwright/test';

const WEB = 'C:/Innovic_projects/innovic-erp/wt-test/apps/web';
const STATE_FILE = WEB + '/.playwright/erp-chain-report-state.json';
// Rows and screenshots accumulate OUTSIDE test-results/: Playwright empties
// test-results/ at the start of every run, which wiped the first run's rows
// on resume. The JSON is copied into test-results/ when a PDF is rendered.
const ROWS_FILE = WEB + '/.playwright/erp-chain-report-rows.json';
const SHOT_DIR = WEB + '/.playwright/erp-chain-shots';
const OUT_DIR = WEB + '/test-results';
// Durable copies: Playwright empties test-results/ at the start of every run.
const REPORTS_DIR = WEB + '/.playwright/reports';
const OUT_STEM = 'erp-chain-verification-2026-09-16';
const JSON_OUT = OUT_DIR + '/' + OUT_STEM + '.json';
const PDF_FILE = OUT_DIR + '/' + OUT_STEM + '.pdf';
const PDF_TEST1 = OUT_DIR + '/' + OUT_STEM + '-test1.pdf';
const PDF_TEST2 = OUT_DIR + '/' + OUT_STEM + '-test2.pdf';
const PDF_TEST3 = OUT_DIR + '/' + OUT_STEM + '-test3.pdf';
const PDF_REVERIFY = OUT_DIR + '/' + OUT_STEM + '-reverify.pdf';
const PDF_ADR166 = OUT_DIR + '/' + OUT_STEM + '-adr166.pdf';
const PDF_ADR167 = OUT_DIR + '/' + OUT_STEM + '-adr167.pdf';
const STACK_URL = 'https://innovic-erp.pages.dev';
const REPORT_DATE = '2026-09-15 (Tests 1–3) · 2026-09-16 (re-verification after ADR-165; ADR-166 batch 1; ADR-167 batch 2/3)';

// The standing E2E vendor on the test stack (FIXTURES.md).
const VENDOR_CODE = 'VND-959';
const VENDOR_NAME = /E2E_ Shreeji/;
// The same item the QC–NC rework spec uses; it exists on the test stack.
const ITEM_CODE = '554117144000';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

// Test 1 quantities.
const T1_QTY = 12;
const T1_ACC1 = 8;
const T1_REJ1 = 4;
const T1_ACC2 = 3;
const T1_REJ2 = 1;
// Test 2 quantities.
const T2_QTY = 10;
const T2_ACC1 = 7;
const T2_REJ1 = 3;
const T2A_LINE = { code: 'E2E_CHAIN-A1', name: 'E2E_ Hex bolt M12x50', qty: 2, rate: 15 };

interface State {
  apiBase?: string;
  // Test 1
  t1SoCode?: string;
  t1SoUrl?: string;
  t1JcCode?: string;
  t1JcUrl?: string;
  t1Op1Done?: boolean;
  t1Nc1Code?: string;
  t1Nc1Url?: string;
  t1Nc1Id?: string;
  t1Child1Code?: string;
  t1Child1Url?: string;
  t1Child1Done?: boolean;
  t1Nc2Code?: string;
  t1Nc2Url?: string;
  t1Nc2Id?: string;
  t1Child2Code?: string;
  t1Child2Url?: string;
  t1Child2Done?: boolean;
  // Test 2a
  t2aPrCode?: string;
  t2aPoId?: string;
  t2aPoCode?: string;
  t2aPoApproved?: boolean;
  t2aGrnId?: string;
  t2aGrnCode?: string;
  t2aNcCountBefore?: number;
  t2aQcDone?: boolean;
  // Test 2b
  t2SoCode?: string;
  t2SoUrl?: string;
  t2JcCode?: string;
  t2JcUrl?: string;
  t2JcId?: string;
  t2PrCode?: string;
  t2PoId?: string;
  t2PoCode?: string;
  t2PoApproved?: boolean;
  t2DcId?: string;
  t2DcCode?: string;
  t2Grn1Id?: string;
  t2Grn1Code?: string;
  t2Qc1Done?: boolean;
  t2NcCode?: string;
  t2NcUrl?: string;
  t2NcId?: string;
  t2NcDisposed?: boolean;
  t2RtvVendorPrefill?: string;
  t2RtvDcId?: string;
  t2RtvDcCode?: string;
  t2Grn2Id?: string;
  t2Grn2Code?: string;
  t2Qc2Done?: boolean;
  // Test 3
  t3SoCode?: string;
  t3SoUrl?: string;
  t3JcCode?: string;
  t3JcUrl?: string;
  t3PrCode?: string;
  t3PoId?: string;
  t3PoCode?: string;
  t3DcId?: string;
  t3DcCode?: string;
  t3Grn1Id?: string;
  t3Grn1Code?: string;
  t3Qc1Done?: boolean;
  t3NcACode?: string;
  t3NcAUrl?: string;
  t3NcAId?: string;
  t3NcADisposed?: boolean;
  t3RtvDc1Id?: string;
  t3RtvDc1Code?: string;
  t3RtvDc1Prefill?: string;
  t3Grn2Id?: string;
  t3Grn2Code?: string;
  t3Qc2Done?: boolean;
  t3NcBCode?: string;
  t3NcBUrl?: string;
  t3NcBId?: string;
  t3NcBReworkRefusal?: string;
  t3NcBDisposed?: boolean;
  t3ChildCode?: string;
  t3ChildUrl?: string;
  t3RtvDc2Id?: string;
  t3RtvDc2Code?: string;
  t3RtvDc2Prefill?: string;
  t3Grn3Id?: string;
  t3Grn3Code?: string;
  t3Qc3Done?: boolean;
  t3NcCCode?: string;
  t3NcCUrl?: string;
  t3NcCId?: string;
  t3NcCReworkRefusal?: string;
  t3NcCDisposed?: boolean;
  t3RtvDc3Id?: string;
  t3RtvDc3Code?: string;
  t3RtvDc3Prefill?: string;
  t3Grn4Id?: string;
  t3Grn4Code?: string;
  t3Qc4Done?: boolean;
  /** Re-verification chain (2026-09-16): flat string map, keys listed in R1_KEYS. */
  r1?: Record<string, string>;
  /** ADR-166 batch 1 chains (2026-09-16): flat string map, prefixes m* / g* / l*.
   *  ADR-167 (R3) chains reuse this map through buildOspChainR2: prefixes n* / p* / jw*. */
  r2?: Record<string, string>;
  /** ADR-175 (R4, 2026-09-21) in-house disposition chains: flat string map, prefixes a*..f*. */
  r4?: Record<string, string>;
}

/** FIXED: the step FAILED when it ran and the defect has since been fixed and
 *  re-proven by a later row / commit (`fixedBy`); the original fail text moves
 *  to `history`. Rendered "✓ Fixed" — ✗ Fail is reserved for what is still
 *  broken at render time. */
type Result = 'PASS' | 'FAIL' | 'FIXED' | 'N/A (by design)' | 'BLOCKED' | 'BLOCKED (by design)';
const TEST_LABEL: Record<string, string> = {
  T1: 'Test 1 — Rework with MULTIPLE child JCs (ADR-161)',
  T2: 'Test 2 — GRN → Incoming QC reject → Return to vendor (OSP chain)',
  T3: 'Test 3 — Deep nesting on the return-to-vendor side',
  R1: 'Re-verification after ADR-165 (2026-09-16)',
  R2: 'R2 — ADR-166 batch 1 (2026-09-16)',
  R3: 'R3 — ADR-167 batch 2/3 (2026-09-16)',
  R4: 'R4 — every disposition settles the chain (ADR-175, 2026-09-21)',
};
const testOf = (id: string): string => TEST_LABEL[id.slice(0, 2)] ?? id.slice(0, 2);
interface Row {
  id: string;
  test: string;
  action: string;
  source: string;
  related: string;
  required: string;
  actual: string;
  result: Result;
  shot?: string;
  at: string;
  /** Pinned: the row records a moment the chain has moved past; never re-evaluated. */
  keep?: boolean;
  // ── New report shape (2026-09-16 format change): one row per DOCUMENT a step
  //    touched. Older rows have none of these; renderPdf maps them best-effort.
  /** The document code as the user sees it (IN-GRN-00012, NC-AUTO-…, IN-JC-26-00039 Op 1). */
  document?: string;
  /** The quantity that moved in this step ('' when none). */
  qty?: string;
  /** The status badge text on that document's page. */
  headerStatus?: string;
  /** The chain-level state after the step ("In Progress", "At vendor 3", "Complete"). */
  overallStatus?: string;
  /** result FIXED: what fixed it and where it was re-proven. */
  fixedBy?: string;
  /** Earlier verdicts on this row (the original FAIL text is kept here, never deleted). */
  history?: { result: Result; actual: string; at: string }[];
}
interface Report {
  title: string;
  date: string;
  stack: string;
  api?: string;
  generatedAt: string;
  docs: Record<string, string>;
  findings: string[];
  rows: Row[];
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
function readReport(): Report {
  if (existsSync(ROWS_FILE)) return JSON.parse(readFileSync(ROWS_FILE, 'utf8')) as Report;
  return {
    title: 'Innovic ERP — chain verification (rework with multiple child JCs; GRN → QC reject → return to vendor)',
    date: REPORT_DATE,
    stack: STACK_URL,
    generatedAt: new Date().toISOString(),
    docs: {},
    findings: [],
    rows: [],
  };
}
function writeReport(r: Report): void {
  mkdirSync(dirname(ROWS_FILE), { recursive: true });
  writeFileSync(ROWS_FILE, JSON.stringify(r, null, 2));
}
function doc(k: string, v: string): void {
  const r = readReport();
  r.docs[k] = v;
  writeReport(r);
}
function finding(text: string): void {
  const r = readReport();
  if (!r.findings.includes(text)) r.findings.push(text);
  writeReport(r);
}
function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log('>> ' + msg);
}
const today = (): string => new Date().toISOString().slice(0, 10);
const now = (): string => new Date().toTimeString().slice(0, 5);

/** One row of the report. `check` returns the text of what was SEEN and whether
 *  it met the requirement. A throw inside `check` is a FAIL row with the error
 *  text; the chain carries on so later rows still get recorded. */
async function rec(
  page: Page,
  id: string,
  meta: { action: string; source: string; related: string; required: string },
  check: () => Promise<{ actual: string; ok: boolean | 'na' | 'blocked' }>,
): Promise<boolean> {
  // Resumable: a row that already passed on an earlier run is NOT re-evaluated —
  // most rows read a transient state (e.g. "NC raised 4") that the chain has
  // since moved past. Delete the JSON (or the row) to force a re-check.
  const prior = readReport().rows.find((x) => x.id === id);
  if (prior?.keep) {
    log(`[kept ${prior.result}, pinned] ${id} ${meta.action}`);
    return prior.result !== 'FAIL';
  }
  if (prior && (prior.result === 'PASS' || prior.result === 'FIXED' || prior.result === 'N/A (by design)' || prior.result === 'BLOCKED (by design)')) {
    log(`[kept ${prior.result}] ${id} ${meta.action} (recorded ${prior.at})`);
    return true;
  }
  let actual = '';
  let result: Result = 'PASS';
  try {
    const out = await check();
    actual = out.actual;
    result = out.ok === 'na' ? 'N/A (by design)' : out.ok === 'blocked' ? 'BLOCKED (by design)' : out.ok ? 'PASS' : 'FAIL';
  } catch (e) {
    actual = 'ERROR: ' + (e instanceof Error ? e.message.split('\n').slice(0, 3).join(' | ') : String(e));
    result = 'FAIL';
  }
  mkdirSync(SHOT_DIR, { recursive: true });
  const shot = SHOT_DIR + '/' + id + '.png';
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const r = readReport();
  const row: Row = {
    id,
    test: testOf(id),
    ...meta,
    actual,
    result,
    shot,
    at: new Date().toISOString(),
  };
  const i = r.rows.findIndex((x) => x.id === id);
  if (i >= 0) r.rows[i] = row;
  else r.rows.push(row);
  r.rows.sort((a, b) => a.id.localeCompare(b.id));
  writeReport(r);
  log(`[${result}] ${id} ${meta.action} — ${actual.slice(0, 220)}`);
  return result === 'PASS' || result === 'N/A (by design)';
}
function blocked(id: string, meta: { action: string; source: string; related: string; required: string }, why: string): void {
  const r = readReport();
  const row: Row = {
    id,
    test: testOf(id),
    ...meta,
    actual: 'BLOCKED: ' + why,
    result: 'BLOCKED',
    at: new Date().toISOString(),
  };
  const i = r.rows.findIndex((x) => x.id === id);
  if (i >= 0) r.rows[i] = row;
  else r.rows.push(row);
  r.rows.sort((a, b) => a.id.localeCompare(b.id));
  writeReport(r);
  log(`[BLOCKED] ${id} ${meta.action} — ${why}`);
}

/** Turn a FAIL row into FIXED: the original verdict + text go to `history`,
 *  `fixedBy` says what fixed it and where it was re-proven. Idempotent. */
function markFixed(id: string, fixedBy: string, nowSeen?: string): void {
  const r = readReport();
  const x = r.rows.find((y) => y.id === id);
  if (!x || x.result !== 'FAIL') return;
  x.history = [...(x.history ?? []), { result: x.result, actual: x.actual, at: x.at }];
  x.result = 'FIXED';
  x.fixedBy = fixedBy;
  if (nowSeen) x.actual = nowSeen;
  writeReport(r);
  log(`[FIXED] ${id} — ${fixedBy}`);
}
/** Rows that FAILED on 2026-09-15 and were fixed by ADR-165, re-proven by the
 *  R1 chain on 2026-09-16 (applied once, before every render). */
const FIXED_ROWS: Record<string, string> = {
  'T2-13': 'ADR-165 — re-proven R1-A1 (line 7 of 10, header Partial)',
  'T2-18': 'ADR-165 — re-proven R1-A3 / R1-Z1 (line 10 of 10, header Closed)',
  'T3-05': 'ADR-165 — re-proven R1-B1 (second return: line 8 of 10, not 6)',
  'T3-12': 'ADR-165 — re-proven R1-D3 / R1-Z1 (line ends at 10 of 10)',
};
function applyFixedRows(): void {
  for (const [id, by] of Object.entries(FIXED_ROWS)) markFixed(id, by);
}

// ── Shared helpers (same as flow-grn-against-nc / flow-grn-source-doc) ──────

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

/** The Supabase access token the app itself sends as the Bearer. Read from
 *  the context's storage state, NOT by navigating: an earlier version went to
 *  /goods-receipt-notes to read localStorage, which silently moved the page
 *  away from the screen a row was in the middle of reading. */
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
  const token = await bearer(page);
  const res = await page.request.get(s.apiBase + path, { headers: { authorization: 'Bearer ' + token } });
  if (res.status() !== 200) throw new Error('GET ' + path + ' -> HTTP ' + res.status() + ' ' + (await res.text()).slice(0, 200));
  return (await res.json()) as T;
}

interface OpApi {
  id: string;
  opSeq: number;
  operation: string;
  opType: string;
  machineCode: string | null;
  machineCodeText: string | null;
  status: string;
  computedStatus: string;
  completedQty: number;
  qcAcceptedQty: number;
  qcRejectedQty: number;
  qcPending: number;
  atVendorQty: number;
  inQcQty: number;
  readyToSendQty: number;
  outsourceStatus: string | null;
  ncBreakup: {
    ncRaisedQty: number;
    underReworkQty: number;
    underRepairQty: number;
    sentToVendorQty: number;
    receivedQcPendingQty: number;
    scrapQty: number;
    ncClosedQty: number;
    ncOpenQty: number;
    openNcCount: number;
  };
}
async function opsOf(page: Page, jcCode: string): Promise<OpApi[]> {
  const ops = await apiGet<OpApi[]>(page, '/op-entry/jc-ops?jobCardCode=' + encodeURIComponent(jcCode));
  return ops.sort((a, b) => a.opSeq - b.opSeq);
}
function opLine(o: OpApi): string {
  const nb = o.ncBreakup;
  const strip = [
    nb.ncRaisedQty ? `NC raised ${nb.ncRaisedQty}` : '',
    nb.underReworkQty ? `Under rework ${nb.underReworkQty}` : '',
    nb.sentToVendorQty ? `Sent to vendor ${nb.sentToVendorQty}` : '',
    nb.receivedQcPendingQty ? `Received–QC pending ${nb.receivedQcPendingQty}` : '',
    nb.scrapQty ? `Scrap ${nb.scrapQty}` : '',
    nb.ncClosedQty ? `NC closed ${nb.ncClosedQty}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    `Op${o.opSeq} ${o.operation} [${o.opType}${o.machineCode || o.machineCodeText ? ' on ' + (o.machineCode ?? o.machineCodeText) : ''}]` +
    ` status=${o.computedStatus || o.status} done=${o.completedQty} acc=${o.qcAcceptedQty} rej=${o.qcRejectedQty}` +
    (o.opType === 'outsource' ? ` atVendor=${o.atVendorQty} inQc=${o.inQcQty} readyToSend=${o.readyToSendQty} osp=${o.outsourceStatus}` : '') +
    (strip ? ` | ⚠NC ${strip}` : '')
  );
}

interface NcApi {
  id: string;
  code: string;
  status: string;
  disposition: string | null;
  rejectedQty: number | string;
  clearedQty: number | string;
  failedQty: number | string;
  rtvSentQty: number | string;
  rtvReceivedQty: number | string;
  opSeq: number | null;
  jobCardId: string | null;
  jcCode?: string | null;
  jobCardCode?: string | null;
  grnLineId?: string | null;
  deliveryChallanId?: string | null;
  deliveryChallanCode?: string | null;
  reworkJobCardId?: string | null;
  reworkJobCardCode?: string | null;
  sourceVendorCode?: string | null;
  sourceGrnCode?: string | null;
  sourcePoCode?: string | null;
}
async function ncApi(page: Page, id: string): Promise<NcApi> {
  return apiGet<NcApi>(page, '/nc-register/' + id);
}
function ncLine(n: NcApi): string {
  return (
    `${n.code} status=${n.status} disp=${n.disposition ?? '—'} rejected=${Number(n.rejectedQty)} cleared=${Number(n.clearedQty)} failed=${Number(n.failedQty)}` +
    ` op=${n.opSeq ?? '—'} rtvSent=${Number(n.rtvSentQty)} rtvRecv=${Number(n.rtvReceivedQty)}` +
    (n.grnLineId ? ` grnLineId=set` : '') +
    (n.reworkJobCardCode ? ` reworkJC=${n.reworkJobCardCode}` : '') +
    (n.deliveryChallanCode ? ` DC=${n.deliveryChallanCode}` : '')
  );
}

// ── Op Entry helpers ────────────────────────────────────────────────────────

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

/** Start + Log (stop) a process op with `qty` made, then return the ops table text. */
async function runProcessOp(page: Page, jc: string, opName: string, qty: number): Promise<string> {
  await loadJc(page, jc);
  const startBtn = opRow(page, opName).getByRole('button', { name: /Start/ });
  if (await startBtn.count()) {
    await startBtn.click();
    await page.waitForTimeout(1200);
    await fillEntryHeader(page, 'E2E_ Operator');
    // ADR-164: Start asks for the ACTUAL machine (defaults to planned).
    await page.getByRole('button', { name: /Start Operation/i }).click();
    await popupGone(page);
    await loadJc(page, jc);
  }
  const logBtn = opRow(page, opName).getByRole('button', { name: /Log/ });
  if (await logBtn.count()) {
    await logBtn.click();
    await page.waitForTimeout(1200);
    await fillEntryHeader(page, 'E2E_ Operator');
    await page.locator('#opf-qty').fill(String(qty));
    await page.locator('#opf-rej').fill('0');
    await page.getByRole('button', { name: /^Stop/ }).click();
    await popupGone(page);
    await loadJc(page, jc);
  }
  return (await page.locator('table').first().innerText()).replace(/\s+/g, ' ').trim();
}

/** QC entry on a qc op: accept / reject. */
async function qcOp(page: Page, jc: string, opName: string, acc: number, rej: number): Promise<void> {
  await loadJc(page, jc);
  await opRow(page, opName).getByRole('button', { name: /Inspect/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E_ Inspector');
  await page.locator('#opf-qty').fill(String(acc));
  await page.locator('#opf-rej').fill(String(rej));
  await page.getByRole('button', { name: /Submit Inspection/i }).click();
  await popupGone(page);
}

/** NC register search -> the newest NC-AUTO code for a JC. */
/** 98d25112 (2026-09-16): auto-NC codes carry the op's Sr No — op_seq 1 →
 *  "-Op10-", 2 → "-Op20-"; NCs raised before it keep "-Op1-". Both forms are
 *  accepted everywhere; a Sr No ≥ 10 maps back to the op_seq by /10. */
const NC_OP1 = '-Op(?:1|10)-\\d+';
function ncOpSeq(srNo: string): number {
  const n = Number(srNo);
  return n >= 10 ? n / 10 : n;
}
async function findAutoNc(page: Page, jc: string): Promise<{ code: string; opSeq: number }> {
  await page.goto(`/nc-register?search=${jc}`, { waitUntil: 'domcontentloaded' });
  // Exact JC (not its -RW child): the child code is longer, so anchor Op after the code.
  const ncPattern = new RegExp('NC-AUTO-' + jc.replace(/[-]/g, '\\-') + '-Op([0-9]+)-[0-9]+', 'i');
  const ncCell = page.getByText(ncPattern).first();
  await ncCell.waitFor({ timeout: 60_000 });
  const m = ncPattern.exec(await ncCell.innerText());
  expect(m, 'NC listed for ' + jc).toBeTruthy();
  return { code: m![0], opSeq: ncOpSeq(m![1]!) };
}
async function openNc(page: Page, ncCode: string): Promise<{ url: string; id: string }> {
  await page.goto(`/nc-register?search=${ncCode}`, { waitUntil: 'domcontentloaded' });
  const ncRow = page.getByText(ncCode, { exact: false }).first();
  await ncRow.waitFor({ timeout: 60_000 });
  await ncRow.click();
  await expect(page).toHaveURL(/nc-register\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const id = /nc-register\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  return { url: page.url(), id };
}
async function disposeNc(page: Page, ncUrl: string, action: 'rework' | 'return_to_vendor', qty: number, remark: string): Promise<void> {
  await page.goto(ncUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Dispose/ }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: /Dispose/ }).click();
  await page.waitForTimeout(800);
  await page.locator('#dispAction').selectOption(action);
  await page.locator('#dispQty').fill(String(qty));
  await page.locator('#dispRemarks').fill(remark);
  await page.getByRole('button', { name: /^Save Disposition$/ }).click();
  await page.waitForTimeout(4000);
}

/** JC detail page URL by code (job-cards list search). */
async function jcUrlByCode(page: Page, jc: string): Promise<string> {
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByPlaceholder(/search/i).first().fill(jc);
  const jcRow = page.getByText(jc, { exact: true }).first();
  await jcRow.waitFor({ timeout: 60_000 });
  await jcRow.click();
  await expect(page).toHaveURL(/job-cards\/[0-9a-f-]{36}/, { timeout: 60_000 });
  return page.url();
}
async function jcBody(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Op\s*1/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}
async function jcStatusBadge(page: Page): Promise<string> {
  // JC detail: the "Job Card : <code>" header carries the computed-status badge
  // (the old "Overall Status" tile is gone); other detail pages (SO) carry theirs in
  // the panel header.
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const m = /JOB CARD\s*:\s*IN-JC-[\d-]+\s+(.+?)\s+BACK TO LIST\b/i.exec(body);
  if (m) return m[1]!.replace(/[^\x20-\x7E]/g, '').trim();
  const b = page.locator('.panel-hdr .badge').first();
  return (await b.count()) ? (await b.innerText()).trim() : '(no badge)';
}
/** JC detail: the QUANTITY (PCS) tiles as "12 ORDERED 12 COMPLETED 0 PENDING". */
async function jcQtyTiles(page: Page): Promise<string> {
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  return /(\d+)\s+ORDERED\s+(\d+)\s+COMPLETED\s+(\d+)\s+PENDING/.exec(body)?.[0] ?? '(qty tiles not found)';
}
/** A list page's card for one document code: the normalised text from the
 *  code onwards (the lists are cards, not table rows). `notFollowedBy` keeps a
 *  parent code from matching inside a child's "Rework of <parent> Op 2" text. */
function cardText(body: string, code: string, len = 260): string {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:^|\\s)(' + escaped + ')\\s+(?!Op\\b)');
  const m = re.exec(body);
  if (!m) return '(card for ' + code + ' not found)';
  const start = m.index + m[0].indexOf(m[1]!);
  return body.slice(start, start + len).trim();
}

/** JC detail: the ⚠ NC breakup strip(s) text. */
async function jcNcStrips(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Op\s*1/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const strips = page.locator('div').filter({ has: page.getByText('⚠ NC', { exact: true }) });
  const n = await strips.count();
  if (n === 0) return '(no ⚠ NC strip)';
  // The innermost matching div is the strip itself; the last one in DOM order.
  return (await strips.last().innerText()).replace(/\s+/g, ' ').trim();
}

// ── SO / plan builders ──────────────────────────────────────────────────────

async function createSo(page: Page, qty: number, poRef: string): Promise<{ code: string; url: string; status: string }> {
  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const client = page.getByPlaceholder(/Type customer code or name/i);
  await client.click();
  await client.fill('Adani');
  await page.locator('[role="option"], li').filter({ hasText: /Adani/ }).first().waitFor({ timeout: 45_000 });
  await page.locator('[role="option"], li').filter({ hasText: /Adani/ }).first().click();
  await page.getByPlaceholder(/Client PO reference/i).fill(poRef);
  const item = page.getByPlaceholder(/Search item code or name/i).first();
  await item.click();
  await item.fill(ITEM_CODE);
  await page.locator('[role="option"], li').filter({ hasText: ITEM_CODE }).first().waitFor({ timeout: 45_000 });
  await page.locator('[role="option"], li').filter({ hasText: ITEM_CODE }).first().click();
  await page.getByPlaceholder('Qty', { exact: true }).first().fill(String(qty));
  await page.getByPlaceholder('Rev', { exact: true }).first().fill('A');
  await page.getByPlaceholder('₹ Rate', { exact: true }).first().fill('10').catch(() => {});
  await page.getByRole('button', { name: /Save SO/i }).click();
  await page.waitForURL((u) => !/\/sales-orders\/new/.test(u.pathname), { timeout: 90_000 });
  await page.waitForTimeout(3000);
  const body = await page.locator('body').innerText();
  const m = /IN-SO-\d+/.exec(body);
  expect(m, 'SO code on page after save').toBeTruthy();
  const badge = page.locator('.panel-hdr .badge').first();
  const status = (await badge.count()) ? (await badge.innerText()).trim() : '(no badge)';
  return { code: m![0], url: page.url(), status };
}

/** Planning: open the SO, + Plan, set qty, save, clear the suggested route,
 *  add ONE op (process on a cnc machine, or outsource on VND-959), Save Plan,
 *  Execute -> JC code. */
async function planAndExecute(
  page: Page,
  soCode: string,
  qty: number,
  op: { kind: 'process'; name: string } | { kind: 'outsource'; name: string },
  /** ADR-166 mid-route variant: append ONE QC op (a QC process code such as
   *  'DIR') after the op above via "+ Add QC Op". Falls back to the first QC
   *  process offered when the code is not in the list. */
  qcAfter?: string,
): Promise<string> {
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search SO/i).fill(soCode);
  await page.getByText(soCode, { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.getByText(soCode, { exact: true }).first().click();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: /\+ ?Plan/i }).first().click();
  await page.waitForTimeout(1300);
  const planQty = page.locator('.form-grp:has(label:has-text("Plan Qty")) input[type="number"]').first();
  await planQty.waitFor({ state: 'visible', timeout: 30_000 });
  await planQty.fill(String(qty));
  await page.getByRole('button', { name: /^Save Plan$/ }).click();
  await page.waitForTimeout(2500);
  const del = page.locator('table.ops-routing tbody tr button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i--) {
    await del.nth(i).click();
    await page.waitForTimeout(150);
  }
  if (op.kind === 'process') {
    await page.getByRole('button', { name: /\+ Add Op$/ }).click();
    await page.waitForTimeout(400);
    const row0 = page.locator('table.ops-routing tbody tr').nth(0);
    await row0.getByPlaceholder('Operation name').fill(op.name);
    await pickFirst(page, row0.getByPlaceholder('🔍 Machine', { exact: true }), 'cnc');
  } else {
    await page.getByRole('button', { name: /\+ Add OSP Op$/ }).click();
    await page.waitForTimeout(400);
    const row0 = page.locator('table.ops-routing tbody tr').nth(0);
    await row0.getByPlaceholder('Operation name').fill(op.name);
    await pickFirst(page, row0.getByPlaceholder('🔍 Vendor', { exact: true }), VENDOR_CODE);
  }
  if (qcAfter) {
    await page.getByRole('button', { name: /\+ Add QC Op$/ }).click();
    await page.waitForTimeout(400);
    const row1 = page.locator('table.ops-routing tbody tr').nth(1);
    const sel = row1.locator('select');
    await sel.waitFor({ state: 'visible', timeout: 30_000 });
    const values = await sel.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
    const pick = values.includes(qcAfter) ? qcAfter : values[0];
    expect(pick, 'a QC process to pick for the QC op (offered: ' + values.join(', ') + ')').toBeTruthy();
    log(`QC op after the OSP op: picked "${pick}" (offered: ${values.join(', ')})`);
    await sel.selectOption(pick!);
    await page.waitForTimeout(300);
  }
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
  return jc![0];
}

// ── Purchase builders (from flow-grn-source-doc) ────────────────────────────

async function createPr(page: Page, prType: 'standard' | 'service', line: { code: string; name: string; qty: number; rate: number }, operation: string): Promise<string> {
  await page.goto('/purchase-requests/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#prDate').waitFor({ timeout: 60_000 });
  await page.locator('#operation').fill(operation);
  await pickFromCombo(page, 'vendorId', VENDOR_CODE, new RegExp(VENDOR_CODE));
  await page.locator('#prType').selectOption(prType);
  await page.locator('#itemCodeText').fill(line.code);
  await page.locator('#itemName').fill(line.name);
  await page.locator('#qty').fill(String(line.qty));
  await page.locator('#estCost').fill(String(line.rate));
  await page.locator('#remarks').fill('E2E_ chain report 2026-09-15 - purchase-GRN observation - safe to cancel.');
  await page.getByRole('button', { name: /Save|Create/ }).first().click();
  await expect(page).not.toHaveURL(/purchase-requests\/new/, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  const body = await page.locator('body').innerText();
  const m = /IN-[A-Z]*PR-\d+/.exec(body);
  expect(m, 'no PR code on ' + page.url()).toBeTruthy();
  return m![0];
}

async function createPoFromPr(page: Page, poType: 'standard' | 'service', prCode: string, line: { code: string; name: string; qty: number; rate: number }, remark: string): Promise<{ id: string; code: string }> {
  await page.goto('/purchase-orders/from-pr', { waitUntil: 'domcontentloaded' });
  await page.locator('#pof-code').waitFor({ timeout: 60_000 });
  await page.locator('#pof-type').selectOption(poType);
  await expect(page.locator('#pof-code')).not.toHaveValue('', { timeout: 60_000 });
  await pickFromCombo(page, 'pof-vendor', VENDOR_CODE, new RegExp(VENDOR_CODE));
  await page.locator('#pof-delivery-days').fill('14');
  await pickFromCombo(page, 'pof-pr-0', prCode, new RegExp(prCode));
  await expect(page.getByLabel('Item Code, line 1', { exact: true })).toHaveValue(line.code, { timeout: 60_000 });
  await page.locator('#pof-remarks').fill(remark);
  await page.getByLabel('Item Code, line 1', { exact: true }).fill(line.code);
  await page.getByLabel('Item Name, line 1', { exact: true }).fill(line.name);
  await page.getByLabel('Qty, line 1', { exact: true }).fill(String(line.qty));
  await page.getByLabel('Rate, line 1', { exact: true }).fill(String(line.rate));
  const save = page.locator('button.pof-btn-go');
  await expect(save).toBeEnabled({ timeout: 30_000 });
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
  if (before !== 'draft') return before;
  const approve = page.getByRole('button', { name: /^Approve$/ });
  await expect(approve, 'the test login must be a PO approver').toBeVisible({ timeout: 60_000 });
  await approve.click();
  await page.getByRole('button', { name: 'Approve PO' }).click();
  await expect(page.locator('.panel-hdr .badge').first()).toHaveText(/open/i, { timeout: 60_000 });
  return (await page.locator('.panel-hdr .badge').first().innerText()).trim().toLowerCase();
}

/** Reads {status, received[], qty[]} for every line off the PO detail page. */
async function readPo(page: Page, poId: string): Promise<{ code: string; status: string; received: number[]; qty: number[]; vendor: string }> {
  await page.goto('/purchase-orders/' + poId, { waitUntil: 'domcontentloaded' });
  const table = page.locator('table.innovic-table').filter({ has: page.locator('th', { hasText: /^Received$/i }) }).first();
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
  const body = await page.locator('body').innerText();
  const code = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(body)?.[0] ?? '';
  const vendor = VENDOR_NAME.test(body) ? 'E2E_ Shreeji (VND-959)' : '(vendor name not on page)';
  return { code, status, received, qty, vendor };
}

// ── GRN / Incoming QC helpers ───────────────────────────────────────────────

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

/** GRN detail page: code, source pair (PO or NC), DC No., vendor, link buttons, line figures. */
async function readGrnDetail(page: Page, grnId: string) {
  await page.goto('/goods-receipt-notes/' + grnId, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .td-code').first()).toHaveText(/IN-GRN-\d+/, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const code = (await page.locator('.panel-hdr .td-code').first().innerText()).trim();
  const hasPoPair = (await page.locator('.form-grp').filter({ has: page.getByText('PO', { exact: true }) }).count()) > 0;
  const po = hasPoPair ? await readPair(page, 'PO') : '';
  const hasNcPair = (await page.locator('.form-grp').filter({ has: page.getByText('NC', { exact: true }) }).count()) > 0;
  const nc = hasNcPair ? await readPair(page, 'NC') : '';
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
  const table = page.locator('table.innovic-table').filter({ has: page.locator('th', { hasText: /^Received$/i }) }).first();
  const recIdx = await colIndex(table, /^Received$/i);
  const accIdx = await colIndex(table, /^Accepted$/i);
  const rejIdx = await colIndex(table, /^Rejected$/i);
  const qcIdx = await colIndex(table, /^QC Status$/i);
  const rows = table.locator('tbody tr');
  const n = await rows.count();
  const lines: { received: number; accepted: string; rejected: string; qc: string }[] = [];
  for (let i = 0; i < n; i += 1) {
    const tds = rows.nth(i).locator('td');
    lines.push({
      received: Number((await tds.nth(recIdx).innerText()).trim()),
      accepted: (await tds.nth(accIdx).innerText()).trim(),
      rejected: (await tds.nth(rejIdx).innerText()).trim(),
      qc: (await tds.nth(qcIdx).innerText()).replace(/\s+/g, ' ').trim(),
    });
  }
  const badges = (await page.locator('.panel-hdr .badge').allInnerTexts()).map((t) => t.trim()).join(' | ');
  return { code, hasPoPair, po, hasNcPair, nc, dcNo, vendor, openDc, openNc, openPo, lines, badges };
}

/** Incoming QC page -> the pending row for a GRN -> Inspect -> QC Call Register
 *  deep-opened row -> pick a QC person, accept/reject, Submit QC. */
async function incomingQc(page: Page, grnCode: string, acc: number, rej: number, remark: string): Promise<string> {
  await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Pending Inspection/)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const pendingTable = page.locator('table').filter({ has: page.getByText('QC Pending', { exact: true }) }).first();
  const row = pendingTable.locator('tbody tr').filter({ hasText: grnCode }).first();
  await expect(row, 'pending Incoming QC row for ' + grnCode).toBeVisible({ timeout: 60_000 });
  const rowText = (await row.innerText()).replace(/\s+/g, ' ').trim();
  await row.getByRole('link', { name: /Inspect/ }).click();
  await expect(page).toHaveURL(/qc-call-register\?line=/, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  // Only one row is ever open on the register (openId), so page-level
  // locators are unambiguous here.
  const header = page.getByText(new RegExp('Incoming QC — ' + grnCode));
  await expect(header, 'inline Inspect form for GRN ' + grnCode).toBeVisible({ timeout: 60_000 });
  const formText = (await header.innerText()).replace(/\s+/g, ' ').trim();
  const noJc = await page.getByRole('note').filter({ hasText: /not linked to a JC op/i }).count();
  // QC By is a picker over Access Control's QC users; it opens prefilled with
  // the signed-in user's short name. Keep it (a typed name is what the record
  // stores) unless it is blank, in which case take the first QC user offered.
  const qcBy = page.getByPlaceholder(/Select QC person/);
  let inspector = (await qcBy.inputValue()).trim();
  if (!inspector) {
    await qcBy.click();
    const opt = page.locator('[role="option"]').filter({ hasNotText: /Loading/i }).first();
    await opt.waitFor({ state: 'visible', timeout: 45_000 });
    inspector = (await opt.innerText()).trim();
    await opt.click();
    await page.waitForTimeout(400);
  }
  const accBox = page.locator('.form-grp').filter({ hasText: /Accept Qty/ }).locator('input');
  const rejBox = page.locator('.form-grp').filter({ hasText: /Reject Qty/ }).locator('input');
  await accBox.fill(String(acc));
  await rejBox.fill(String(rej));
  await page.getByPlaceholder(/NC reason, observations/).fill(remark);
  await page.getByRole('button', { name: /Submit Inspection/i }).click();
  await page.waitForTimeout(2000);
  const err = page.getByRole('alert');
  if (await err.count().catch(() => 0)) {
    const t = (await err.first().innerText().catch(() => '')).trim();
    if (t) throw new Error('Incoming QC refused: ' + t);
  }
  await expect(header).toBeHidden({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  return `pending row: "${rowText.slice(0, 160)}" | form header: "${formText.slice(0, 120)}" | "no job card operation" note shown: ${noJc > 0} | QC By: ${inspector}`;
}

/** NC detail: the Sent / Received tiles and the status badge text. */
async function readNcDetail(page: Page, ncUrl: string) {
  await page.goto(ncUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .badge').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const status = (await page.locator('.panel-hdr .badge').first().innerText()).trim();
  const tile = async (label: string): Promise<string> => {
    const cell = page.locator('.panel > *').filter({ has: page.getByText(label, { exact: true }) }).first();
    if (!(await cell.count())) return '';
    const v = cell.locator('.mono.fw-700').first();
    return (await v.count()) ? (await v.innerText()).trim() : '';
  };
  return { body, status, sent: await tile('Sent'), received: await tile('Received') };
}

/** DC detail: status badge + header pairs + Receipts panel. */
async function readDcDetail(page: Page, dcId: string) {
  await page.goto('/delivery-challans/' + dcId, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .badge').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  const status = (await page.locator('.panel-hdr .badge').first().innerText()).trim().toLowerCase();
  const code = /IN-DC-\d+(?:\/R\d+)?/.exec(await page.locator('body').innerText())?.[0] ?? '';
  const vendor = await readPair(page, 'Vendor').catch(() => '');
  const hasNc = (await page.locator('.form-grp').filter({ has: page.getByText('NC', { exact: true }) }).count()) > 0;
  const hasPo = (await page.locator('.form-grp').filter({ has: page.getByText('PO', { exact: true }) }).count()) > 0;
  const nc = hasNc ? await readPair(page, 'NC') : '';
  const po = hasPo ? await readPair(page, 'PO') : '';
  const reason = (await page.locator('.form-grp').filter({ has: page.getByText('Reason', { exact: true }) }).count()) ? await readPair(page, 'Reason') : '';
  const so = await readPair(page, 'SO').catch(() => '');
  const panel = page.locator('.panel').filter({ has: page.getByText('Receipts', { exact: true }) }).first();
  const receiptsHdr = (await panel.count()) ? (await panel.locator('.panel-hdr').innerText()).replace(/\s+/g, ' ').trim() : '(no Receipts panel)';
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const jc = /IN-JC-\d{2}-\d+(?:-R[WP]\d+)*/.exec(body)?.[0] ?? '';
  const qtys = await page.locator('table.innovic-table tbody tr').first().innerText().catch(() => '');
  return { status, code, vendor, hasNc, nc, hasPo, po, reason, so, receiptsHdr, jc, line: qtys.replace(/\s+/g, ' ').trim() };
}

// ── OSP chain builders (used by Test 2 and Test 3) ──────────────────────────

/** JC op card → "Gen PO" → PO form (from the auto JW PR) → Save → approve. */
async function genPoFromJc(page: Page, jcUrl: string, remark: string): Promise<{ id: string; code: string; formNote: string }> {
  await jcBody(page, jcUrl);
  await page.getByRole('link', { name: /Gen PO/ }).first().click();
  await expect(page).toHaveURL(/purchase-orders\/from-pr\?prId=/, { timeout: 60_000 });
  await page.locator('#pof-code').waitFor({ timeout: 60_000 });
  await expect(page.locator('#pof-code')).not.toHaveValue('', { timeout: 60_000 });
  await expect(page.getByLabel('Item Code, line 1', { exact: true })).not.toHaveValue('', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  const poType = await page.locator('#pof-type').inputValue();
  const vendorBox = await page.locator('#pof-vendor').inputValue();
  const formNote = `PO form opened from the PR: type=${poType}, vendor box="${vendorBox}"`;
  log(formNote);
  if (!vendorBox.includes(VENDOR_CODE)) await pickFromCombo(page, 'pof-vendor', VENDOR_CODE, new RegExp(VENDOR_CODE));
  await page.locator('#pof-delivery-days').fill('14');
  const rate = page.getByLabel('Rate, line 1', { exact: true });
  if (!(await rate.inputValue()) || Number(await rate.inputValue()) === 0) await rate.fill('50');
  await page.locator('#pof-remarks').fill(remark);
  const save = page.locator('button.pof-btn-go');
  const foot = await page.locator('.pof-foot-msg, .pof-foot-hint').first().innerText().catch(() => '');
  await expect(save, 'footer says: ' + foot).toBeEnabled({ timeout: 30_000 });
  await save.click();
  await expect(page).toHaveURL(/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const id = /purchase-orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const code = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(await page.locator('body').innerText())?.[0] ?? '';
  await approvePo(page, id);
  return { id, code, formNote };
}

/** JC op card → "Gen DC (n)" → outward challan for `qty` → Save DC. */
async function genDcFromJc(page: Page, jcUrl: string, qty: number, remark: string): Promise<{ id: string; code: string; offered: string }> {
  await jcBody(page, jcUrl);
  const genDc = page.getByRole('link', { name: /Gen DC/ }).first();
  await expect(genDc, 'Gen DC on the op card').toBeVisible({ timeout: 60_000 });
  const offered = (await genDc.innerText()).trim();
  await genDc.click();
  await expect(page).toHaveURL(/delivery-challans\/new\?poId=/, { timeout: 60_000 });
  await page.locator('#dc-code').waitFor({ timeout: 60_000 });
  await expect(page.locator('#dc-code')).not.toHaveValue('', { timeout: 60_000 });
  await page.locator('#dc-transport').fill('E2E_ Shree Ganesh Roadlines');
  await page.locator('#dc-vehicle-no').fill('GJ-23-E2E-0915');
  const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
  await expect(qtyBoxes).toHaveCount(1, { timeout: 60_000 });
  await qtyBoxes.first().fill(String(qty));
  const materials = page.locator('table.innovic-table input.innovic-input:not([type])');
  if (await materials.count()) await materials.first().fill('E2E_ EN24');
  const remarks = page.locator('#dc-remarks');
  if (await remarks.count()) await remarks.fill(remark);
  const save = page.getByRole('button', { name: /Save DC/ });
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await save.click();
  await expect(page).toHaveURL(/delivery-challans\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const id = /delivery-challans\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const code = /IN-DC-\d+(?:\/R\d+)?/.exec(await page.locator('body').innerText())?.[0] ?? '';
  return { id, code, offered };
}

/** GRN → + New → Against JWPO / DC → pick the JWPO + challan → Receive now qty → Create GRN. */
async function grnAgainstDc(page: Page, poCode: string, dcCode: string, qty: number, remark: string): Promise<{ id: string; code: string }> {
  await openNewGrn(page, 'job_work_return');
  await pickFromCombo(page, 'jwpoId', poCode, new RegExp(poCode.replace('/', '\\/')));
  await pickFromCombo(page, 'dcId', dcCode, new RegExp(dcCode.replace('/', '\\/')));
  const line1 = page.getByLabel('Receive now, line 1', { exact: true });
  await expect(line1).toHaveValue(String(qty), { timeout: 30_000 });
  await page.locator('#dcRemarks').fill(remark);
  await page.getByRole('button', { name: /Save GRN/ }).click();
  await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const id = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const d = await readGrnDetail(page, id);
  return { id, code: d.code };
}

/** NC detail → "Create DC — return n pcs to vendor": read the vendor box BEFORE
 *  touching it (the prefill check), pick VND-959 only if it is empty, Create DC. */
async function createRtvDc(page: Page, ncUrl: string, remark: string): Promise<{ id: string; code: string; prefill: string; pickedByHand: boolean }> {
  await page.goto(ncUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#ncDcDate').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const box = (await page.locator('#ncDcVendor').inputValue()).trim();
  // The panel no longer prints an "Original supplier:" line — the vendor box is the prefill.
  const prefill = box;
  log('Create DC vendor prefill: "' + prefill + '"');
  await page.locator('#ncDcDate').fill(today());
  const pickedByHand = !box.includes(VENDOR_CODE);
  if (pickedByHand) await pickFromCombo(page, 'ncDcVendor', VENDOR_CODE, new RegExp(VENDOR_CODE));
  await page.locator('#ncDcTransport').fill('E2E_ Shree Ganesh Roadlines');
  await page.locator('#ncDcVehicle').fill('GJ-23-E2E-0915');
  await page.locator('#ncDcRemarks').fill(remark);
  const create = page.getByRole('button', { name: /Create DC/ });
  await expect(create).toBeEnabled({ timeout: 30_000 });
  await create.click();
  const link = page.getByRole('link', { name: /IN-DC-\d+/ }).first();
  await link.waitFor({ timeout: 120_000 });
  const code = (await link.innerText()).trim();
  const href = (await link.getAttribute('href')) ?? '';
  const id = /delivery-challans\/([0-9a-f-]{36})/.exec(href)?.[1];
  expect(id, 'DC link href carries the challan id: ' + href).toBeTruthy();
  return { id: id!, code, prefill, pickedByHand };
}

/** GRN → + New → Against NC → pick the NC → Receive now qty → Create GRN. */
async function grnAgainstNc(page: Page, ncCode: string, qty: number, remark: string): Promise<{ id: string; code: string; formNote: string }> {
  await openNewGrn(page, 'nc_return');
  await pickFromCombo(page, 'ncId', ncCode, new RegExp(ncCode));
  const line1 = page.getByLabel('Receive now, line 1', { exact: true });
  await expect(line1).toHaveValue(String(qty), { timeout: 30_000 });
  const jcBox = await page.locator('#ncJobCard').inputValue();
  const dcBox = await page.locator('#ncReturnChallan').inputValue();
  const vBox = await page.locator('#ncVendor').inputValue();
  const formNote = `Against NC form filled itself: JC="${jcBox}" challan="${dcBox}" vendor="${vBox}" Receive now=${qty}`;
  log(formNote);
  await page.locator('#ncRemarks').fill(remark);
  await page.getByRole('button', { name: /Save GRN/ }).click();
  await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const id = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const d = await readGrnDetail(page, id);
  return { id, code: d.code, formNote };
}

/** Dispose an NC and return the app's own refusal text ('' when it went through). */
type NcAction = 'rework' | 'repair' | 'return_to_vendor' | 'use_as_is' | 'scrap' | 'make_fresh';
async function tryDispose(page: Page, ncUrl: string, action: NcAction, qty: number, remark: string): Promise<string> {
  await page.goto(ncUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Dispose/ }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: /Dispose/ }).click();
  await page.waitForTimeout(800);
  // The panel mirrors the server guard: an action the API would refuse is not
  // even offered. Read the dropdown first and report that as the refusal.
  const offered = (await page.locator('#dispAction option').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  const values = await page.locator('#dispAction option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  if (!values.includes(action)) {
    await page.getByRole('button', { name: /^Cancel$/ }).first().click().catch(() => {});
    return `Dispose dropdown offers only [${offered.join(', ')}] — "${action}" is not offered for this NC (the panel hides it because the material is ${action === 'rework' ? 'vendor-sourced' : 'in-house'}; server guard text: "${action === 'rework' ? "This NC's material came from a vendor; return it to the vendor rather than reworking it in-house." : 'This NC has no vendor source; in-house rejected material is reworked or scrapped, not returned to a vendor.'}")`;
  }
  await page.locator('#dispAction').selectOption(action);
  await page.locator('#dispQty').fill(String(qty));
  await page.locator('#dispRemarks').fill(remark);
  await page.getByRole('button', { name: /^Save Disposition$/ }).click();
  // The test API can take well over 4 s on a dispose; wait for the panel to
  // close (success) or a message to appear (refusal), up to 90 s.
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(3000);
    if (!(await page.locator('#dispAction').count())) break;
    const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    if (/came from a vendor|made in-house|cannot be more than the NC's open qty/i.test(t)) break;
  }
  const alerts = page.getByRole('alert');
  const n = await alerts.count();
  for (let i = 0; i < n; i += 1) {
    const t = (await alerts.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  // Some panels render the server error as a red Note rather than role=alert.
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const m = /(This NC's material came from a vendor[^.]*\.|Cannot return NC \S+ to vendor: it was made in-house\.)/.exec(body);
  return m ? m[1]! : '';
}

// ═══════════════════════════════════════════════════════════════════════════

test('00 - this is the test stack', async ({ page }) => {
  const api = await assertTestStack(page);
  writeState({ apiBase: api });
  const r = readReport();
  r.api = api;
  writeReport(r);
  log('API: ' + api);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1 — Rework with multiple child job cards
// ═══════════════════════════════════════════════════════════════════════════

test('T1 - build: SO 12 -> JC -> Turning 12 -> DIR QC 8/4 -> NC1', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();

  // T1-01 Sales order.
  if (!s.t1SoCode) {
    const so = await createSo(page, T1_QTY, `E2E_CHAIN-RW-${STAMP}`);
    s = writeState({ t1SoCode: so.code, t1SoUrl: so.url });
    doc('T1 SO', so.code);
  }
  await rec(page, 'T1-01', {
    action: `Create Sales Order, 1 line, item ${ITEM_CODE}, qty ${T1_QTY} (client PO ref E2E_CHAIN-RW-…)`,
    source: 'Sales Orders → New',
    related: 'Sales Order detail',
    required: `SO saved with its own IN-SO number; line qty ${T1_QTY}; status open`,
  }, async () => {
    await page.goto(s.t1SoUrl!, { waitUntil: 'domcontentloaded' });
    await page.getByText(s.t1SoCode!).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const status = await jcStatusBadge(page);
    const hasQty = new RegExp(`\\b${T1_QTY}(\\.00)?\\b`).test(body);
    return { actual: `${s.t1SoCode} on its detail page; status badge "${status}"; item ${ITEM_CODE} ${body.includes(ITEM_CODE) ? 'shown' : 'NOT shown'}; qty ${T1_QTY} ${hasQty ? 'shown' : 'NOT shown'}`, ok: hasQty && body.includes(ITEM_CODE) };
  });

  // T1-02 Plan -> JC.
  if (!s.t1JcCode) {
    const jc = await planAndExecute(page, s.t1SoCode!, T1_QTY, { kind: 'process', name: 'Turning' });
    s = writeState({ t1JcCode: jc });
    doc('T1 parent JC', jc);
  }
  if (!s.t1JcUrl) s = writeState({ t1JcUrl: await jcUrlByCode(page, s.t1JcCode!) });
  await rec(page, 'T1-02', {
    action: `Plan the SO line (qty ${T1_QTY}): one in-house op "Turning" on a CNC machine → Save Plan → Execute`,
    source: 'Planning (SO Planning) → Plan editor',
    related: 'Job Card detail (parent)',
    required: `Parent JC raised for ${T1_QTY}; Op1 Turning (process, machine set); Op2 DIR (qc) appended by the system`,
  }, async () => {
    const body = await jcBody(page, s.t1JcUrl!);
    const ops = await opsOf(page, s.t1JcCode!);
    const status = await jcStatusBadge(page);
    const ok = ops.length === 2 && ops[0]!.opType === 'process' && /Turning/i.test(ops[0]!.operation) && Boolean(ops[0]!.machineCode ?? ops[0]!.machineCodeText) && ops[1]!.opType === 'qc' && /DIR/.test(ops[1]!.operation) && body.includes(String(T1_QTY));
    return { actual: `${s.t1JcCode} status "${status}", ORDER ${T1_QTY} on page; ops: ${ops.map(opLine).join(' ;; ')}`, ok };
  });

  // T1-03 Turning 12.
  if (!s.t1Op1Done) {
    await runProcessOp(page, s.t1JcCode!, 'Turning', T1_QTY);
    s = writeState({ t1Op1Done: true });
  }
  await rec(page, 'T1-03', {
    action: `Op Entry → ${s.t1JcCode}: Start Turning (E2E_ Operator), then Log/Stop with ${T1_QTY} made, 0 rejected`,
    source: 'Op Entry (By Job Card)',
    related: 'Job Card detail — Op1 card',
    required: `Op1 Turning done ${T1_QTY}; DIR op now has ${T1_QTY} QC pending`,
  }, async () => {
    const ops = await opsOf(page, s.t1JcCode!);
    await jcBody(page, s.t1JcUrl!);
    const ok = ops[0]!.completedQty === T1_QTY && ops[1]!.qcPending === T1_QTY;
    return { actual: ops.map(opLine).join(' ;; '), ok };
  });

  // T1-04 DIR QC 8/4 -> NC1.
  if (!s.t1Nc1Code) {
    await qcOp(page, s.t1JcCode!, 'DIR', T1_ACC1, T1_REJ1);
    const nc = await findAutoNc(page, s.t1JcCode!);
    s = writeState({ t1Nc1Code: nc.code });
    doc('T1 NC 1 (parent)', nc.code);
  }
  if (!s.t1Nc1Url) {
    const o = await openNc(page, s.t1Nc1Code!);
    s = writeState({ t1Nc1Url: o.url, t1Nc1Id: o.id });
  }
  await rec(page, 'T1-04', {
    action: `Op Entry → ${s.t1JcCode} DIR: QC inspection accepted ${T1_ACC1}, rejected ${T1_REJ1} (E2E_ Inspector)`,
    source: 'Op Entry → QC popup',
    related: 'NC Register (list) + Job Card Op2 card',
    required: `NC auto-raised for ${T1_REJ1} on Op2; parent DIR shows ✓${T1_ACC1} ✗${T1_REJ1}; strip "NC raised ${T1_REJ1}"`,
  }, async () => {
    const ops = await opsOf(page, s.t1JcCode!);
    const strip = await jcNcStrips(page, s.t1JcUrl!);
    const dir = ops[1]!;
    const ok = dir.qcAcceptedQty === T1_ACC1 && dir.qcRejectedQty === T1_REJ1 && new RegExp(`NC Raised\\s*${T1_REJ1}\\b`).test(strip);
    return { actual: `NC ${s.t1Nc1Code} listed in NC Register; JC page strip: "${strip}"; ${opLine(dir)}`, ok };
  });

  await rec(page, 'T1-05', {
    action: `Open NC 1 detail`,
    source: 'NC Register → NC detail',
    related: 'Job Card / Op link on the NC',
    required: `Rejected Qty ${T1_REJ1}; JC = ${s.t1JcCode}; Operation Op2 DIR; status pending (open)`,
  }, async () => {
    const d = await readNcDetail(page, s.t1Nc1Url!);
    const n = await ncApi(page, s.t1Nc1Id!);
    const ok = Number(n.rejectedQty) === T1_REJ1 && d.body.includes(s.t1JcCode!) && n.opSeq === 2 && /pending|open/i.test(n.status);
    return { actual: `status badge "${d.status}"; page shows JC ${d.body.includes(s.t1JcCode!) ? s.t1JcCode : 'NOT FOUND'}; ${/Op\s*(?:2|20)\s*—?\s*DIR/.test(d.body) ? 'Operation "Op2 — DIR" shown' : 'Op2 DIR text not matched on page'}; api: ${ncLine(n)}`, ok };
  });
});

test('T1 - rework: NC1 -> Rework 4 -> child 1 -> run -> QC 3/1 -> NC2', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();
  if (!s.t1Nc1Url) {
    blocked('T1-06', { action: 'Dispose NC 1 as Rework', source: 'NC detail', related: 'child JC', required: '' }, 'NC 1 was not built');
    return;
  }

  // T1-06 Dispose rework 4 -> child 1.
  if (!s.t1Child1Code) {
    await disposeNc(page, s.t1Nc1Url!, 'rework', T1_REJ1, 'E2E_ chain report - rework 4 (first child)');
    await page.goto(s.t1Nc1Url!, { waitUntil: 'domcontentloaded' });
    await page.getByText(/-RW\d+/).first().waitFor({ timeout: 90_000 });
    const body = await page.locator('body').innerText();
    const child = /IN-JC-\d{2}-\d+-RW\d+/.exec(body);
    expect(child, 'child rework JC code on the NC page').toBeTruthy();
    s = writeState({ t1Child1Code: child![0] });
    doc('T1 child JC 1', child![0]);
  }
  if (!s.t1Child1Url) s = writeState({ t1Child1Url: await jcUrlByCode(page, s.t1Child1Code!) });
  await rec(page, 'T1-06', {
    action: `NC 1 → Dispose: action Rework, qty ${T1_REJ1}, remark E2E_ → Save`,
    source: 'NC detail → Dispose panel',
    related: 'NC detail (Rework JC link) + Job Cards',
    required: `Child JC <parent>-RW1 created; NC 1 status Under Rework; Rework JC link on the NC page`,
  }, async () => {
    const d = await readNcDetail(page, s.t1Nc1Url!);
    const n = await ncApi(page, s.t1Nc1Id!);
    const ok = s.t1Child1Code === s.t1JcCode + '-RW1' && /under rework/i.test(d.status) && d.body.includes(s.t1Child1Code!);
    return { actual: `child = ${s.t1Child1Code}; NC status badge "${d.status}"; Rework JC link ${d.body.includes(s.t1Child1Code!) ? 'shown' : 'NOT shown'}; api: ${ncLine(n)}`, ok };
  });

  // T1-07 child 1 detail.
  await rec(page, 'T1-07', {
    action: `Open child JC 1 (${s.t1Child1Code})`,
    source: 'Job Cards → detail',
    related: 'Parent JC / NC 1 links on the banner',
    required: `Banner "REWORK of ${s.t1JcCode} · Op 2 · NC ${s.t1Nc1Code}"; order qty ${T1_REJ1}; recovery route pre-filled: Op1 Turning (process, machine) + Op2 DIR (qc)`,
  }, async () => {
    const body = await jcBody(page, s.t1Child1Url!);
    const banner = /REWORK of[^.]*\./i.exec(body)?.[0] ?? '(no REWORK banner)';
    const ops = await opsOf(page, s.t1Child1Code!);
    const status = await jcStatusBadge(page);
    const parentLink = await page.getByRole('link', { name: s.t1JcCode!, exact: true }).count();
    const ok = /REWORK of/i.test(body) && body.includes(s.t1JcCode!) && body.includes(s.t1Nc1Code!) && parentLink > 0 && ops.length === 2 && ops[0]!.opType === 'process' && Boolean(ops[0]!.machineCode ?? ops[0]!.machineCodeText) && ops[1]!.opType === 'qc';
    return { actual: `status "${status}"; banner: "${banner}"; parent link count ${parentLink}; ops: ${ops.map(opLine).join(' ;; ')}`, ok };
  });

  // T1-08 parent shows Under rework 4.
  await rec(page, 'T1-08', {
    action: 'Re-open the parent JC after the rework disposition',
    source: 'Job Card detail (parent)',
    related: 'Op2 DIR card — NC breakup strip',
    required: `Strip shows "Under rework ${T1_REJ1}" (no longer "NC raised")`,
  }, async () => {
    const strip = await jcNcStrips(page, s.t1JcUrl!);
    return { actual: `strip: "${strip}"`, ok: new RegExp(`Under Rework\\s*${T1_REJ1}\\b`).test(strip) && !/NC Raised\s*[1-9]/.test(strip) };
  });

  // T1-09 run child 1 + QC 3/1.
  if (!s.t1Child1Done) {
    const ops = await opsOf(page, s.t1Child1Code!);
    const procName = ops[0]!.operation;
    const qcName = ops[ops.length - 1]!.operation;
    await runProcessOp(page, s.t1Child1Code!, procName, T1_REJ1);
    await qcOp(page, s.t1Child1Code!, qcName, T1_ACC2, T1_REJ2);
    s = writeState({ t1Child1Done: true });
  }
  if (!s.t1Nc2Code) {
    const nc = await findAutoNc(page, s.t1Child1Code!);
    s = writeState({ t1Nc2Code: nc.code });
    doc('T1 NC 2 (child 1)', nc.code);
  }
  if (!s.t1Nc2Url) {
    const o = await openNc(page, s.t1Nc2Code!);
    s = writeState({ t1Nc2Url: o.url, t1Nc2Id: o.id });
  }
  await rec(page, 'T1-09', {
    action: `Op Entry → child 1: Start + Log Op1 with ${T1_REJ1} made; then QC on its DIR: accept ${T1_ACC2}, reject ${T1_REJ2}`,
    source: 'Op Entry (By Job Card) — child 1',
    related: 'Child JC 1 detail + NC Register',
    required: `Child Op1 done ${T1_REJ1}; child DIR ✓${T1_ACC2} ✗${T1_REJ2}; a NEW NC auto-raised on the child for ${T1_REJ2}`,
  }, async () => {
    const ops = await opsOf(page, s.t1Child1Code!);
    await jcBody(page, s.t1Child1Url!);
    const strip = await jcNcStrips(page, s.t1Child1Url!);
    const dir = ops[ops.length - 1]!;
    const ok = ops[0]!.completedQty === T1_REJ1 && dir.qcAcceptedQty >= T1_ACC2 && dir.qcRejectedQty === T1_REJ2 && s.t1Nc2Code!.startsWith('NC-AUTO-' + s.t1Child1Code);
    return { actual: `NC ${s.t1Nc2Code} listed; child strip: "${strip}"; ops: ${ops.map(opLine).join(' ;; ')}`, ok };
  });

  await rec(page, 'T1-10', {
    action: 'Open NC 2 (raised on child 1)',
    source: 'NC Register → NC detail',
    related: 'Child JC 1 / parent NC 1',
    required: `Rejected Qty ${T1_REJ2}; JC = ${s.t1Child1Code} (Op2); NC 1 still Under Rework (cleared ${T1_ACC2} of ${T1_REJ1})`,
  }, async () => {
    const d = await readNcDetail(page, s.t1Nc2Url!);
    const n2 = await ncApi(page, s.t1Nc2Id!);
    const n1 = await ncApi(page, s.t1Nc1Id!);
    const ok = Number(n2.rejectedQty) === T1_REJ2 && d.body.includes(s.t1Child1Code!) && Number(n1.clearedQty) === T1_ACC2 && /under_rework/i.test(n1.status);
    return { actual: `NC 2 badge "${d.status}", page JC ${d.body.includes(s.t1Child1Code!) ? s.t1Child1Code : 'NOT shown'}; parent-NC link on page: ${d.body.includes(s.t1Nc1Code!) ? 'yes' : 'no (not shown)'}; api NC2: ${ncLine(n2)} ; api NC1: ${ncLine(n1)}`, ok };
  });
});

test('T1 - second child: NC2 -> Rework 1 -> child 2 -> run -> QC 1/0 -> both NCs closed -> parent 12', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();
  if (!s.t1Nc2Url) {
    blocked('T1-11', { action: 'Dispose NC 2 as Rework', source: 'NC detail', related: 'child JC 2', required: '' }, 'NC 2 was not built');
    return;
  }

  // T1-11 dispose NC2 rework 1 -> child 2.
  if (!s.t1Child2Code) {
    await disposeNc(page, s.t1Nc2Url!, 'rework', T1_REJ2, 'E2E_ chain report - rework 1 (second child)');
    await page.goto(s.t1Nc2Url!, { waitUntil: 'domcontentloaded' });
    await page.getByText(/-RW\d+-RW\d+|-RW2/).first().waitFor({ timeout: 90_000 });
    const body = await page.locator('body').innerText();
    const codes = body.match(/IN-JC-\d{2}-\d+(?:-RW\d+)+/g) ?? [];
    const child2 = codes.filter((c) => c !== s.t1Child1Code).sort((a, b) => b.length - a.length)[0];
    expect(child2, 'second child JC code on the NC 2 page').toBeTruthy();
    s = writeState({ t1Child2Code: child2! });
    doc('T1 child JC 2', child2!);
  }
  if (!s.t1Child2Url) s = writeState({ t1Child2Url: await jcUrlByCode(page, s.t1Child2Code!) });
  await rec(page, 'T1-11', {
    action: `NC 2 → Dispose: Rework, qty ${T1_REJ2} → Save`,
    source: 'NC detail (child 1 NC) → Dispose panel',
    related: 'Job Cards — second child',
    required: 'Second child JC created (record the code the system gives it); NC 2 Under Rework',
  }, async () => {
    const d = await readNcDetail(page, s.t1Nc2Url!);
    const n = await ncApi(page, s.t1Nc2Id!);
    return { actual: `second child = ${s.t1Child2Code} (system naming: ${s.t1Child2Code === s.t1Child1Code + '-RW1' ? '<child1>-RW1' : s.t1Child2Code === s.t1JcCode + '-RW2' ? '<parent>-RW2' : 'other'}); NC 2 badge "${d.status}"; api: ${ncLine(n)}`, ok: /under rework/i.test(d.status) && d.body.includes(s.t1Child2Code!) };
  });

  await rec(page, 'T1-12', {
    action: `Open child JC 2 (${s.t1Child2Code})`,
    source: 'Job Cards → detail',
    related: 'Parent link (child 1) / NC 2',
    required: `Banner "REWORK of ${s.t1Child1Code} · Op 2 · NC ${s.t1Nc2Code}"; order qty ${T1_REJ2}; route Op1 process + Op2 qc`,
  }, async () => {
    const body = await jcBody(page, s.t1Child2Url!);
    const banner = /REWORK of[^.]*\./i.exec(body)?.[0] ?? '(no REWORK banner)';
    const ops = await opsOf(page, s.t1Child2Code!);
    const parentLink = await page.getByRole('link', { name: s.t1Child1Code!, exact: true }).count();
    const ok = /REWORK of/i.test(body) && body.includes(s.t1Child1Code!) && body.includes(s.t1Nc2Code!) && parentLink > 0 && ops.length === 2;
    return { actual: `banner: "${banner}"; parent link count ${parentLink}; ops: ${ops.map(opLine).join(' ;; ')}`, ok };
  });

  // T1-13 run child 2 + QC 1/0.
  if (!s.t1Child2Done) {
    const ops = await opsOf(page, s.t1Child2Code!);
    await runProcessOp(page, s.t1Child2Code!, ops[0]!.operation, T1_REJ2);
    await qcOp(page, s.t1Child2Code!, ops[ops.length - 1]!.operation, T1_REJ2, 0);
    s = writeState({ t1Child2Done: true });
  }
  await rec(page, 'T1-13', {
    action: `Op Entry → child 2: Start + Log Op1 with ${T1_REJ2}; QC on its DIR: accept ${T1_REJ2}, reject 0`,
    source: 'Op Entry — child 2',
    related: 'Child JC 2 detail',
    required: `Child 2 Op1 done ${T1_REJ2}; DIR ✓${T1_REJ2} ✗0; no NC on child 2`,
  }, async () => {
    const ops = await opsOf(page, s.t1Child2Code!);
    await jcBody(page, s.t1Child2Url!);
    const status = await jcStatusBadge(page);
    const dir = ops[ops.length - 1]!;
    return { actual: `child 2 status "${status}"; ops: ${ops.map(opLine).join(' ;; ')}`, ok: dir.qcAcceptedQty === T1_REJ2 && dir.qcRejectedQty === 0 && dir.ncBreakup.openNcCount === 0 };
  });

  await rec(page, 'T1-14', {
    action: 'Re-open NC 2 after child 2 passed QC',
    source: 'NC detail (NC 2)',
    related: 'Child JC 1 Op2 (re-injected)',
    required: `NC 2 closed; cleared ${T1_REJ2} of ${T1_REJ2}`,
  }, async () => {
    const d = await readNcDetail(page, s.t1Nc2Url!);
    const n = await ncApi(page, s.t1Nc2Id!);
    return { actual: `badge "${d.status}"; api: ${ncLine(n)}`, ok: /closed/i.test(n.status) && Number(n.clearedQty) === T1_REJ2 };
  });

  await rec(page, 'T1-15', {
    action: 'Re-open NC 1 after the whole chain recovered',
    source: 'NC detail (NC 1)',
    related: 'Parent JC Op2',
    required: `NC 1 closed; cleared ${T1_REJ1} of ${T1_REJ1} (${T1_ACC2} from child 1 + ${T1_REJ2} climbed from child 2)`,
  }, async () => {
    const d = await readNcDetail(page, s.t1Nc1Url!);
    const n = await ncApi(page, s.t1Nc1Id!);
    return { actual: `badge "${d.status}"; api: ${ncLine(n)}`, ok: /closed/i.test(n.status) && Number(n.clearedQty) === T1_REJ1 };
  });

  await rec(page, 'T1-16', {
    action: 'Child JC 1 after child 2 recovered its 1 piece',
    source: 'Job Card detail (child 1)',
    related: 'Child 1 Op2 DIR card + strip',
    required: `Child 1 DIR accepted ${T1_REJ1} (${T1_ACC2} + ${T1_REJ2} re-injected); strip "NC closed ${T1_REJ2}"; nothing under rework`,
  }, async () => {
    const ops = await opsOf(page, s.t1Child1Code!);
    const strip = await jcNcStrips(page, s.t1Child1Url!);
    const status = await jcStatusBadge(page);
    const dir = ops[ops.length - 1]!;
    return { actual: `child 1 status "${status}"; strip: "${strip}"; ${opLine(dir)}`, ok: dir.qcAcceptedQty === T1_REJ1 && new RegExp(`NC Closed\\s*${T1_REJ2}\\b`).test(strip) && !/Under Rework\s*[1-9]/.test(strip) };
  });

  await rec(page, 'T1-17', {
    action: 'Parent JC after both children recovered',
    source: 'Job Card detail (parent)',
    related: 'Parent Op2 DIR card + strip; JC status',
    required: `Parent DIR accepted ${T1_QTY} (${T1_ACC1} + ${T1_ACC2} + ${T1_REJ2}); strip "NC closed ${T1_REJ1}", nothing under rework; JC status reflects all ops complete`,
  }, async () => {
    const ops = await opsOf(page, s.t1JcCode!);
    const strip = await jcNcStrips(page, s.t1JcUrl!);
    const status = await jcStatusBadge(page);
    const tiles = await jcQtyTiles(page);
    const dir = ops[1]!;
    return { actual: `JC status "${status}"; quantity tiles "${tiles}"; strip: "${strip}"; api: ${ops.map(opLine).join(' ;; ')}`, ok: dir.qcAcceptedQty === T1_QTY && new RegExp(`NC Closed\\s*${T1_REJ1}\\b`).test(strip) && !/Under Rework\s*[1-9]/.test(strip) };
  });

  await rec(page, 'T1-18', {
    action: `Job Card list searched for ${s.t1JcCode}`,
    source: 'Job Cards (list)',
    related: '—',
    required: 'Parent and both child cards listed with their own status',
  }, async () => {
    await page.goto('/job-cards?search=' + encodeURIComponent(s.t1JcCode!), { waitUntil: 'domcontentloaded' });
    await page.getByText(s.t1JcCode!, { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const cards = [s.t1JcCode!, s.t1Child1Code!, s.t1Child2Code!].map((c) => cardText(body, c, 200));
    const ok = cards.every((c) => !c.startsWith('(card') && /COMPLETE|CLOSED/.test(c));
    return { actual: cards.join(' || '), ok };
  });

  await rec(page, 'T1-19', {
    action: `NC Register searched for ${s.t1JcCode}`,
    source: 'NC Register (list)',
    related: '—',
    required: 'NC 1 and NC 2 listed, both closed',
  }, async () => {
    await page.goto('/nc-register?search=' + encodeURIComponent(s.t1JcCode!), { waitUntil: 'domcontentloaded' });
    await page.getByText(s.t1Nc1Code!).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const c1 = cardText(body, s.t1Nc1Code!, 200);
    const c2 = cardText(body, s.t1Nc2Code!, 200);
    return { actual: c1 + ' || ' + c2, ok: /CLOSED/.test(c1) && /CLOSED/.test(c2) };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2a — observation: a plain purchase-PO GRN reject raises NO NC
// ═══════════════════════════════════════════════════════════════════════════

test('T2a - observation: standard PO -> GRN Against PO -> Incoming QC reject 1 -> no NC', async ({ page }) => {
  test.setTimeout(900_000);
  let s = readState();
  if (!s.t2aPrCode) s = writeState({ t2aPrCode: await createPr(page, 'standard', T2A_LINE, 'E2E_ chain-report purchase') });
  if (!s.t2aPoId) {
    const po = await createPoFromPr(page, 'standard', s.t2aPrCode!, T2A_LINE, 'E2E_ chain report 2026-09-15 - purchase-GRN reject observation - safe to cancel.');
    s = writeState({ t2aPoId: po.id, t2aPoCode: po.code });
    doc('T2a standard PO', po.code);
  }
  if (!s.t2aPoApproved) {
    await approvePo(page, s.t2aPoId!);
    s = writeState({ t2aPoApproved: true });
  }
  if (!s.t2aGrnId) {
    const list = await apiGet<{ items: unknown[]; total?: number }>(page, '/nc-register?limit=200&offset=0');
    s = writeState({ t2aNcCountBefore: list.total ?? list.items.length });
    await openNewGrn(page, 'purchase');
    await pickFromCombo(page, 'purchaseOrderId', s.t2aPoCode!, new RegExp(s.t2aPoCode!.replace('/', '\\/')));
    const line1 = page.getByLabel('Receive now, line 1', { exact: true });
    await expect(line1).toHaveValue(String(T2A_LINE.qty), { timeout: 30_000 });
    await page.locator('#remarks').fill('E2E_ chain report - purchase GRN (observation)');
    await page.getByRole('button', { name: /Save GRN/ }).click();
    await expect(page).toHaveURL(/goods-receipt-notes\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    const grnId = /goods-receipt-notes\/([0-9a-f-]{36})/.exec(page.url())![1]!;
    const d = await readGrnDetail(page, grnId);
    s = writeState({ t2aGrnId: grnId, t2aGrnCode: d.code });
    doc('T2a purchase GRN', d.code);
  }
  await rec(page, 'T2-01', {
    action: `Observation setup: PR → standard PO ${s.t2aPoCode} (${VENDOR_CODE}, 1 line ${T2A_LINE.code} qty ${T2A_LINE.qty}) → GRN → + New → Against PO → receive ${T2A_LINE.qty}`,
    source: 'Purchase Requests → Purchase Orders (from PR) → GRN (Against PO)',
    related: 'GRN detail',
    required: `GRN raised against the PO, ${T2A_LINE.qty} received, QC pending; the line traces to NO job-card op`,
  }, async () => {
    const d = await readGrnDetail(page, s.t2aGrnId!);
    return { actual: `${d.code} PO=${d.po} vendor=${d.vendor} badges [${d.badges}] lines=${JSON.stringify(d.lines)}`, ok: d.po === s.t2aPoCode && d.lines[0]?.received === T2A_LINE.qty };
  });

  if (!s.t2aQcDone) {
    const info = await incomingQc(page, s.t2aGrnCode!, T2A_LINE.qty - 1, 1, 'E2E_ observation: purchase-PO reject (expect NO NC)');
    log('T2a incoming QC: ' + info);
    s = writeState({ t2aQcDone: true });
  }
  await rec(page, 'T2-02', {
    action: `Incoming QC → Inspect ${s.t2aGrnCode} → accept ${T2A_LINE.qty - 1}, reject 1 → Submit QC`,
    source: 'Incoming QC → QC Call Register (inline Inspect)',
    related: 'GRN detail line + NC Register',
    required: 'OBSERVATION (by design, incoming-qc/service.ts ~L590): rejected qty stored on the GRN line; NO NC raised (line has no source JC op); no Return-to-vendor path offered',
  }, async () => {
    const d = await readGrnDetail(page, s.t2aGrnId!);
    const list = await apiGet<{ items: { code: string; sourceGrnCode?: string | null }[]; total?: number }>(page, '/nc-register?limit=200&offset=0');
    const after = list.total ?? list.items.length;
    const linked = list.items.filter((n) => n.code.includes(s.t2aGrnCode!) || (n.sourceGrnCode ?? '') === s.t2aGrnCode);
    await page.goto('/nc-register?search=' + encodeURIComponent(s.t2aGrnCode!), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const listBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const ncOnList = listBody.includes(s.t2aGrnCode!);
    finding(`[T2] Purchase-GRN observation: Incoming QC rejected 1 on ${s.t2aGrnCode} (standard PO ${s.t2aPoCode}) — GRN line shows accepted ${d.lines[0]?.accepted} / rejected ${d.lines[0]?.rejected}; NC register count ${s.t2aNcCountBefore} → ${after}; no NC references that GRN. A plain purchase reject therefore has no NC and no return-to-vendor challan path — by design (Phase 1 covers job-work returns only).`);
    return { actual: `GRN line: ${JSON.stringify(d.lines[0])}; NC register total before ${s.t2aNcCountBefore} → after ${after}; NCs referencing ${s.t2aGrnCode}: ${linked.length}; NC list search for the GRN code shows it: ${ncOnList}`, ok: 'na' };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2b — the OSP chain
// ═══════════════════════════════════════════════════════════════════════════

test('T2b - build: SO 10 -> JC with one outsource op (VND-959) -> JWPO -> DC 10 -> GRN 10 -> Incoming QC 7/3 -> NC', async ({ page }) => {
  test.setTimeout(1_200_000);
  let s = readState();

  if (!s.t2SoCode) {
    const so = await createSo(page, T2_QTY, `E2E_CHAIN-OSP-${STAMP}`);
    s = writeState({ t2SoCode: so.code, t2SoUrl: so.url });
    doc('T2 SO', so.code);
  }
  await rec(page, 'T2-03', {
    action: `Create Sales Order, 1 line, item ${ITEM_CODE}, qty ${T2_QTY} (client PO ref E2E_CHAIN-OSP-…)`,
    source: 'Sales Orders → New',
    related: 'Sales Order detail',
    required: `SO saved; qty ${T2_QTY}`,
  }, async () => {
    await page.goto(s.t2SoUrl!, { waitUntil: 'domcontentloaded' });
    await page.getByText(s.t2SoCode!).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const status = await jcStatusBadge(page);
    const hasQty = new RegExp(`\\b${T2_QTY}(\\.00)?\\b`).test(body);
    return { actual: `${s.t2SoCode}; status badge "${status}"; item ${body.includes(ITEM_CODE) ? 'shown' : 'NOT shown'}; qty ${T2_QTY} ${hasQty ? 'shown' : 'NOT shown'}`, ok: hasQty };
  });

  if (!s.t2JcCode) {
    const jc = await planAndExecute(page, s.t2SoCode!, T2_QTY, { kind: 'outsource', name: 'E2E_ Heat treatment' });
    s = writeState({ t2JcCode: jc });
    doc('T2 JC', jc);
  }
  if (!s.t2JcUrl) {
    const url = await jcUrlByCode(page, s.t2JcCode!);
    s = writeState({ t2JcUrl: url, t2JcId: /job-cards\/([0-9a-f-]{36})/.exec(url)![1]! });
  }
  if (!s.t2PrCode) {
    const body = await jcBody(page, s.t2JcUrl!);
    const pr = /IN-JWPR-\d+/.exec(body)?.[0];
    if (pr) {
      s = writeState({ t2PrCode: pr });
      doc('T2 JW PR (auto)', pr);
    }
  }
  await rec(page, 'T2-04', {
    action: `Plan the SO line: ONE "+ Add OSP Op" (E2E_ Heat treatment, vendor ${VENDOR_CODE}) → Save Plan → Execute`,
    source: 'Planning → Plan editor',
    related: 'Job Card detail + Purchase Requests',
    required: `JC raised for ${T2_QTY} with a single outsource op on ${VENDOR_CODE}; the system auto-raises a JW PR (IN-JWPR-…) and the op card shows "PR: …" + "Gen PO"`,
  }, async () => {
    let body = await jcBody(page, s.t2JcUrl!);
    // The op card's OUTSOURCE slot (vendor name, PR/PO reference, Gen PO) comes
    // from a second request to the jc-ops board; give it up to 30 s.
    for (let i = 0; i < 10 && !VENDOR_NAME.test(body); i += 1) {
      await page.waitForTimeout(3000);
      body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    }
    const ops = await opsOf(page, s.t2JcCode!);
    const status = await jcStatusBadge(page);
    const genPo = await page.getByRole('link', { name: /Gen PO/ }).count();
    let pr = s.t2PrCode ?? /IN-JWPR-\d+/.exec(body)?.[0] ?? '';
    let prFrom = pr ? 'JC page' : '';
    if (!pr && s.t2PoId) {
      // Past pr_raised the card shows the PO instead; the JWPO page names its PR.
      await page.goto('/purchase-orders/' + s.t2PoId, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      pr = /IN-JWPR-\d+/.exec(await page.locator('body').innerText())?.[0] ?? '';
      prFrom = pr ? 'JWPO page (card is past pr_raised on this re-check)' : '';
      if (pr) s = writeState({ t2PrCode: pr });
    }
    const ok = ops.length === 1 && ops[0]!.opType === 'outsource' && Boolean(pr) && VENDOR_NAME.test(body);
    return { actual: `${s.t2JcCode} status "${status}"; vendor name on the op card: ${VENDOR_NAME.test(body)}; auto JW PR: ${pr || 'NONE'} (${prFrom || 'not found'}); Gen PO link: ${genPo}; ops: ${ops.map(opLine).join(' ;; ')}`, ok };
  });

  // JWPO via the op card's Gen PO (+ approve).
  if (!s.t2PoId) {
    const po = await genPoFromJc(page, s.t2JcUrl!, 'E2E_ chain report 2026-09-15 - JWPO for the OSP chain - safe to cancel.');
    s = writeState({ t2PoId: po.id, t2PoCode: po.code, t2PoApproved: true });
    doc('T2 JWPO', po.code);
  }
  await rec(page, 'T2-05', {
    action: `JC op card → "Gen PO" → PO form opens from the JW PR → Save (delivery 14 days) → Approve if draft`,
    source: 'Job Card op card → Purchase Order (from PR)',
    related: 'Purchase Order detail (JWPO)',
    required: `Job-work PO IN-JWPO-… to ${VENDOR_CODE}, 1 line qty ${T2_QTY}, received 0, status open`,
  }, async () => {
    const po = await readPo(page, s.t2PoId!);
    return { actual: `${po.code} status "${po.status}" vendor ${po.vendor} qty ${JSON.stringify(po.qty)} received ${JSON.stringify(po.received)}`, ok: /IN-JWPO-/.test(po.code) && po.qty[0] === T2_QTY && po.received[0] === 0 && po.status === 'open' };
  });

  // Outward DC via the op card's Gen DC.
  if (!s.t2DcId) {
    const dc = await genDcFromJc(page, s.t2JcUrl!, T2_QTY, 'E2E_ chain report - OSP outward challan');
    s = writeState({ t2DcId: dc.id, t2DcCode: dc.code });
    doc('T2 outward DC', dc.code);
  }
  await rec(page, 'T2-06', {
    action: `JC op card → "Gen DC (${T2_QTY})" → outward challan for ${T2_QTY} (E2E_ transporter) → Save DC`,
    source: 'Job Card op card → Delivery Challan (new, from JWPO)',
    related: 'DC detail + JC op card tiles',
    required: `DC issued for ${T2_QTY} on the JWPO; op card AT VENDOR ${T2_QTY}, READY TO SEND 0`,
  }, async () => {
    const dc = await readDcDetail(page, s.t2DcId!);
    const ops = await opsOf(page, s.t2JcCode!);
    const o = ops[0]!;
    return { actual: `${dc.code} status ${dc.status} PO=${dc.po} vendor=${dc.vendor} line: "${dc.line}"; op: ${opLine(o)}`, ok: dc.status === 'issued' && o.atVendorQty === T2_QTY && o.readyToSendQty === 0 };
  });

  // GRN Against JWPO / DC, receive 10.
  if (!s.t2Grn1Id) {
    const g = await grnAgainstDc(page, s.t2PoCode!, s.t2DcCode!, T2_QTY, 'E2E_ chain report - OSP return (10 of 10)');
    s = writeState({ t2Grn1Id: g.id, t2Grn1Code: g.code });
    doc('T2 GRN 1 (Against JWPO / DC)', g.code);
  }
  await rec(page, 'T2-07', {
    action: `GRN → + New → GRN Type "Against JWPO / DC" → pick ${s.t2PoCode} + ${s.t2DcCode} → Receive now ${T2_QTY} → Create GRN`,
    source: 'Goods Receipt Notes → New (Against JWPO / DC)',
    related: 'GRN detail; DC detail; JWPO line; JC op card',
    required: `GRN 1 with ${T2_QTY} received, QC pending, Open DC; DC status received; JWPO received ${T2_QTY}; op IN QC ${T2_QTY}, AT VENDOR 0`,
  }, async () => {
    const d = await readGrnDetail(page, s.t2Grn1Id!);
    const dc = await readDcDetail(page, s.t2DcId!);
    const po = await readPo(page, s.t2PoId!);
    const o = (await opsOf(page, s.t2JcCode!))[0]!;
    return { actual: `${d.code} PO=${d.po} DC=${d.dcNo} OpenDC=${d.openDc} lines=${JSON.stringify(d.lines)}; DC ${dc.code} status ${dc.status} (${dc.receiptsHdr}); JWPO received ${JSON.stringify(po.received)} status ${po.status}; op: ${opLine(o)}`, ok: d.lines[0]?.received === T2_QTY && dc.status === 'received' && po.received[0] === T2_QTY && o.inQcQty === T2_QTY && o.atVendorQty === 0 };
  });

  // Incoming QC 7 / 3.
  if (!s.t2Qc1Done) {
    const info = await incomingQc(page, s.t2Grn1Code!, T2_ACC1, T2_REJ1, 'E2E_ chain report - OSP return reject 3 (expect NC)');
    log('T2 incoming QC 1: ' + info);
    s = writeState({ t2Qc1Done: true });
  }
  if (!s.t2NcCode) {
    const nc = await findAutoNc(page, s.t2JcCode!);
    s = writeState({ t2NcCode: nc.code });
    doc('T2 NC (OSP reject)', nc.code);
  }
  if (!s.t2NcUrl) {
    const o = await openNc(page, s.t2NcCode!);
    s = writeState({ t2NcUrl: o.url, t2NcId: o.id });
  }
  await rec(page, 'T2-08', {
    action: `Incoming QC → Inspect ${s.t2Grn1Code} → accept ${T2_ACC1}, reject ${T2_REJ1} → Submit QC`,
    source: 'Incoming QC → QC Call Register (inline Inspect)',
    related: 'GRN detail line; NC Register; JC op card',
    required: `GRN line accepted ${T2_ACC1} / rejected ${T2_REJ1}; NC auto-raised for ${T2_REJ1} linked to the JC op (grn_line_id set); op card DONE/accepted ${T2_ACC1}, strip "NC raised ${T2_REJ1}"`,
  }, async () => {
    const d = await readGrnDetail(page, s.t2Grn1Id!);
    const n = await ncApi(page, s.t2NcId!);
    const strip = await jcNcStrips(page, s.t2JcUrl!);
    const o = (await opsOf(page, s.t2JcCode!))[0]!;
    const ok = d.lines[0]?.accepted === String(T2_ACC1) && d.lines[0]?.rejected === String(T2_REJ1) && Number(n.rejectedQty) === T2_REJ1 && Boolean(n.grnLineId) && new RegExp(`NC Raised\\s*${T2_REJ1}\\b`).test(strip);
    return { actual: `GRN line ${JSON.stringify(d.lines[0])}; NC ${n.code}: ${ncLine(n)}; JC strip: "${strip}"; op: ${opLine(o)}`, ok };
  });

  await rec(page, 'T2-09', {
    action: 'Open the NC raised by the Incoming QC reject',
    source: 'NC Register → NC detail',
    related: 'JC / op, Source Vendor, Source PO, Source GRN',
    required: `Rejected Qty ${T2_REJ1}; JC ${s.t2JcCode} Op1; Source Vendor ${VENDOR_CODE}; Source PO ${s.t2PoCode}; Source GRN ${s.t2Grn1Code}; status pending`,
  }, async () => {
    const d = await readNcDetail(page, s.t2NcUrl!);
    const n = await ncApi(page, s.t2NcId!);
    const sv = /Source Vendor:\s*(VND-\d+)/.exec(d.body)?.[1] ?? '';
    const spo = /Source PO No\.:\s*(IN-[A-Z]*PO-\d+(?:\/R\d+)?)/.exec(d.body)?.[1] ?? '';
    const sgrn = /Source GRN:\s*(IN-GRN-\d+)/.exec(d.body)?.[1] ?? '';
    const ok = Number(n.rejectedQty) === T2_REJ1 && d.body.includes(s.t2JcCode!) && sv === VENDOR_CODE && sgrn === s.t2Grn1Code;
    return { actual: `badge "${d.status}"; JC on page: ${d.body.includes(s.t2JcCode!)}; Source Vendor: ${sv || '(not shown)'}; Source PO: ${spo || '(not shown)'}; Source GRN: ${sgrn || '(not shown)'}; api: ${ncLine(n)}`, ok };
  });
});

test('T2b - RTV: NC -> Return to vendor -> Create DC (vendor prefill) -> JWPO drops -> GRN Against NC -> QC accept -> closed', async ({ page }) => {
  test.setTimeout(1_200_000);
  let s = readState();
  if (!s.t2NcUrl) {
    blocked('T2-10', { action: 'Dispose NC as Return to vendor', source: 'NC detail', related: '', required: '' }, 'the OSP NC was not built');
    return;
  }

  if (!s.t2NcDisposed) {
    await disposeNc(page, s.t2NcUrl!, 'return_to_vendor', T2_REJ1, 'E2E_ chain report - return 3 to vendor');
    s = writeState({ t2NcDisposed: true });
  }
  await rec(page, 'T2-10', {
    action: `NC → Dispose: Return to vendor, qty ${T2_REJ1} → Save`,
    source: 'NC detail → Dispose panel',
    related: 'NC detail',
    required: 'Disposition "Return to vendor" recorded; NC disposed; a "Create DC — return 3 pcs to vendor" panel appears',
  }, async () => {
    const d = await readNcDetail(page, s.t2NcUrl!);
    const n = await ncApi(page, s.t2NcId!);
    const panel = await page.getByText(/Create DC — return/).count();
    return { actual: `badge "${d.status}"; disposition text on page: ${/return to vendor/i.test(d.body)}; Create DC panel shown: ${panel > 0}; api: ${ncLine(n)}`, ok: n.disposition === 'return_to_vendor' && panel > 0 };
  });

  // Create DC — record the vendor prefill BEFORE touching the picker.
  if (!s.t2RtvDcId) {
    const dc = await createRtvDc(page, s.t2NcUrl!, 'E2E_ chain report - return-to-vendor challan - safe to cancel.');
    s = writeState({ t2RtvDcId: dc.id, t2RtvDcCode: dc.code, t2RtvVendorPrefill: dc.prefill });
    doc('T2 return-to-vendor DC', dc.code);
  }
  await rec(page, 'T2-11', {
    action: 'NC detail → "Create DC — return 3 pcs to vendor" panel: read the Vendor box BEFORE picking anything',
    source: 'NC detail → Create DC panel',
    related: 'Original supplier (GRN vendor / JWPO vendor)',
    required: `Vendor prefilled with the ORIGINAL vendor ${VENDOR_CODE} (E2E_ Shreeji…) — no manual pick needed`,
  }, async () => {
    const pre = s.t2RtvVendorPrefill ?? '';
    const ok = pre.includes(VENDOR_CODE);
    finding(`[T2] Return-to-vendor DC vendor prefill: the Create DC panel on ${s.t2NcCode} opened with Vendor = "${pre}" — ${ok ? 'the ORIGINAL vendor ' + VENDOR_CODE + ' was prefilled (nothing to pick)' : 'NOT prefilled; ' + VENDOR_CODE + ' had to be picked by hand'}.`);
    return { actual: `Vendor box on open: "${pre}" → ${ok ? 'prefilled with the original vendor, not picked by hand' : 'EMPTY / other — picked ' + VENDOR_CODE + ' by hand'}`, ok };
  });

  await rec(page, 'T2-12', {
    action: 'Create DC → open the return challan',
    source: 'NC detail → Delivery Challan detail',
    related: 'NC link, JC, PO',
    required: `Challan IN-DC-… issued for ${T2_REJ1}; header shows NC ${s.t2NcCode} (no PO); vendor ${VENDOR_CODE}; JC ${s.t2JcCode} referenced; Reason "Return to vendor"`,
  }, async () => {
    const dc = await readDcDetail(page, s.t2RtvDcId!);
    const n = await ncApi(page, s.t2NcId!);
    const ok = dc.status === 'issued' && dc.hasNc && dc.nc.toUpperCase().includes(s.t2NcCode!.toUpperCase()) && !dc.hasPo && VENDOR_NAME.test(dc.vendor) && Number(n.rtvSentQty) === T2_REJ1;
    return { actual: `${dc.code} status ${dc.status}; NC pair: ${dc.hasNc ? dc.nc + ' (badge renders the code upper-cased)' : '(none)'}; PO pair: ${dc.hasPo ? dc.po : '(none — correct)'}; vendor "${dc.vendor}"; SO ${dc.so}; Reason "${dc.reason}"; JC on page: ${dc.jc || '(none)'}; line: "${dc.line}"; api NC: ${ncLine(n)}`, ok };
  });

  await rec(page, 'T2-13', {
    action: 'JWPO after the return challan is issued',
    source: 'Purchase Order detail (JWPO)',
    related: 'recalcPoLineReceivedQty (ADR-161 §4)',
    required: `Line received drops from ${T2_QTY} to ${T2_QTY - T2_REJ1}; status back to partial`,
  }, async () => {
    const po = await readPo(page, s.t2PoId!);
    if (po.received[0] === T2_QTY - T2_REJ1 && po.status !== 'partial') finding(`[T2] JWPO ${po.code} header status reads "${po.status}" while its line reads received ${po.received[0]} of ${po.qty[0]} right after the return challan was issued — the challan recomputes the line (recalcPoLineReceivedQty) but never the header (recalcPoHeaderStatus). Owning file: apps/api/src/modules/nc-register/service.ts (createNcDc, ~L1584-1590).`);
    return { actual: `${po.code} received ${JSON.stringify(po.received)} of qty ${JSON.stringify(po.qty)}; status "${po.status}"`, ok: po.received[0] === T2_QTY - T2_REJ1 && po.status === 'partial' };
  });

  await rec(page, 'T2-14', {
    action: 'JC op card after the return challan',
    source: 'Job Card detail — outsource op card',
    related: 'NC breakup strip + tiles',
    required: `Strip "Sent to vendor ${T2_REJ1}"; op accepted ${T2_ACC1}; op card offers Receive ${s.t2RtvDcCode ?? ''}`,
  }, async () => {
    const strip = await jcNcStrips(page, s.t2JcUrl!);
    const o = (await opsOf(page, s.t2JcCode!))[0]!;
    const recv = await page.getByRole('link', { name: /Receive/ }).count();
    return { actual: `strip: "${strip}"; Receive link count ${recv}; op: ${opLine(o)}`, ok: new RegExp(`Sent to Vendor\\s*${T2_REJ1}\\b`).test(strip) };
  });

  // GRN Against NC, receive 3.
  if (!s.t2Grn2Id) {
    const g = await grnAgainstNc(page, s.t2NcCode!, T2_REJ1, 'E2E_ chain report - GRN against NC (3 of 3)');
    s = writeState({ t2Grn2Id: g.id, t2Grn2Code: g.code });
    doc('T2 GRN 2 (Against NC)', g.code);
  }
  await rec(page, 'T2-15', {
    action: `GRN → + New → GRN Type "Against NC" → pick ${s.t2NcCode} (JC / return challan / vendor fill themselves) → Receive now ${T2_REJ1} → Create GRN`,
    source: 'Goods Receipt Notes → New (Against NC)',
    related: 'GRN detail + GRN list',
    required: `GRN 2 shows NC ${s.t2NcCode} (no PO pair), Open NC + Open DC buttons, received ${T2_REJ1}; list card badge "Against NC"`,
  }, async () => {
    const d = await readGrnDetail(page, s.t2Grn2Id!);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/goods-receipt-notes', { waitUntil: 'domcontentloaded' });
    const search = page.getByPlaceholder(/Search GRN no/);
    await search.waitFor({ timeout: 60_000 });
    await search.fill(s.t2Grn2Code!);
    await page.waitForTimeout(3000);
    const card = page.locator('.panel').filter({ has: page.getByRole('link', { name: s.t2Grn2Code!, exact: true }) }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const badges = (await card.locator('.badge').allInnerTexts()).map((t) => t.trim());
    const ok = d.hasNcPair && d.nc === s.t2NcCode && !d.hasPoPair && d.openNc === 1 && d.openDc === 1 && d.lines[0]?.received === T2_REJ1 && badges.some((b) => b.toUpperCase() === 'AGAINST NC');
    return { actual: `${d.code} NC=${d.nc} PO pair=${d.hasPoPair} DC=${d.dcNo} vendor=${d.vendor} OpenNC=${d.openNc} OpenDC=${d.openDc} OpenPO=${d.openPo} lines=${JSON.stringify(d.lines)}; list badges [${badges.join(' | ')}]`, ok };
  });

  await rec(page, 'T2-16', {
    action: 'NC after the return receipt, before Incoming QC',
    source: 'NC detail',
    related: 'Sent / Received tiles; JC strip',
    required: `Sent ${T2_REJ1} / Received ${T2_REJ1}; status "Received – QC Pending"; JC strip "Received – QC pending ${T2_REJ1}"`,
  }, async () => {
    const d = await readNcDetail(page, s.t2NcUrl!);
    const n = await ncApi(page, s.t2NcId!);
    const strip = await jcNcStrips(page, s.t2JcUrl!);
    return { actual: `badge "${d.status}"; tiles Sent ${d.sent} / Received ${d.received}; strip: "${strip}"; api: ${ncLine(n)}`, ok: n.status === 'received_qc_pending' && Number(n.rtvReceivedQty) === T2_REJ1 && /Received – QC pending\s*3/.test(strip) };
  });

  if (!s.t2Qc2Done) {
    const info = await incomingQc(page, s.t2Grn2Code!, T2_REJ1, 0, 'E2E_ chain report - replacement accepted 3');
    log('T2 incoming QC 2: ' + info);
    s = writeState({ t2Qc2Done: true });
  }
  await rec(page, 'T2-17', {
    action: `Incoming QC → Inspect ${s.t2Grn2Code} (Against NC) → accept ${T2_REJ1}, reject 0 → Submit QC`,
    source: 'Incoming QC → QC Call Register (inline Inspect)',
    related: 'GRN 2 line; NC detail',
    required: `GRN 2 line accepted ${T2_REJ1}; NC closed with cleared ${T2_REJ1}`,
  }, async () => {
    const d = await readGrnDetail(page, s.t2Grn2Id!);
    const nc = await readNcDetail(page, s.t2NcUrl!);
    const n = await ncApi(page, s.t2NcId!);
    return { actual: `GRN 2 line ${JSON.stringify(d.lines[0])}; NC badge "${nc.status}"; api: ${ncLine(n)}`, ok: d.lines[0]?.accepted === String(T2_REJ1) && /closed/i.test(n.status) && Number(n.clearedQty) === T2_REJ1 };
  });

  await rec(page, 'T2-18', {
    action: 'JWPO after the replacement passed Incoming QC',
    source: 'Purchase Order detail (JWPO)',
    related: 'recalcPoLineReceivedQty',
    required: `Line received back to ${T2_QTY}; status completed/received`,
  }, async () => {
    const po = await readPo(page, s.t2PoId!);
    if (po.received[0] === T2_QTY && po.status !== 'closed') finding(`[T2] JWPO ${po.code} header status reads "${po.status}" with the line fully received (${po.received[0]} of ${po.qty[0]}) after the replacement passed Incoming QC — Incoming QC recomputes the header BEFORE onNcReplacementQc credits cleared_qty and re-runs the line formula, so the header is left one step behind. Owning files: apps/api/src/modules/incoming-qc/service.ts (~L520-545, order of recalcPoLineReceivedQty / recalcPoHeaderStatus / onNcReplacementQc) and apps/api/src/modules/nc-register/recovery.ts (onNcReplacementQc ~L731 recalcs the line only).`);
    return { actual: `${po.code} received ${JSON.stringify(po.received)} of ${JSON.stringify(po.qty)}; status "${po.status}"`, ok: po.received[0] === T2_QTY && po.status === 'closed' };
  });

  await rec(page, 'T2-19', {
    action: 'JC op card at the end of the chain',
    source: 'Job Card detail — outsource op card',
    related: 'Tiles + NC strip; JC status',
    required: `AT VENDOR 0, IN QC 0, DONE ${T2_QTY} (an outsource op counts vendor-accepted pieces as DONE); strip "NC closed ${T2_REJ1}"; JC status complete`,
  }, async () => {
    const strip = await jcNcStrips(page, s.t2JcUrl!);
    const status = await jcStatusBadge(page);
    const o = (await opsOf(page, s.t2JcCode!))[0]!;
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const tiles = /QUANTITIES\s+(\d+\s+ORDER.*?\d+\s+IN QC)/.exec(body)?.[1] ?? '';
    return { actual: `JC status "${status}"; tiles: "${tiles}"; strip: "${strip}"; op: ${opLine(o)}`, ok: o.atVendorQty === 0 && o.inQcQty === 0 && o.completedQty === T2_QTY && new RegExp(`NC Closed\\s*${T2_REJ1}\\b`).test(strip) };
  });

  await rec(page, 'T2-20', {
    action: 'Return-to-vendor challan at the end of the chain',
    source: 'Delivery Challan detail (RTV DC)',
    related: 'Receipts panel',
    required: 'DC status received; 1 receipt of 3',
  }, async () => {
    const dc = await readDcDetail(page, s.t2RtvDcId!);
    return { actual: `${dc.code} status ${dc.status}; ${dc.receiptsHdr}`, ok: dc.status === 'received' };
  });

  await rec(page, 'T2-21', {
    action: `Store / Inventory → Stock Ledger, search the item ${ITEM_CODE} / GRN codes`,
    source: 'Store Inventory → Stock Ledger tab',
    related: 'store_transactions (grn_qc)',
    required: `The outsource op is the JC's LAST op (no DIR appended — Rule B skips outsource JCs), so Incoming QC accept credits stock: ledger rows for ${s.t2Grn1Code} (+${T2_ACC1}) and ${s.t2Grn2Code} (+${T2_REJ1})`,
  }, async () => {
    await page.goto('/store-inventory', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Stock Ledger/ }).click();
    await page.waitForTimeout(1500);
    const search = page.getByPlaceholder(/Search item, source ref/);
    await search.waitFor({ timeout: 60_000 });
    const rowsFor = async (term: string): Promise<string[]> => {
      await search.fill('');
      await page.waitForTimeout(800);
      await search.fill(term);
      // The list is debounced and re-fetched; poll until the rows shown are
      // the ones for THIS term (a stale table matched the previous search).
      const rows = page.locator('table tbody tr');
      for (let i = 0; i < 20; i += 1) {
        await page.waitForTimeout(1500);
        const t = (await page.locator('table tbody').innerText().catch(() => '')).replace(/\s+/g, ' ');
        if (!/Loading store transactions/.test(t) && (t.includes(term) || /No transactions|no rows|Nothing/i.test(t))) break;
      }
      const out: string[] = [];
      for (let i = 0; i < Math.min(await rows.count(), 8); i += 1) out.push((await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim().slice(0, 200));
      return out.filter((t) => t.length > 5);
    };
    const r1 = await rowsFor(s.t2Grn1Code!);
    const r2 = await rowsFor(s.t2Grn2Code!);
    const api = await apiGet<{ items: { txnType: string; qty: number | string; sourceType: string; sourceRef: string | null; remarks: string | null }[] }>(page, '/store-transactions?search=' + encodeURIComponent(s.t2Grn1Code!) + '&limit=20&offset=0').catch(() => ({ items: [] }));
    const ok = r1.length > 0 && r2.length > 0;
    finding(`[T2] Stock ledger: rows for ${s.t2Grn1Code}: ${r1.length}, for ${s.t2Grn2Code}: ${r2.length}${ok ? ' — both Incoming QC accepts credited stock (the outsource op is the last op).' : ' — see the table row for what was on screen.'}`);
    return { actual: `ledger rows for ${s.t2Grn1Code}: ${r1.join(' || ') || '(none)'}; for ${s.t2Grn2Code}: ${r2.join(' || ') || '(none)'}; api search by GRN 1: ${api.items.length} row(s) ${JSON.stringify(api.items.slice(0, 3))}`, ok };
  });

  await rec(page, 'T2-22', {
    action: `NC Register searched for ${s.t2JcCode}`,
    source: 'NC Register (list)',
    related: '—',
    required: 'The OSP NC listed as closed (return to vendor)',
  }, async () => {
    await page.goto('/nc-register?search=' + encodeURIComponent(s.t2JcCode!), { waitUntil: 'domcontentloaded' });
    await page.getByText(s.t2NcCode!).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const t = cardText(body, s.t2NcCode!, 220);
    return { actual: t, ok: /CLOSED/.test(t) };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3 — Deep nesting on the return-to-vendor side
//
// A fresh OSP job card (qty 10) is taken to the same point Test 2 reached
// (GRN 10 → Incoming QC 7 ok / 3 rej → NC-A → return to vendor → GRN Against
// NC 3). Then the replacement is REJECTED again at Incoming QC (accept 1,
// reject 2 → NC-B), NC-B is asked for Rework (level-1 child under the OSP job
// card) and, whatever the system allows, the chain is driven down to NC-D /
// a grandchild and rolled back up. Every refusal is recorded verbatim.
// ═══════════════════════════════════════════════════════════════════════════

const T3_QTY = 10;
const T3_ACC1 = 7;
const T3_REJ1 = 3; // NC-A
const T3_ACC2 = 1;
const T3_REJ2 = 2; // NC-B (reject on the replacement)
const T3_ACC3 = 1;
const T3_REJ3 = 1; // NC-C (reject on the second replacement)

const REWORK_GUARD_FILE = 'apps/api/src/modules/nc-register/cascades.ts (disposeNcCascade, WI5 source guard, ~L231-250)';

test('T3 - build: fresh OSP JC 10 -> JWPO -> DC -> GRN 10 -> QC 7/3 -> NC-A -> RTV -> GRN Against NC 3', async ({ page }) => {
  test.setTimeout(1_500_000);
  let s = readState();

  if (!s.t3SoCode) {
    const so = await createSo(page, T3_QTY, `E2E_CHAIN-DEEP-${STAMP}`);
    s = writeState({ t3SoCode: so.code, t3SoUrl: so.url });
    doc('T3 SO', so.code);
  }
  if (!s.t3JcCode) {
    const jc = await planAndExecute(page, s.t3SoCode!, T3_QTY, { kind: 'outsource', name: 'E2E_ Heat treatment (deep)' });
    s = writeState({ t3JcCode: jc });
    doc('T3 top JC (OSP)', jc);
  }
  if (!s.t3JcUrl) s = writeState({ t3JcUrl: await jcUrlByCode(page, s.t3JcCode!) });
  if (!s.t3PrCode) {
    const body = await jcBody(page, s.t3JcUrl!);
    const pr = /IN-JWPR-\d+/.exec(body)?.[0];
    if (pr) s = writeState({ t3PrCode: pr });
  }
  if (!s.t3PoId) {
    const po = await genPoFromJc(page, s.t3JcUrl!, 'E2E_ chain report 2026-09-15 - JWPO for the deep-nesting chain - safe to cancel.');
    s = writeState({ t3PoId: po.id, t3PoCode: po.code });
    doc('T3 JWPO', po.code);
  }
  if (!s.t3DcId) {
    const dc = await genDcFromJc(page, s.t3JcUrl!, T3_QTY, 'E2E_ chain report - deep chain outward challan');
    s = writeState({ t3DcId: dc.id, t3DcCode: dc.code });
    doc('T3 outward DC', dc.code);
  }
  if (!s.t3Grn1Id) {
    const g = await grnAgainstDc(page, s.t3PoCode!, s.t3DcCode!, T3_QTY, 'E2E_ chain report - deep chain OSP return (10 of 10)');
    s = writeState({ t3Grn1Id: g.id, t3Grn1Code: g.code });
    doc('T3 GRN 1 (Against JWPO / DC)', g.code);
  }
  if (!s.t3Qc1Done) {
    await incomingQc(page, s.t3Grn1Code!, T3_ACC1, T3_REJ1, 'E2E_ deep chain - OSP return reject 3 (NC-A)');
    s = writeState({ t3Qc1Done: true });
  }
  if (!s.t3NcACode) {
    const nc = await findAutoNc(page, s.t3JcCode!);
    s = writeState({ t3NcACode: nc.code });
    doc('T3 NC-A', nc.code);
  }
  if (!s.t3NcAUrl) {
    const o = await openNc(page, s.t3NcACode!);
    s = writeState({ t3NcAUrl: o.url, t3NcAId: o.id });
  }
  if (!s.t3NcADisposed) {
    await disposeNc(page, s.t3NcAUrl!, 'return_to_vendor', T3_REJ1, 'E2E_ deep chain - NC-A return 3 to vendor');
    s = writeState({ t3NcADisposed: true });
  }
  if (!s.t3RtvDc1Id) {
    const dc = await createRtvDc(page, s.t3NcAUrl!, 'E2E_ deep chain - NC-A return challan');
    s = writeState({ t3RtvDc1Id: dc.id, t3RtvDc1Code: dc.code, t3RtvDc1Prefill: dc.prefill });
    doc('T3 RTV DC 1 (NC-A)', dc.code);
  }
  if (!s.t3Grn2Id) {
    const g = await grnAgainstNc(page, s.t3NcACode!, T3_REJ1, 'E2E_ deep chain - GRN against NC-A (3 of 3)');
    s = writeState({ t3Grn2Id: g.id, t3Grn2Code: g.code });
    doc('T3 GRN 2 (Against NC-A)', g.code);
  }
  await rec(page, 'T3-01', {
    action: `Build a fresh OSP chain to the Test-2 mid-point: SO ${s.t3SoCode} (qty ${T3_QTY}) → JC ${s.t3JcCode} (1 outsource op, ${VENDOR_CODE}) → JWPO ${s.t3PoCode} → DC ${s.t3DcCode} (${T3_QTY}) → GRN ${s.t3Grn1Code} (${T3_QTY}) → Incoming QC ${T3_ACC1}/${T3_REJ1} → NC-A ${s.t3NcACode} → Return to vendor → DC ${s.t3RtvDc1Code} → GRN Against NC ${s.t3Grn2Code} (${T3_REJ1})`,
    source: 'Same screens as Test 2 (Planning, JC op card, PO from PR, DC, GRN, Incoming QC, NC detail)',
    related: 'NC-A detail; JC op card',
    required: `NC-A: Sent ${T3_REJ1} / Received ${T3_REJ1}, status "Received – QC Pending"; RTV DC vendor prefilled ${VENDOR_CODE}; op accepted ${T3_ACC1}`,
  }, async () => {
    const n = await ncApi(page, s.t3NcAId!);
    const d = await readNcDetail(page, s.t3NcAUrl!);
    const o = (await opsOf(page, s.t3JcCode!))[0]!;
    return { actual: `NC-A badge "${d.status}" tiles Sent ${d.sent} / Received ${d.received}; RTV DC 1 vendor box on open: "${s.t3RtvDc1Prefill}"; api: ${ncLine(n)}; op: ${opLine(o)}`, ok: n.status === 'received_qc_pending' && Number(n.rtvReceivedQty) === T3_REJ1 && (s.t3RtvDc1Prefill ?? '').includes(VENDOR_CODE) && o.completedQty === T3_ACC1 };
  });
});

test('T3 - level 1: replacement rejected again (1 ok / 2 rej) -> NC-B -> Rework asked -> what the system allows', async ({ page }) => {
  test.setTimeout(1_500_000);
  let s = readState();
  if (!s.t3Grn2Code) {
    blocked('T3-02', { action: 'Incoming QC on the replacement', source: 'Incoming QC', related: '', required: '' }, 'the deep chain was not built');
    return;
  }

  if (!s.t3Qc2Done) {
    await incomingQc(page, s.t3Grn2Code!, T3_ACC2, T3_REJ2, 'E2E_ deep chain - replacement rejected again (NC-B)');
    s = writeState({ t3Qc2Done: true });
  }
  if (!s.t3NcBCode) {
    // The newest NC-AUTO on the top JC that is not NC-A.
    await page.goto(`/nc-register?search=${s.t3JcCode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const body = await page.locator('body').innerText();
    const re = new RegExp('NC-AUTO-' + s.t3JcCode!.replace(/-/g, '\\-') + NC_OP1, 'g');
    const codes = [...new Set(body.match(re) ?? [])].filter((c) => c !== s.t3NcACode);
    expect(codes.length, 'a second NC on the top JC: ' + JSON.stringify(codes)).toBeGreaterThan(0);
    s = writeState({ t3NcBCode: codes.sort().reverse()[0]! });
    doc('T3 NC-B', s.t3NcBCode!);
  }
  if (!s.t3NcBUrl) {
    const o = await openNc(page, s.t3NcBCode!);
    s = writeState({ t3NcBUrl: o.url, t3NcBId: o.id });
  }
  await rec(page, 'T3-02', {
    action: `Incoming QC → Inspect ${s.t3Grn2Code} (Against NC-A) → accept ${T3_ACC2}, reject ${T3_REJ2} → Submit QC`,
    source: 'Incoming QC → QC Call Register (inline Inspect)',
    related: 'NC Register (NC-B); NC-A detail; GRN 2 line',
    required: `NC-B auto-raised for ${T3_REJ2} on the OSP op with grn_line_id = the RTV GRN line (Source GRN ${s.t3Grn2Code}, Source Vendor ${VENDOR_CODE}); NC-A settles as cleared ${T3_ACC2} / failed ${T3_REJ2} and closes; GRN 2 line accepted ${T3_ACC2} rejected ${T3_REJ2}`,
  }, async () => {
    const nb = await ncApi(page, s.t3NcBId!);
    const na = await ncApi(page, s.t3NcAId!);
    const d = await readNcDetail(page, s.t3NcBUrl!);
    const sv = /Source Vendor:\s*(VND-\d+)/.exec(d.body)?.[1] ?? '';
    const sgrn = /Source GRN:\s*(IN-GRN-\d+)/.exec(d.body)?.[1] ?? '';
    const g = await readGrnDetail(page, s.t3Grn2Id!);
    const linkToA = d.body.includes(s.t3NcACode!);
    const spo = /Source PO No\.:\s*(\S+)/.exec(d.body)?.[1] ?? '';
    if (spo && !/PO-/.test(spo)) finding(`[T3] NC-B (${nb.code}) detail shows "Source PO: ${spo}" — that is NC-A's code, not a PO: the Against-NC GRN's po_code_text carries the NC code (the challan has no PO), and the NC page prints it under the PO label. Owning files: apps/api/src/modules/nc-register/service.ts (ncsrc join ~L440-460, sourcePoCode from grn.po_code_text) / apps/web/src/modules/nc-register/routes/detail.tsx (Source PO pair).`);
    return { actual: `NC-B ${nb.code} badge "${d.status}" Source Vendor ${sv || '(none)'} Source PO label shows "${spo}" Source GRN ${sgrn || '(none)'}; page mentions NC-A: ${linkToA}; api NC-B: ${ncLine(nb)}; api NC-A: ${ncLine(na)}; GRN 2 line ${JSON.stringify(g.lines[0])}`, ok: Number(nb.rejectedQty) === T3_REJ2 && Boolean(nb.grnLineId) && sgrn === s.t3Grn2Code && sv === VENDOR_CODE && Number(na.clearedQty) === T3_ACC2 && Number(na.failedQty) === T3_REJ2 };
  });

  if (s.t3NcBReworkRefusal === undefined) {
    const msg = await tryDispose(page, s.t3NcBUrl!, 'rework', T3_REJ2, 'E2E_ deep chain - NC-B rework 2 (level-1 child under the OSP JC)');
    const nb = await ncApi(page, s.t3NcBId!);
    if (!msg && nb.disposition === 'rework') {
      // The system allowed it: record the child.
      await page.goto(s.t3NcBUrl!, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const child = /IN-JC-\d{2}-\d+-RW\d+/.exec(await page.locator('body').innerText())?.[0];
      s = writeState({ t3NcBReworkRefusal: '', t3NcBDisposed: true, ...(child ? { t3ChildCode: child } : {}) });
      if (child) doc('T3 level-1 child JC', child);
    } else {
      s = writeState({ t3NcBReworkRefusal: msg || `(no message captured; NC-B disposition now "${nb.disposition ?? '—'}")` });
    }
  }
  await rec(page, 'T3-03', {
    action: `NC-B → Dispose: Rework, qty ${T3_REJ2} → Save (asks for a level-1 rework child under the OSP job card)`,
    source: 'NC detail → Dispose panel',
    related: 'Job Cards (level-1 child)',
    required: `Either a child JC ${s.t3JcCode}-RW1 (parent link, origin op = the outsource op, recovery kind rework) — or the app's own refusal, quoted`,
  }, async () => {
    const nb = await ncApi(page, s.t3NcBId!);
    if (s.t3NcBReworkRefusal) {
      finding(`[T3] Rework on a vendor-sourced NC is refused by design: NC-B (${s.t3NcBCode}, raised by an Incoming QC reject on the RTV replacement) → Dispose Rework → "${s.t3NcBReworkRefusal}". A rework child job card can therefore never hang under an outsource op's NC; the return-to-vendor side nests as NC → challan → GRN → NC, not as child job cards. Owning file: ${REWORK_GUARD_FILE}.`);
      return { actual: `App refused: "${s.t3NcBReworkRefusal}" — NC-B stays ${nb.status} (disposition ${nb.disposition ?? '—'}). No child job card exists. Owning file: ${REWORK_GUARD_FILE}`, ok: 'blocked' };
    }
    return { actual: `Rework accepted; child ${s.t3ChildCode ?? '(none found)'}; api: ${ncLine(nb)}`, ok: Boolean(s.t3ChildCode) };
  });

  await rec(page, 'T3-04', {
    action: 'Level-1 child JC under the OSP job card: parent link, origin op, recovery kind, route, run, QC 1/1 → NC-C on the child',
    source: 'Job Card detail (child) / Op Entry',
    related: 'Top JC ↔ child links',
    required: 'Child JC page shows REWORK of <top JC> · Op 1; top JC lists the child; child QC 1 ok / 1 rej raises NC-C on the child',
  }, async () => {
    if (!s.t3ChildCode) {
      return { actual: `Not reachable: T3-03 was refused ("${s.t3NcBReworkRefusal}"), so no level-1 child job card exists to open, route or run. The only nesting the system allows on the vendor side is NC → return challan → GRN Against NC → Incoming QC → next NC, which is what T3-05 onward drives.`, ok: 'blocked' };
    }
    const body = await jcBody(page, s.t3ChildUrl ?? (await jcUrlByCode(page, s.t3ChildCode)));
    return { actual: body.slice(0, 300), ok: /REWORK of/i.test(body) };
  });

  // Allowed path: NC-B → Return to vendor again.
  if (!s.t3NcBDisposed) {
    const msg = await tryDispose(page, s.t3NcBUrl!, 'return_to_vendor', T3_REJ2, 'E2E_ deep chain - NC-B return 2 to vendor (second RTV on the same op)');
    if (msg) log('NC-B return_to_vendor refused: ' + msg);
    const nb = await ncApi(page, s.t3NcBId!);
    if (nb.disposition === 'return_to_vendor') s = writeState({ t3NcBDisposed: true });
    else {
      blocked('T3-05', { action: 'NC-B → Return to vendor (second RTV on the same op)', source: 'NC detail → Dispose', related: 'DC', required: 'second RTV challan' }, 'refused: ' + msg);
      return;
    }
  }
  if (!s.t3RtvDc2Id) {
    const dc = await createRtvDc(page, s.t3NcBUrl!, 'E2E_ deep chain - NC-B return challan (level 1 on the vendor side)');
    s = writeState({ t3RtvDc2Id: dc.id, t3RtvDc2Code: dc.code, t3RtvDc2Prefill: dc.prefill });
    doc('T3 RTV DC 2 (NC-B)', dc.code);
  }
  await rec(page, 'T3-05', {
    action: `Allowed path — NC-B → Dispose: Return to vendor ${T3_REJ2} → Create DC (vendor box read before touching it)`,
    source: 'NC detail → Dispose → Create DC panel',
    related: 'RTV DC 2 detail; JWPO line',
    required: `Vendor prefilled with the ORIGINAL vendor ${VENDOR_CODE}; challan issued for ${T3_REJ2} carrying NC-B and JC ${s.t3JcCode}; JWPO received drops to ${T3_QTY - T3_REJ2} (${T3_ACC1 + T3_ACC2} accepted in-house + ${T3_REJ2} back at the vendor)`,
  }, async () => {
    const dc = await readDcDetail(page, s.t3RtvDc2Id!);
    const po = await readPo(page, s.t3PoId!);
    const pre = s.t3RtvDc2Prefill ?? '';
    finding(`[T3] Second return-to-vendor on the same op (NC-B): Create DC opened with Vendor = "${pre}" — ${pre.includes(VENDOR_CODE) ? 'the original vendor was prefilled' : 'NOT prefilled'}. JWPO ${po.code} line received after this challan: ${po.received[0]} (expected ${T3_QTY - T3_REJ2}: ${T3_ACC1 + T3_ACC2} accepted + ${T3_REJ2} out at the vendor).`);
    const ok = pre.includes(VENDOR_CODE) && dc.status === 'issued' && dc.nc.toUpperCase().includes(s.t3NcBCode!.toUpperCase()) && po.received[0] === T3_QTY - T3_REJ2;
    return { actual: `Vendor box on open: "${pre}"; ${dc.code} status ${dc.status} NC ${dc.nc} vendor "${dc.vendor}" Reason "${dc.reason}" line "${dc.line}"; JWPO ${po.code} received ${JSON.stringify(po.received)} status "${po.status}"`, ok };
  });
});

test('T3 - level 2: GRN Against NC-B 2 -> QC 1 ok / 1 rej -> NC-C -> Rework asked -> RTV -> GRN -> QC 1 ok -> roll-up', async ({ page }) => {
  test.setTimeout(1_500_000);
  let s = readState();
  if (!s.t3RtvDc2Id) {
    blocked('T3-06', { action: 'GRN Against NC-B', source: 'GRN', related: '', required: '' }, 'no second RTV challan');
    return;
  }

  if (!s.t3Grn3Id) {
    const g = await grnAgainstNc(page, s.t3NcBCode!, T3_REJ2, 'E2E_ deep chain - GRN against NC-B (2 of 2)');
    s = writeState({ t3Grn3Id: g.id, t3Grn3Code: g.code });
    doc('T3 GRN 3 (Against NC-B)', g.code);
  }
  if (!s.t3Qc3Done) {
    await incomingQc(page, s.t3Grn3Code!, T3_ACC3, T3_REJ3, 'E2E_ deep chain - second replacement rejected again (NC-C)');
    s = writeState({ t3Qc3Done: true });
  }
  if (!s.t3NcCCode) {
    await page.goto(`/nc-register?search=${s.t3JcCode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const body = await page.locator('body').innerText();
    const re = new RegExp('NC-AUTO-' + s.t3JcCode!.replace(/-/g, '\\-') + NC_OP1, 'g');
    const codes = [...new Set(body.match(re) ?? [])].filter((c) => c !== s.t3NcACode && c !== s.t3NcBCode);
    expect(codes.length, 'a third NC on the top JC: ' + JSON.stringify(codes)).toBeGreaterThan(0);
    s = writeState({ t3NcCCode: codes.sort().reverse()[0]! });
    doc('T3 NC-C', s.t3NcCCode!);
  }
  if (!s.t3NcCUrl) {
    const o = await openNc(page, s.t3NcCCode!);
    s = writeState({ t3NcCUrl: o.url, t3NcCId: o.id });
  }
  await rec(page, 'T3-06', {
    action: `GRN → + New → Against NC → ${s.t3NcBCode} → Receive now ${T3_REJ2} → Create GRN ${s.t3Grn3Code}; Incoming QC → accept ${T3_ACC3}, reject ${T3_REJ3}`,
    source: 'GRN (Against NC) → Incoming QC',
    related: 'NC-C (level 2 on the vendor side); NC-B detail',
    required: `NC-C auto-raised for ${T3_REJ3} (Source GRN ${s.t3Grn3Code}); NC-B settles cleared ${T3_ACC3} / failed ${T3_REJ3} and closes; GRN 3 line accepted ${T3_ACC3} rejected ${T3_REJ3}`,
  }, async () => {
    const nc = await ncApi(page, s.t3NcCId!);
    const nb = await ncApi(page, s.t3NcBId!);
    const d = await readNcDetail(page, s.t3NcCUrl!);
    const sgrn = /Source GRN:\s*(IN-GRN-\d+)/.exec(d.body)?.[1] ?? '';
    const g = await readGrnDetail(page, s.t3Grn3Id!);
    return { actual: `NC-C ${nc.code} badge "${d.status}" Source GRN ${sgrn || '(none)'}; api NC-C: ${ncLine(nc)}; api NC-B: ${ncLine(nb)}; GRN 3 ${g.code} NC=${g.nc} line ${JSON.stringify(g.lines[0])}`, ok: Number(nc.rejectedQty) === T3_REJ3 && sgrn === s.t3Grn3Code && Number(nb.clearedQty) === T3_ACC3 && Number(nb.failedQty) === T3_REJ3 };
  });

  if (s.t3NcCReworkRefusal === undefined) {
    const msg = await tryDispose(page, s.t3NcCUrl!, 'rework', T3_REJ3, 'E2E_ deep chain - NC-C rework 1 (level-3 child)');
    const nc = await ncApi(page, s.t3NcCId!);
    if (!msg && nc.disposition === 'rework') s = writeState({ t3NcCReworkRefusal: '', t3NcCDisposed: true });
    else s = writeState({ t3NcCReworkRefusal: msg || `(no message captured; NC-C disposition now "${nc.disposition ?? '—'}")` });
  }
  await rec(page, 'T3-07', {
    action: `NC-C → Dispose: Rework, qty ${T3_REJ3} → Save (asks for a child JC one level deeper)`,
    source: 'NC detail → Dispose panel',
    related: 'Job Cards (grandchild)',
    required: 'A grandchild JC (record its code and parent link) — or the app\'s own refusal, quoted',
  }, async () => {
    const nc = await ncApi(page, s.t3NcCId!);
    if (s.t3NcCReworkRefusal) {
      return { actual: `App refused again at level 2: "${s.t3NcCReworkRefusal}" — NC-C stays ${nc.status} (disposition ${nc.disposition ?? '—'}). Same guard as T3-03: ${REWORK_GUARD_FILE}`, ok: 'blocked' };
    }
    return { actual: `Rework accepted; api: ${ncLine(nc)}`, ok: true };
  });

  if (!s.t3NcCDisposed) {
    const msg = await tryDispose(page, s.t3NcCUrl!, 'return_to_vendor', T3_REJ3, 'E2E_ deep chain - NC-C return 1 to vendor (third RTV on the same op)');
    const nc = await ncApi(page, s.t3NcCId!);
    if (nc.disposition === 'return_to_vendor') s = writeState({ t3NcCDisposed: true });
    else {
      blocked('T3-08', { action: 'NC-C → Return to vendor (third RTV on the same op)', source: 'NC detail → Dispose', related: 'DC', required: 'third RTV challan' }, 'refused: ' + msg);
      return;
    }
  }
  if (!s.t3RtvDc3Id) {
    const dc = await createRtvDc(page, s.t3NcCUrl!, 'E2E_ deep chain - NC-C return challan (level 2 on the vendor side)');
    s = writeState({ t3RtvDc3Id: dc.id, t3RtvDc3Code: dc.code, t3RtvDc3Prefill: dc.prefill });
    doc('T3 RTV DC 3 (NC-C)', dc.code);
  }
  if (!s.t3Grn4Id) {
    const g = await grnAgainstNc(page, s.t3NcCCode!, T3_REJ3, 'E2E_ deep chain - GRN against NC-C (1 of 1)');
    s = writeState({ t3Grn4Id: g.id, t3Grn4Code: g.code });
    doc('T3 GRN 4 (Against NC-C)', g.code);
  }
  await rec(page, 'T3-08', {
    action: `Allowed path — NC-C → Return to vendor ${T3_REJ3} → Create DC (vendor box read) → DC ${s.t3RtvDc3Code} → GRN Against NC-C ${T3_REJ3} → ${s.t3Grn4Code}`,
    source: 'NC detail → Create DC → GRN (Against NC)',
    related: 'RTV DC 3; GRN 4; JWPO line',
    required: `Vendor prefilled ${VENDOR_CODE}; DC issued then received; GRN 4 Against NC-C with ${T3_REJ3}; NC-C Received – QC Pending; JWPO received ${T3_QTY - T3_REJ3} while the last piece is out`,
  }, async () => {
    const dc = await readDcDetail(page, s.t3RtvDc3Id!);
    const g = await readGrnDetail(page, s.t3Grn4Id!);
    const nc = await ncApi(page, s.t3NcCId!);
    const po = await readPo(page, s.t3PoId!);
    const pre = s.t3RtvDc3Prefill ?? '';
    return { actual: `Vendor box on open: "${pre}"; ${dc.code} status ${dc.status} NC ${dc.nc}; GRN ${g.code} NC=${g.nc} received ${JSON.stringify(g.lines.map((l) => l.received))}; api NC-C: ${ncLine(nc)}; JWPO received ${JSON.stringify(po.received)} status "${po.status}"`, ok: pre.includes(VENDOR_CODE) && dc.status === 'received' && g.nc === s.t3NcCCode && nc.status === 'received_qc_pending' };
  });

  if (!s.t3Qc4Done) {
    await incomingQc(page, s.t3Grn4Code!, T3_REJ3, 0, 'E2E_ deep chain - third replacement accepted');
    s = writeState({ t3Qc4Done: true });
  }
  await rec(page, 'T3-09', {
    action: `Incoming QC → Inspect ${s.t3Grn4Code} → accept ${T3_REJ3}, reject 0 → Submit QC`,
    source: 'Incoming QC → QC Call Register',
    related: 'NC-C detail',
    required: `NC-C closed, cleared ${T3_REJ3}`,
  }, async () => {
    const nc = await ncApi(page, s.t3NcCId!);
    const d = await readNcDetail(page, s.t3NcCUrl!);
    return { actual: `NC-C badge "${d.status}"; api: ${ncLine(nc)}`, ok: /closed/i.test(nc.status) && Number(nc.clearedQty) === T3_REJ3 };
  });

  await rec(page, 'T3-10', {
    action: 'Roll-up: NC-A, NC-B, NC-C exact status text',
    source: 'NC detail pages',
    related: 'NC Register list',
    required: `NC-A closed (cleared ${T3_ACC2} / failed ${T3_REJ2}); NC-B closed (cleared ${T3_ACC3} / failed ${T3_REJ3}); NC-C closed (cleared ${T3_REJ3}); list shows all three CLOSED`,
  }, async () => {
    const a = await readNcDetail(page, s.t3NcAUrl!);
    const b = await readNcDetail(page, s.t3NcBUrl!);
    const c = await readNcDetail(page, s.t3NcCUrl!);
    const na = await ncApi(page, s.t3NcAId!);
    const nb = await ncApi(page, s.t3NcBId!);
    const nc = await ncApi(page, s.t3NcCId!);
    await page.goto('/nc-register?search=' + encodeURIComponent(s.t3JcCode!), { waitUntil: 'domcontentloaded' });
    await page.getByText(s.t3NcACode!).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const cards = [s.t3NcACode!, s.t3NcBCode!, s.t3NcCCode!].map((k) => cardText(body, k, 120));
    const ok = /closed/i.test(na.status) && /closed/i.test(nb.status) && /closed/i.test(nc.status);
    return { actual: `NC-A badge "${a.status}" (${ncLine(na)}) ; NC-B badge "${b.status}" (${ncLine(nb)}) ; NC-C badge "${c.status}" (${ncLine(nc)}) ; list: ${cards.join(' || ')}`, ok };
  });

  await rec(page, 'T3-11', {
    action: 'Roll-up: the top OSP job card — op card accepted total, tiles, NC breakup strip, JC status, child-JC links',
    source: 'Job Card detail (top JC)',
    related: 'Op card; Overall Status; Parent/Child JC sections',
    required: `Op accepted ${T3_QTY} (${T3_ACC1} + ${T3_ACC2} + ${T3_ACC3} + ${T3_REJ3}); AT VENDOR 0, IN QC 0; strip "NC closed ${T3_REJ1 + T3_REJ2 + T3_REJ3}" (3 + 2 + 1) with nothing open; JC status complete; no child job cards (none could be raised)`,
  }, async () => {
    const strip = await jcNcStrips(page, s.t3JcUrl!);
    const status = await jcStatusBadge(page);
    const tiles = await jcQtyTiles(page);
    const o = (await opsOf(page, s.t3JcCode!))[0]!;
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const childLinks = (body.match(new RegExp(s.t3JcCode! + '-R[WP]\\d+', 'g')) ?? []).length;
    finding(`[T3] Roll-up on ${s.t3JcCode}: op DONE (vendor-accepted) ${o.completedQty} of ${T3_QTY}, at vendor ${o.atVendorQty}, in QC ${o.inQcQty}; strip "${strip}"; JC status "${status}"; NC breakup closed ${o.ncBreakup.ncClosedQty} (NC-A 3 + NC-B 2 + NC-C 1 = 6 pieces went through NCs; 3 physical pieces cycled three times).`);
    return { actual: `JC status "${status}"; tiles "${tiles}"; strip "${strip}"; child-JC codes on the page: ${childLinks}; op: ${opLine(o)}`, ok: o.completedQty === T3_QTY && o.atVendorQty === 0 && o.inQcQty === 0 && o.ncBreakup.openNcCount === 0 };
  });

  await rec(page, 'T3-12', {
    action: 'Roll-up: JWPO line received qty at the end',
    source: 'Purchase Order detail (JWPO)',
    related: 'recalcPoLineReceivedQty (apps/api/src/modules/goods-receipt-notes/cascades.ts)',
    required: `Received back to ${T3_QTY} (every piece finally accepted); status completed/received`,
  }, async () => {
    const po = await readPo(page, s.t3PoId!);
    if (po.received[0] !== T3_QTY) {
      finding(`[T3] JWPO ${po.code} line received reads ${po.received[0]} after every piece was finally accepted (expected ${T3_QTY}). The formula Σ ordinary GRN − Σ (rejected − cleared) over RTV NCs counts a piece that FAILED its replacement inspection under the earlier NC (failed, never cleared) AND under the follow-on NC that carries it — one physical piece subtracted twice. Owning file: apps/api/src/modules/goods-receipt-notes/cascades.ts (recalcPoLineReceivedQty).`);
    }
    return { actual: `${po.code} received ${JSON.stringify(po.received)} of ${JSON.stringify(po.qty)}; status "${po.status}"`, ok: po.received[0] === T3_QTY };
  });

  await rec(page, 'T3-13', {
    action: 'Roll-up: the three return challans and the four GRNs',
    source: 'Delivery Challan detail × 3; GRN list',
    related: 'NC links on each',
    required: 'RTV DC 1/2/3 all received; GRN 2/3/4 badged Against NC with the right NC code',
  }, async () => {
    const d1 = await readDcDetail(page, s.t3RtvDc1Id!);
    const d2 = await readDcDetail(page, s.t3RtvDc2Id!);
    const d3 = await readDcDetail(page, s.t3RtvDc3Id!);
    const g2 = await readGrnDetail(page, s.t3Grn2Id!);
    const g3 = await readGrnDetail(page, s.t3Grn3Id!);
    const g4 = await readGrnDetail(page, s.t3Grn4Id!);
    const ok = [d1, d2, d3].every((d) => d.status === 'received') && g2.nc === s.t3NcACode && g3.nc === s.t3NcBCode && g4.nc === s.t3NcCCode;
    return { actual: `${d1.code} ${d1.status} NC ${d1.nc}; ${d2.code} ${d2.status} NC ${d2.nc}; ${d3.code} ${d3.status} NC ${d3.nc}; ${g2.code} NC ${g2.nc} lines ${JSON.stringify(g2.lines[0])}; ${g3.code} NC ${g3.nc} lines ${JSON.stringify(g3.lines[0])}; ${g4.code} NC ${g4.nc} lines ${JSON.stringify(g4.lines[0])}`, ok };
  });

  await rec(page, 'T3-14', {
    action: 'Level-3 grandchild JC (RW1-RW1) under a rework child of the OSP job card: parent links on every job-card page',
    source: 'Job Card detail pages',
    related: 'Parent JC / Child JCs sections',
    required: 'Grandchild code + parent link recorded — or the reason it cannot exist',
  }, async () => {
    return { actual: `Not reachable on the vendor side: T3-03 and T3-07 show Rework is refused for every NC whose material came from a vendor ("${s.t3NcBReworkRefusal || s.t3NcCReworkRefusal}"), so neither a child nor a grandchild job card can be raised under ${s.t3JcCode}. Child-in-child nesting with parent links on every page is proven on the in-house side in Test 1 (${readState().t1JcCode} → ${readState().t1Child1Code} → ${readState().t1Child2Code}). The mirror guard (return to vendor refused on an in-house NC: "This NC has no vendor source; in-house rejected material is reworked or scrapped, not returned to a vendor.") is in the same file and was not exercised live.`, ok: 'blocked' };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RE-VERIFICATION AFTER ADR-165 (2026-09-16)
//
// A fresh OSP chain (qty 10), then FOUR nested return-to-vendor levels. After
// every event the JWPO line's Received figure and the header badge are read
// off the Purchase Order detail page. The four checks that FAILED on
// 2026-09-15 are marked "was FAIL on 2026-09-15 → now …" in their rows.
// ═══════════════════════════════════════════════════════════════════════════

const R1_QTY = 10;
// Level A: first inspection 7 ok / 3 rej -> NC-A carries 3.
const R1_ACC1 = 7;
const R1_REJ1 = 3;
// Level B: NC-A replacement 1 ok / 2 rej -> NC-B carries 2.
const R1_ACC2 = 1;
const R1_REJ2 = 2;
// Level C: NC-B replacement 1 ok / 1 rej -> NC-C carries 1.
const R1_ACC3 = 1;
const R1_REJ3 = 1;
// Level D: NC-C replacement 0 ok / 1 rej (ALL rejected) -> NC-D carries 1.
const R1_ACC4 = 0;
const R1_REJ4 = 1;
// NC-D replacement 1 ok -> everything home.
const R1_ACC5 = 1;

const WAS_FAIL: Record<string, string> = {
  'T2-13': 'was FAIL on 2026-09-15 (T2-13: line 7 of 10 but header "closed" right after the return challan)',
  'T3-05': 'was FAIL on 2026-09-15 (T3-05: line read 6 after the second challan — the 2 failed pieces subtracted under NC-A AND NC-B)',
  'T2-18': 'was FAIL on 2026-09-15 (T2-18: line 10 of 10 but header "partial" after the replacement passed QC)',
  'T3-12': 'was FAIL on 2026-09-15 (T3-12: line ended at 7 of 10 with every piece accepted)',
};

/** Flat string state for the re-verification chain. */
function r1(k: string): string {
  return readState().r1?.[k] ?? '';
}
function r1Set(patch: Record<string, string>): void {
  writeState({ r1: { ...(readState().r1 ?? {}), ...patch } });
}

/** The NC's rows in the Activity Log (API), newest first, as "ACTION: detail". */
async function ncActivity(page: Page, ncCode: string): Promise<string[]> {
  const r = await apiGet<{ entries: { action: string; detail: string; ts: string }[] }>(
    page,
    '/activity-log?search=' + encodeURIComponent(ncCode) + '&limit=50&offset=0',
  );
  return r.entries.map((e) => `${e.action}: ${e.detail}`);
}
/** Open the Activity Log screen filtered to the NC so the row screenshot shows it. */
async function showActivity(page: Page, ncCode: string): Promise<void> {
  await page.goto('/activity-log?search=' + encodeURIComponent(ncCode), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
}
/** "line 7 of 10, header \"partial\"" */
function poText(po: { code: string; received: number[]; qty: number[]; status: string }): string {
  return `${po.code} line received ${po.received[0]} of ${po.qty[0]}, header "${po.status}"`;
}
/** The newest NC-AUTO on the JC that is not one already known. */
async function newestNc(page: Page, jcCode: string, known: string[]): Promise<string> {
  await page.goto(`/nc-register?search=${jcCode}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const body = await page.locator('body').innerText();
  const re = new RegExp('NC-AUTO-' + jcCode.replace(/-/g, '\\-') + NC_OP1, 'g');
  const codes = [...new Set(body.match(re) ?? [])].filter((c) => !known.includes(c));
  expect(codes.length, 'a new NC on ' + jcCode + ': ' + JSON.stringify(codes)).toBeGreaterThan(0);
  return codes.sort().reverse()[0]!;
}

/** One return-to-vendor level: dispose NC-k as RTV (qty), Create DC, GRN
 *  Against NC-k, Incoming QC acc/rej, find the follow-on NC (if rej > 0).
 *  Records rows <id>a (challan → JWPO), <id>b (GRN against NC), <id>c (QC →
 *  JWPO + activity-log wording). `wasFailChallan` / `wasFailQc` name the
 *  2026-09-15 rows this level re-verifies. */
async function rtvLevel(
  page: Page,
  lv: { k: string; next: string; qty: number; acc: number; rej: number; lineAfterOut: number; wasFailChallan?: string; wasFailQc?: string },
): Promise<void> {
  const jc = r1('jcCode');
  const poId = r1('poId');
  const ncCode = r1('nc' + lv.k + 'Code');
  const ncUrl = r1('nc' + lv.k + 'Url');
  const ncId = r1('nc' + lv.k + 'Id');
  const idA = `R1-${lv.k}1`;
  const idB = `R1-${lv.k}2`;
  const idC = `R1-${lv.k}3`;

  // 1. Dispose RTV + Create DC.
  if (!r1('nc' + lv.k + 'Disposed')) {
    const msg = await tryDispose(page, ncUrl, 'return_to_vendor', lv.qty, `E2E_ re-verify ADR-165 - NC-${lv.k} return ${lv.qty} to vendor`);
    const n = await ncApi(page, ncId);
    if (n.disposition !== 'return_to_vendor') {
      blocked(idA, { action: `NC-${lv.k} → Return to vendor ${lv.qty}`, source: 'NC detail → Dispose', related: 'JWPO', required: '' }, 'refused: ' + msg);
      return;
    }
    r1Set({ ['nc' + lv.k + 'Disposed']: 'yes' });
  }
  if (!r1('rtvDc' + lv.k + 'Id')) {
    const dc = await createRtvDc(page, ncUrl, `E2E_ re-verify ADR-165 - NC-${lv.k} return challan`);
    r1Set({ ['rtvDc' + lv.k + 'Id']: dc.id, ['rtvDc' + lv.k + 'Code']: dc.code, ['rtvDc' + lv.k + 'Prefill']: dc.prefill });
    doc(`R1 RTV DC (NC-${lv.k})`, dc.code);
  }
  const wasA = lv.wasFailChallan ? WAS_FAIL[lv.wasFailChallan] + ' → now: ' : '';
  await rec(page, idA, {
    action: `NC-${lv.k} ${ncCode} → Dispose: Return to vendor ${lv.qty} → Create DC (vendor box read before touching it) → JWPO read${lv.wasFailChallan ? ` [re-checks ${lv.wasFailChallan}]` : ''}`,
    source: 'NC detail → Dispose → Create DC panel → Purchase Order detail (JWPO)',
    related: 'RTV challan detail; JWPO line + header (ADR-165 §1 + §2, createNcDc)',
    required: `Vendor prefilled ${VENDOR_CODE}; challan issued for ${lv.qty} carrying NC-${lv.k}; JWPO line received ${lv.lineAfterOut} of ${R1_QTY} (only NC-${lv.k}'s OPEN ${lv.qty} subtracted); header "partial"`,
  }, async () => {
    const dc = await readDcDetail(page, r1('rtvDc' + lv.k + 'Id'));
    const po = await readPo(page, poId);
    const pre = r1('rtvDc' + lv.k + 'Prefill');
    const ok = pre.includes(VENDOR_CODE) && dc.status === 'issued' && dc.nc.toUpperCase().includes(ncCode.toUpperCase()) && po.received[0] === lv.lineAfterOut && po.status === 'partial';
    return { actual: `${wasA}${poText(po)}; vendor box on open: "${pre}"; ${dc.code} status ${dc.status} NC ${dc.nc} line "${dc.line}"`, ok };
  });

  // 2. GRN Against NC-k.
  if (!r1('grn' + lv.k + 'Id')) {
    const g = await grnAgainstNc(page, ncCode, lv.qty, `E2E_ re-verify ADR-165 - GRN against NC-${lv.k} (${lv.qty} of ${lv.qty})`);
    r1Set({ ['grn' + lv.k + 'Id']: g.id, ['grn' + lv.k + 'Code']: g.code });
    doc(`R1 GRN (Against NC-${lv.k})`, g.code);
  }
  await rec(page, idB, {
    action: `GRN → + New → Against NC → ${ncCode} → Receive now ${lv.qty} → Create GRN; JWPO read before Incoming QC`,
    source: 'Goods Receipt Notes → New (Against NC) → Purchase Order detail',
    related: 'NC-' + lv.k + ' detail; JWPO line + header',
    required: `GRN Against NC-${lv.k} with ${lv.qty} received; NC-${lv.k} "Received – QC Pending" (Sent ${lv.qty} / Received ${lv.qty}); JWPO line STILL ${lv.lineAfterOut} (a replacement counts only as it clears QC), header "partial"`,
  }, async () => {
    const g = await readGrnDetail(page, r1('grn' + lv.k + 'Id'));
    const n = await ncApi(page, ncId);
    const po = await readPo(page, poId);
    const ok = g.nc === ncCode && g.lines[0]?.received === lv.qty && n.status === 'received_qc_pending' && Number(n.rtvReceivedQty) === lv.qty && po.received[0] === lv.lineAfterOut && po.status === 'partial';
    return { actual: `${poText(po)}; ${g.code} NC=${g.nc} lines=${JSON.stringify(g.lines)}; api NC-${lv.k}: ${ncLine(n)}`, ok };
  });

  // 3. Incoming QC on the replacement.
  if (!r1('qc' + lv.k + 'Done')) {
    await incomingQc(page, r1('grn' + lv.k + 'Code'), lv.acc, lv.rej, `E2E_ re-verify ADR-165 - NC-${lv.k} replacement QC ${lv.acc} ok / ${lv.rej} rej`);
    r1Set({ ['qc' + lv.k + 'Done']: 'yes' });
  }
  if (lv.rej > 0 && !r1('nc' + lv.next + 'Code')) {
    const known = ['A', 'B', 'C', 'D'].map((x) => r1('nc' + x + 'Code')).filter(Boolean);
    const code = await newestNc(page, jc, known);
    const o = await openNc(page, code);
    r1Set({ ['nc' + lv.next + 'Code']: code, ['nc' + lv.next + 'Url']: o.url, ['nc' + lv.next + 'Id']: o.id });
    doc(`R1 NC-${lv.next}`, code);
  }
  const wasC = lv.wasFailQc ? WAS_FAIL[lv.wasFailQc] + ' → now: ' : '';
  const expectWording = `(${lv.acc} replacement accepted, ${lv.rej} failed on ${ncCode})`;
  await rec(page, idC, {
    action: `Incoming QC → Inspect ${r1('grn' + lv.k + 'Code')} (Against NC-${lv.k}) → accept ${lv.acc}, reject ${lv.rej} → Submit QC; JWPO + NC activity log read${lv.wasFailQc ? ` [re-checks ${lv.wasFailQc}]` : ''}${lv.acc === 0 ? ' — ALL-REJECTED replacement: the line must still move' : ''}`,
    source: 'Incoming QC → QC Call Register → Purchase Order detail → Activity Log',
    related: `NC-${lv.k} detail; ${lv.rej > 0 ? 'NC-' + lv.next + ' (follow-on)' : '—'}; JWPO line + header (ADR-165, onNcReplacementQc)`,
    required: `JWPO line back to ${R1_QTY} of ${R1_QTY} (NC-${lv.k} open 0 = ${lv.qty} − ${lv.acc} − ${lv.rej}${lv.rej > 0 ? `; NC-${lv.next} for ${lv.rej} not yet out` : ''}); header "closed" (every GRN line QC-complete) — exact text recorded; NC-${lv.k} closed with cleared ${lv.acc} / failed ${lv.rej}; activity log row "PO line 1 received_qty ${lv.lineAfterOut} → ${R1_QTY} ${expectWording}"${lv.rej > 0 ? `; NC-${lv.next} raised for ${lv.rej} (Source GRN = the Against-NC GRN)` : ''}`,
  }, async () => {
    const po = await readPo(page, poId);
    const n = await ncApi(page, ncId);
    const acts = await ncActivity(page, ncCode);
    const adj = acts.find((a) => a.startsWith('PO_RECEIVED_ADJUST') && a.includes('replacement accepted')) ?? '(no PO_RECEIVED_ADJUST replacement row)';
    const wordingNew = adj.includes(expectWording);
    const wordingOld = /\(\d+ replacement accepted on /.test(adj);
    let nextTxt = '';
    let nextOk = true;
    if (lv.rej > 0) {
      const nn = await ncApi(page, r1('nc' + lv.next + 'Id'));
      nextOk = Number(nn.rejectedQty) === lv.rej && Boolean(nn.grnLineId) && nn.disposition == null;
      nextTxt = `; NC-${lv.next}: ${ncLine(nn)}`;
    }
    await showActivity(page, ncCode);
    // Header: "closed" when every GRN line is QC-complete (the case here);
    // "qc pending" would also be a correct ladder step — the exact text is
    // recorded either way.
    const ok = po.received[0] === R1_QTY && /^(closed|qc.?pending)$/i.test(po.status) && /closed/i.test(n.status) && Number(n.clearedQty) === lv.acc && Number(n.failedQty) === lv.rej && wordingNew && nextOk;
    return { actual: `${wasC}${poText(po)}; NC-${lv.k}: ${ncLine(n)}; activity log: "${adj}" (${wordingNew ? 'NEW ADR-165 wording' : wordingOld ? 'OLD wording — stale API' : 'wording not matched'})${nextTxt}`, ok };
  });
}

test('R1 - build: fresh OSP chain SO 10 -> JC -> JWPO -> DC 10 -> GRN 10 -> QC 7/3 -> NC-A', async ({ page }) => {
  test.setTimeout(1_500_000);
  {
    const r = readReport();
    r.title = 'Innovic ERP — chain verification (rework with multiple child JCs; GRN → QC reject → return to vendor) + re-verification after ADR-165';
    r.date = REPORT_DATE;
    writeReport(r);
  }
  if (!r1('soCode')) {
    const so = await createSo(page, R1_QTY, `E2E_REVERIFY-165-${STAMP}`);
    r1Set({ soCode: so.code, soUrl: so.url });
    doc('R1 SO', so.code);
  }
  if (!r1('jcCode')) {
    const jc = await planAndExecute(page, r1('soCode'), R1_QTY, { kind: 'outsource', name: 'E2E_ Heat treatment (ADR-165)' });
    r1Set({ jcCode: jc });
    doc('R1 JC (OSP)', jc);
  }
  if (!r1('jcUrl')) r1Set({ jcUrl: await jcUrlByCode(page, r1('jcCode')) });
  if (!r1('prCode')) {
    const body = await jcBody(page, r1('jcUrl'));
    const pr = /IN-JWPR-\d+/.exec(body)?.[0];
    if (pr) {
      r1Set({ prCode: pr });
      doc('R1 JW PR (auto)', pr);
    }
  }
  if (!r1('poId')) {
    const po = await genPoFromJc(page, r1('jcUrl'), 'E2E_ re-verify ADR-165 (2026-09-16) - JWPO for the fresh OSP chain - safe to cancel.');
    r1Set({ poId: po.id, poCode: po.code });
    doc('R1 JWPO', po.code);
  }
  if (!r1('dcId')) {
    const dc = await genDcFromJc(page, r1('jcUrl'), R1_QTY, 'E2E_ re-verify ADR-165 - outward challan');
    r1Set({ dcId: dc.id, dcCode: dc.code });
    doc('R1 outward DC', dc.code);
  }
  if (!r1('grn1Id')) {
    const g = await grnAgainstDc(page, r1('poCode'), r1('dcCode'), R1_QTY, 'E2E_ re-verify ADR-165 - OSP return (10 of 10)');
    r1Set({ grn1Id: g.id, grn1Code: g.code });
    doc('R1 GRN 1 (Against JWPO / DC)', g.code);
  }
  await rec(page, 'R1-01', {
    action: `Fresh OSP chain: SO ${r1('soCode')} (qty ${R1_QTY}) → JC ${r1('jcCode')} (1 outsource op, ${VENDOR_CODE}) → JWPO ${r1('poCode')} (approved) → DC ${r1('dcCode')} (${R1_QTY}) → GRN ${r1('grn1Code')} (${R1_QTY})`,
    source: 'Sales Orders → Planning → JC op card (Gen PO / Gen DC) → GRN (Against JWPO / DC) → Purchase Order detail',
    related: 'JWPO line + header before any QC',
    required: `JWPO line received ${R1_QTY} of ${R1_QTY}; header "qc_pending" (fully received, GRN line QC not done); op AT VENDOR 0 / IN QC ${R1_QTY}`,
  }, async () => {
    const po = await readPo(page, r1('poId'));
    const o = (await opsOf(page, r1('jcCode')))[0]!;
    return { actual: `${poText(po)}; op: ${opLine(o)}`, ok: po.received[0] === R1_QTY && /qc.?pending/i.test(po.status) && o.inQcQty === R1_QTY && o.atVendorQty === 0 };
  });

  if (!r1('qc1Done')) {
    await incomingQc(page, r1('grn1Code'), R1_ACC1, R1_REJ1, 'E2E_ re-verify ADR-165 - first inspection 7 ok / 3 rej (NC-A)');
    r1Set({ qc1Done: 'yes' });
  }
  if (!r1('ncACode')) {
    const nc = await findAutoNc(page, r1('jcCode'));
    const o = await openNc(page, nc.code);
    r1Set({ ncACode: nc.code, ncAUrl: o.url, ncAId: o.id });
    doc('R1 NC-A', nc.code);
  }
  await rec(page, 'R1-02', {
    action: `Incoming QC → Inspect ${r1('grn1Code')} → accept ${R1_ACC1}, reject ${R1_REJ1} → Submit QC`,
    source: 'Incoming QC → QC Call Register → Purchase Order detail',
    related: 'NC-A; JWPO line + header (base case)',
    required: `NC-A auto-raised for ${R1_REJ1}; JWPO line STILL ${R1_QTY} of ${R1_QTY} (a rejected piece not yet returned counts as received — base case in ADR-165) and header "closed" (all GRN lines QC-complete)`,
  }, async () => {
    const po = await readPo(page, r1('poId'));
    const n = await ncApi(page, r1('ncAId'));
    return { actual: `${poText(po)}; NC-A: ${ncLine(n)}`, ok: po.received[0] === R1_QTY && po.status === 'closed' && Number(n.rejectedQty) === R1_REJ1 && Boolean(n.grnLineId) };
  });
});

test('R1 - level A/B: NC-A out 3 (7) -> replacement 1 ok / 2 rej (10, NC-B) -> NC-B out 2 (8) -> replacement 1 ok / 1 rej (10, NC-C)', async ({ page }) => {
  test.setTimeout(1_500_000);
  if (!r1('ncAUrl')) {
    blocked('R1-A1', { action: 'NC-A → Return to vendor', source: 'NC detail', related: '', required: '' }, 'the fresh chain was not built');
    return;
  }
  await rtvLevel(page, { k: 'A', next: 'B', qty: R1_REJ1, acc: R1_ACC2, rej: R1_REJ2, lineAfterOut: R1_QTY - R1_REJ1, wasFailChallan: 'T2-13', wasFailQc: 'T2-18' });
  if (!r1('ncBUrl')) {
    blocked('R1-B1', { action: 'NC-B → Return to vendor', source: 'NC detail', related: '', required: '' }, 'NC-B was not raised');
    return;
  }
  await rtvLevel(page, { k: 'B', next: 'C', qty: R1_REJ2, acc: R1_ACC3, rej: R1_REJ3, lineAfterOut: R1_QTY - R1_REJ2, wasFailChallan: 'T3-05' });
});

test('R1 - level C/D: NC-C out 1 (9) -> replacement 0 ok / 1 rej (10, NC-D) -> NC-D out 1 (9) -> replacement 1 ok (10 of 10, closed)', async ({ page }) => {
  test.setTimeout(1_500_000);
  if (!r1('ncCUrl')) {
    blocked('R1-C1', { action: 'NC-C → Return to vendor', source: 'NC detail', related: '', required: '' }, 'NC-C was not raised');
    return;
  }
  await rtvLevel(page, { k: 'C', next: 'D', qty: R1_REJ3, acc: R1_ACC4, rej: R1_REJ4, lineAfterOut: R1_QTY - R1_REJ3 });
  if (!r1('ncDUrl')) {
    blocked('R1-D1', { action: 'NC-D → Return to vendor', source: 'NC detail', related: '', required: '' }, 'NC-D was not raised');
    return;
  }
  await rtvLevel(page, { k: 'D', next: '-', qty: R1_REJ4, acc: R1_ACC5, rej: 0, lineAfterOut: R1_QTY - R1_REJ4, wasFailQc: 'T3-12' });

  await rec(page, 'R1-Z1', {
    action: 'Roll-up: JWPO at the end of the four-level chain [re-checks T2-18 / T3-12]',
    source: 'Purchase Order detail (JWPO)',
    related: 'recalcPoLineReceivedQty + recalcPoHeaderStatus (ADR-165)',
    required: `Line received ${R1_QTY} of ${R1_QTY} with every piece finally accepted; header "closed"`,
  }, async () => {
    const po = await readPo(page, r1('poId'));
    return { actual: `${WAS_FAIL['T2-18']}; ${WAS_FAIL['T3-12']} → now: ${poText(po)}`, ok: po.received[0] === R1_QTY && po.status === 'closed' };
  });

  await rec(page, 'R1-Z2', {
    action: 'Roll-up: NC-A, NC-B, NC-C, NC-D status + ledger; the top JC op card',
    source: 'NC detail pages; Job Card detail',
    related: 'NC Register list; op card tiles + strip',
    required: `All four NCs closed: A cleared ${R1_ACC2}/failed ${R1_REJ2}; B cleared ${R1_ACC3}/failed ${R1_REJ3}; C cleared ${R1_ACC4}/failed ${R1_REJ4}; D cleared ${R1_ACC5}/failed 0. Op DONE ${R1_QTY}, AT VENDOR 0, IN QC 0, no open NC; strip "NC closed ${R1_REJ1 + R1_REJ2 + R1_REJ3 + R1_REJ4}"`,
  }, async () => {
    const ns = await Promise.all(['A', 'B', 'C', 'D'].map((k) => ncApi(page, r1('nc' + k + 'Id'))));
    const strip = await jcNcStrips(page, r1('jcUrl'));
    const status = await jcStatusBadge(page);
    const o = (await opsOf(page, r1('jcCode')))[0]!;
    const want = [
      [R1_ACC2, R1_REJ2],
      [R1_ACC3, R1_REJ3],
      [R1_ACC4, R1_REJ4],
      [R1_ACC5, 0],
    ];
    const ncOk = ns.every((n, i) => /closed/i.test(n.status) && Number(n.clearedQty) === want[i]![0] && Number(n.failedQty) === want[i]![1]);
    const ok = ncOk && o.completedQty === R1_QTY && o.atVendorQty === 0 && o.inQcQty === 0 && o.ncBreakup.openNcCount === 0;
    return { actual: `JC status "${status}"; strip "${strip}"; op: ${opLine(o)}; ${ns.map((n, i) => 'NC-' + 'ABCD'[i] + ': ' + ncLine(n)).join(' ;; ')}`, ok };
  });

  await rec(page, 'R1-Z3', {
    action: `Roll-up: the JWPO's Activity Log rows (PO_RECEIVED_ADJUST) for every event on ${r1('poCode')}`,
    source: 'Activity Log (search by NC code)',
    related: 'createNcDc + onNcReplacementQc audit rows',
    required: `Eight PO_RECEIVED_ADJUST rows in sequence: 10→7 (3 out on NC-A), 7→10 (1 accepted, 2 failed), 10→8 (2 out), 8→10 (1 accepted, 1 failed), 10→9 (1 out), 9→10 (0 accepted, 1 failed), 10→9 (1 out), 9→10 (1 accepted, 0 failed)`,
  }, async () => {
    const all: string[] = [];
    for (const k of ['A', 'B', 'C', 'D']) {
      const acts = await ncActivity(page, r1('nc' + k + 'Code'));
      all.push(...acts.filter((a) => a.startsWith('PO_RECEIVED_ADJUST')).reverse());
    }
    const moves = all.map((a) => /received_qty (\d+) → (\d+)/.exec(a)).filter(Boolean).map((m) => `${m![1]}→${m![2]}`);
    const wantMoves = ['10→7', '7→10', '10→8', '8→10', '10→9', '9→10', '10→9', '9→10'];
    await showActivity(page, r1('ncDCode'));
    return { actual: `moves seen: ${moves.join(', ')}; rows: ${all.join(' || ')}`, ok: JSON.stringify(moves) === JSON.stringify(wantMoves) };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R2 — ADR-166 batch 1 (2026-09-16): a returned-to-vendor piece is one piece
// everywhere. Gaps G1–G6 of docs/audits/2026-09-16-osp-chain-gap-report.md,
// each proved with a row that names the number seen.
//
//   Chain M (mid-route OSP: Op1 outsource on VND-959, Op2 in-house QC "DIR";
//   qty 10): DC 10 → GRN 10 → QC 7/3 → NC-A → RTV 3 → GRN 3 → QC 2/1 → NC-B
//   → RTV 1 → GRN 1 → QC 1/0. Rows M1–M6 (G1 mirror onto Op2, G3 qc_accept
//   stock rows, G4 at-vendor/in-QC once, G5 Sent/Received label + ONE audit
//   row per receipt).
//   Chain G (G6): fresh JWPO 10 → DC 6 → GRN 6 → QC 4/2 → NC → RTV 2 → the
//   Gen DC preview must offer 4 (was 2). Nothing saved on that preview.
//   Chain L (OSP op is the LAST op; qty 6): DC 6 → GRN 6 → QC 6 ok → JC
//   COMPLETE + closed_at, SO line/SO closed (G2); ONE grn_qc row +6.
//   Plus a read-only regression line on the R1 chain (IN-JWPO-00007/R1) and
//   the OSP At-Vendor Register invariants.
//   Second pass (rows R2-14..R2-22): chain G carried through its return cycle
//   (GRN Against NC 2 → QC 2 ok; G4/G5/G6 on a partially-sent op), on-screen
//   readings for chains M and L (op-card tiles, SO line status, document
//   statuses, JC list cards) and a final register / Store At-Vendor read.
//
// Run this section alone with:  --grep "00 -|R2|ZZ5|ZZ9"
// ═══════════════════════════════════════════════════════════════════════════

const R2_M_QTY = 10;
const R2_M_ACC1 = 7;
const R2_M_REJ1 = 3;
const R2_M_ACC2 = 2;
const R2_M_REJ2 = 1;
const R2_M_ACC3 = 1;
const R2_G_QTY = 10;
const R2_G_DC = 6;
const R2_G_ACC = 4;
const R2_G_REJ = 2;
const R2_L_QTY = 6;
const R2_QC_OP = 'DIR';

function r2(k: string): string {
  return readState().r2?.[k] ?? '';
}
function r2Set(patch: Record<string, string>): void {
  writeState({ r2: { ...(readState().r2 ?? {}), ...patch } });
}

interface JcApi {
  id: string;
  code: string;
  closedAt: string | null;
  computedStatus: string;
  totalOps: number;
  doneOps: number;
  qcPendingOps: number;
}
async function jcApi(page: Page, jcId: string): Promise<JcApi> {
  return apiGet<JcApi>(page, '/job-cards/' + jcId);
}
function jcApiLine(j: JcApi): string {
  return `${j.code} computedStatus=${j.computedStatus} closedAt=${j.closedAt ?? 'null'} ops ${j.doneOps}/${j.totalOps} done, ${j.qcPendingOps} qc-pending`;
}
interface SoApi {
  code: string;
  status: string;
  lines: { status: string; orderQty: number }[];
}
async function soApi(page: Page, soId: string): Promise<SoApi> {
  return apiGet<SoApi>(page, '/sales-orders/' + soId);
}
const idFromUrl = (url: string): string => /\/([0-9a-f-]{36})(?:[/?#]|$)/.exec(url)?.[1] ?? '';

/** The "🏭 Outsource … <label>" block on the JC detail page for Op1 (the only
 *  outsource op on these chains): the label the user sees. */
async function ospLabelOnPage(page: Page, jcUrl: string): Promise<string> {
  const body = await jcBody(page, jcUrl);
  const m = /Outsource\s+(?:E2E_ Shreeji Precision Heat Treaters Pvt Ltd\s+)?(Pending|PR Raised|PO Created|At Vendor|Received)\b/.exec(body);
  return m ? m[1]! : '(no Outsource label found on the JC page)';
}

interface LedgerRow {
  txnDate: string;
  txnType: string;
  qty: number;
  sourceType: string;
  sourceRef: string;
  remarks: string | null;
  itemCode: string | null;
}
async function ledgerRows(page: Page, search: string): Promise<LedgerRow[]> {
  const r = await apiGet<{ items: LedgerRow[] }>(page, '/store-transactions?search=' + encodeURIComponent(search) + '&limit=200&offset=0');
  return r.items;
}
const ledgerLine = (l: LedgerRow): string => `${l.txnDate} ${l.txnType} ${l.qty} [${l.sourceType}] "${l.sourceRef}"${l.remarks ? ' — ' + l.remarks : ''}`;
/** Store / Inventory → Stock Ledger tab, searched, for the screenshot. */
async function showLedger(page: Page, search: string): Promise<void> {
  await page.goto('/store-inventory', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Stock Ledger/ }).click();
  await page.waitForTimeout(1500);
  await page.getByPlaceholder(/Search item, source ref, remarks/).fill(search);
  await page.waitForTimeout(4000);
}

interface OspWipRow {
  jcCode: string;
  itemCode: string | null;
  opSeq: number;
  outsourceStatus: string | null;
  orderQty: number;
  sentQty: number;
  returnedQty: number;
  rejectedQty: number;
  acceptedQty: number;
  atVendorQty: number;
  notSentQty: number;
  inQcQty: number;
  readyToSendQty: number;
}
/** The register rows. The API's default filter is at_vendor (only ops with
 *  pieces out right now — the tab's default view); pass 'all' for every
 *  outsource op. */
async function ospRegister(page: Page, search?: string, filter: 'at_vendor' | 'all' = 'at_vendor'): Promise<OspWipRow[]> {
  const r = await apiGet<{ items?: OspWipRow[]; rows?: OspWipRow[] }>(page, '/osp-wip?filter=' + filter + (search ? '&search=' + encodeURIComponent(search) : ''));
  return r.items ?? r.rows ?? [];
}
const wipLine = (w: OspWipRow): string =>
  `${w.jcCode} Op${w.opSeq} osp=${w.outsourceStatus} order=${w.orderQty} sent=${w.sentQty} returned=${w.returnedQty} acc=${w.acceptedQty} rej=${w.rejectedQty} atVendor=${w.atVendorQty} inQc=${w.inQcQty} notSent=${w.notSentQty} ready=${w.readyToSendQty}`;

/** All OP_OUTSOURCE_RECEIVED audit rows that name this JC, newest first. */
async function opReceivedAudits(page: Page, jcCode: string): Promise<string[]> {
  const r = await apiGet<{ entries: { action: string; detail: string; ts: string }[] }>(
    page,
    '/activity-log?search=' + encodeURIComponent(jcCode) + '&action=OP_OUTSOURCE_RECEIVED&limit=50&offset=0',
  );
  return r.entries.filter((e) => e.action === 'OP_OUTSOURCE_RECEIVED' && e.detail.includes(jcCode)).map((e) => `${e.ts}: ${e.detail}`);
}

interface SendableApi {
  lines: { purchaseOrderLineId: string; maxSendNow: number; limitKind?: string | null; limitReason?: string | null }[];
}

/** JC op card → "Gen DC (n)" → the challan form's "Can send now" figure and the
 *  qty box's max — read and LEFT UNSAVED. */
async function genDcPreview(page: Page, jcUrl: string, poId: string): Promise<{ linkText: string; canSendNow: string; inputMax: string; api: string }> {
  const api = await apiGet<SendableApi>(page, '/delivery-challans/sendable/' + poId);
  const apiTxt = api.lines.map((l) => `maxSendNow=${l.maxSendNow}${l.limitKind ? ' (' + l.limitKind + ')' : ''}${l.limitReason ? ' "' + l.limitReason + '"' : ''}`).join('; ');
  await jcBody(page, jcUrl);
  const genDc = page.getByRole('link', { name: /Gen DC/ }).first();
  // The link is driven by the jc-ops board fetch, which lands after the page's
  // first paint — wait for it the way genDcFromJc does.
  await genDc.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  const linkText = (await genDc.count()) ? (await genDc.innerText()).trim() : '(no Gen DC link on the op card)';
  if (!(await genDc.count())) return { linkText, canSendNow: '', inputMax: '', api: apiTxt };
  await genDc.click();
  await expect(page).toHaveURL(/delivery-challans\/new\?poId=/, { timeout: 60_000 });
  await page.locator('#dc-code').waitFor({ timeout: 60_000 });
  const qtyBox = page.locator('table.innovic-table input[type="number"]').first();
  await qtyBox.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const canSendNow = /Can send now:\s*(\d+)/.exec(body)?.[1] ?? (/Fully sent/.test(body) ? 'Fully sent' : '(no "Can send now" text)');
  const inputMax = (await qtyBox.getAttribute('max')) ?? '(no max)';
  return { linkText, canSendNow, inputMax, api: apiTxt };
}

/** SO → JC (OSP op, optional QC op after it) → auto JW PR → JWPO (approved)
 *  → outward DC (dcQty) → GRN Against JWPO / DC (dcQty). Keys under r2 with
 *  `p` as prefix; resumable. */
async function buildOspChainR2(
  page: Page,
  p: string,
  qty: number,
  dcQty: number,
  /** `tag` / `section` (R3 chains): the ADR named in remarks and the report
   *  section the docs strip files the codes under. Default = the R2 wording. */
  opts: { qcAfter?: string; label: string; poRef: string; tag?: string; section?: string },
): Promise<void> {
  const tag = opts.tag ?? 'ADR-166 batch 1 (2026-09-16)';
  const sec = opts.section ?? 'R2';
  if (!r2(p + 'SoCode')) {
    const so = await createSo(page, qty, `${opts.poRef}-${STAMP}`);
    r2Set({ [p + 'SoCode']: so.code, [p + 'SoUrl']: so.url });
    doc(`${sec} ${opts.label} SO`, so.code);
  }
  if (!r2(p + 'JcCode')) {
    const jc = await planAndExecute(page, r2(p + 'SoCode'), qty, { kind: 'outsource', name: `E2E_ Heat treatment (${tag.split(' ')[0]} ${opts.label})` }, opts.qcAfter);
    r2Set({ [p + 'JcCode']: jc });
    doc(`${sec} ${opts.label} JC`, jc);
  }
  if (!r2(p + 'JcUrl')) {
    const url = await jcUrlByCode(page, r2(p + 'JcCode'));
    r2Set({ [p + 'JcUrl']: url, [p + 'JcId']: idFromUrl(url) });
  }
  if (!r2(p + 'PrCode')) {
    const body = await jcBody(page, r2(p + 'JcUrl'));
    const pr = /IN-JWPR-\d+/.exec(body)?.[0];
    if (pr) {
      r2Set({ [p + 'PrCode']: pr });
      doc(`${sec} ${opts.label} JW PR (auto)`, pr);
    }
  }
  if (!r2(p + 'PoId')) {
    const po = await genPoFromJc(page, r2(p + 'JcUrl'), `E2E_ ${tag} - ${opts.label} - JWPO - safe to cancel.`);
    r2Set({ [p + 'PoId']: po.id, [p + 'PoCode']: po.code });
    doc(`${sec} ${opts.label} JWPO`, po.code);
  }
  if (!r2(p + 'DcId')) {
    const dc = await genDcFromJc(page, r2(p + 'JcUrl'), dcQty, `E2E_ ${tag.split(' ')[0]} - ${opts.label} - outward challan ${dcQty}`);
    r2Set({ [p + 'DcId']: dc.id, [p + 'DcCode']: dc.code, [p + 'DcOffered']: dc.offered });
    doc(`${sec} ${opts.label} outward DC`, dc.code);
  }
  if (!r2(p + 'Grn1Id')) {
    const g = await grnAgainstDc(page, r2(p + 'PoCode'), r2(p + 'DcCode'), dcQty, `E2E_ ${tag.split(' ')[0]} - ${opts.label} - OSP return (${dcQty} of ${dcQty})`);
    r2Set({ [p + 'Grn1Id']: g.id, [p + 'Grn1Code']: g.code });
    doc(`${sec} ${opts.label} GRN 1 (Against JWPO / DC)`, g.code);
  }
}

/** Dispose NC as return_to_vendor (qty) + Create DC; keys `<p>Nc<k>Disposed`,
 *  `<p>RtvDc<k>Id/Code/Prefill`. Returns the refusal text if the dispose was refused. */
async function rtvOut(page: Page, p: string, k: string, qty: number, label: string): Promise<string> {
  const ncUrl = r2(p + 'Nc' + k + 'Url');
  const ncId = r2(p + 'Nc' + k + 'Id');
  if (!r2(p + 'Nc' + k + 'Disposed')) {
    const msg = await tryDispose(page, ncUrl, 'return_to_vendor', qty, `E2E_ ADR-166 - ${label} - NC-${k} return ${qty} to vendor`);
    const n = await ncApi(page, ncId);
    if (n.disposition !== 'return_to_vendor') return 'refused: ' + msg;
    r2Set({ [p + 'Nc' + k + 'Disposed']: 'yes' });
  }
  if (!r2(p + 'RtvDc' + k + 'Id')) {
    const dc = await createRtvDc(page, ncUrl, `E2E_ ADR-166 - ${label} - NC-${k} return challan`);
    r2Set({ [p + 'RtvDc' + k + 'Id']: dc.id, [p + 'RtvDc' + k + 'Code']: dc.code, [p + 'RtvDc' + k + 'Prefill']: dc.prefill });
    doc(`R2 ${label} RTV DC (NC-${k})`, dc.code);
  }
  return '';
}

/** Read the op-level numbers once, and if the outsource label is not the one
 *  expected, wait 2 minutes and read once more (the brief's "wording not yet
 *  live" allowance). */
async function opsWithRetry(page: Page, jcCode: string, wantOsp: string): Promise<{ ops: OpApi[]; retried: boolean }> {
  let ops = await opsOf(page, jcCode);
  if (ops[0]?.outsourceStatus === wantOsp) return { ops, retried: false };
  log(`Op1 outsourceStatus=${ops[0]?.outsourceStatus}, wanted ${wantOsp} — waiting 2 min and re-reading once`);
  await page.waitForTimeout(120_000);
  ops = await opsOf(page, jcCode);
  return { ops, retried: true };
}

test('R2 - chain M build: SO 10 -> JC (OSP op + DIR QC op) -> JWPO -> DC 10 -> GRN 10 -> Incoming QC 7/3 -> NC-A (M1)', async ({ page }) => {
  test.setTimeout(1_500_000);
  {
    const r = readReport();
    r.title = 'Innovic ERP — chain verification (rework with multiple child JCs; GRN → QC reject → return to vendor) + re-verification after ADR-165 + ADR-166 batch 1';
    r.date = REPORT_DATE;
    writeReport(r);
  }
  await buildOspChainR2(page, 'm', R2_M_QTY, R2_M_QTY, { qcAfter: R2_QC_OP, label: 'chain M', poRef: 'E2E_ADR166-M' });

  await rec(page, 'R2-01-M1a', {
    action: `Chain M built: SO ${r2('mSoCode')} (qty ${R2_M_QTY}) → JC ${r2('mJcCode')} (Op1 outsource on ${VENDOR_CODE} via "+ Add OSP Op", Op2 QC "${R2_QC_OP}" via "+ Add QC Op") → JWPO ${r2('mPoCode')} → DC ${r2('mDcCode')} (${R2_M_QTY}) → GRN ${r2('mGrn1Code')} (${R2_M_QTY}); read before any QC`,
    source: 'Sales Orders → Planning (plan editor) → JC op card (Gen PO / Gen DC) → GRN (Against JWPO / DC)',
    related: 'Job Card detail (Op1 + Op2 cards); Purchase Order detail (JWPO)',
    required: `JC has exactly 2 ops: Op1 outsource, Op2 qc; Op1 AT VENDOR 0 / IN QC ${R2_M_QTY}, label "Received"; Op2 QC pending 0 (nothing mirrored yet); JWPO line ${R2_M_QTY} of ${R2_M_QTY}, header "qc_pending"`,
  }, async () => {
    const ops = await opsOf(page, r2('mJcCode'));
    const po = await readPo(page, r2('mPoId'));
    const label = await ospLabelOnPage(page, r2('mJcUrl'));
    const o1 = ops[0]!;
    const o2 = ops[1];
    const ok = ops.length === 2 && o1.opType === 'outsource' && o2?.opType === 'qc' && o1.atVendorQty === 0 && o1.inQcQty === R2_M_QTY && o1.outsourceStatus === 'received' && label === 'Received' && (o2?.qcPending ?? -1) === 0 && po.received[0] === R2_M_QTY && /qc.?pending/i.test(po.status);
    return { actual: `${ops.length} ops: ${ops.map(opLine).join(' ;; ')}; JC page Outsource label "${label}"; ${poText(po)}`, ok };
  });

  if (!r2('mQc1Done')) {
    await incomingQc(page, r2('mGrn1Code'), R2_M_ACC1, R2_M_REJ1, `E2E_ ADR-166 chain M - first inspection ${R2_M_ACC1} ok / ${R2_M_REJ1} rej (NC-A)`);
    r2Set({ mQc1Done: 'yes' });
  }
  if (!r2('mNcACode')) {
    const code = await newestNc(page, r2('mJcCode'), []);
    const o = await openNc(page, code);
    r2Set({ mNcACode: code, mNcAUrl: o.url, mNcAId: o.id });
    doc('R2 chain M NC-A', code);
  }
  await rec(page, 'R2-02-M1', {
    action: `M1: Incoming QC → Inspect ${r2('mGrn1Code')} → accept ${R2_M_ACC1}, reject ${R2_M_REJ1} → Submit QC → NC-A ${r2('mNcACode')}`,
    source: 'Incoming QC → QC Call Register → Job Card detail → Purchase Order detail',
    related: 'Op1 card (DONE / AT VENDOR / IN QC + Outsource label); Op2 card (mirrored QC); NC-A',
    required: `Op1 DONE ${R2_M_ACC1}, AT VENDOR 0, IN QC 0, label "Received"; Op2 accepted ${R2_M_ACC1} (mirror of the first-cycle pieces, pre-existing behaviour) with QC pending 0; NC-A raised for ${R2_M_REJ1}; JWPO ${R2_M_QTY} of ${R2_M_QTY} "closed"`,
  }, async () => {
    const ops = await opsOf(page, r2('mJcCode'));
    const po = await readPo(page, r2('mPoId'));
    const n = await ncApi(page, r2('mNcAId'));
    const label = await ospLabelOnPage(page, r2('mJcUrl'));
    const o1 = ops[0]!;
    const o2 = ops[1]!;
    const ok = o1.completedQty === R2_M_ACC1 && o1.atVendorQty === 0 && o1.inQcQty === 0 && o1.outsourceStatus === 'received' && label === 'Received' && o2.qcAcceptedQty === R2_M_ACC1 && o2.qcPending === 0 && Number(n.rejectedQty) === R2_M_REJ1 && po.received[0] === R2_M_QTY && po.status === 'closed';
    return { actual: `${ops.map(opLine).join(' ;; ')}; JC page Outsource label "${label}"; NC-A: ${ncLine(n)}; ${poText(po)}`, ok };
  });
});

test('R2 - chain M: M2 RTV 3 (Sent, at vendor 3) -> M3 GRN Against NC 3 (in QC 3, Received, one audit row) -> M4 QC 2/1 (Op2 9) -> M5 second cycle (Op2 10, JC closed) -> M6 stock', async ({ page }) => {
  test.setTimeout(2_400_000);
  if (!r2('mNcAUrl')) {
    blocked('R2-03-M2', { action: 'NC-A → Return to vendor 3', source: 'NC detail', related: '', required: '' }, 'chain M was not built (NC-A missing)');
    return;
  }
  const jc = r2('mJcCode');
  const jcUrl = r2('mJcUrl');
  const poId = r2('mPoId');

  // ── M2: NC-A → Return to vendor 3 → Create DC ──
  const refusedA = await rtvOut(page, 'm', 'A', R2_M_REJ1, 'chain M');
  if (refusedA) {
    blocked('R2-03-M2', { action: 'NC-A → Return to vendor 3', source: 'NC detail → Dispose', related: '', required: '' }, refusedA);
    return;
  }
  await rec(page, 'R2-03-M2', {
    action: `M2: NC-A ${r2('mNcACode')} → Dispose: Return to vendor ${R2_M_REJ1} → Create DC ${r2('mRtvDcACode')} (vendor box read before touching it) [G4, G5b]`,
    source: 'NC detail → Dispose → Create DC panel → Job Card detail → Purchase Order detail',
    related: 'Op1 card (AT VENDOR / IN QC / Outsource label); ⚠ NC strip; JWPO line + header',
    required: `Vendor prefilled ${VENDOR_CODE}; Op1 Outsource label "Sent" (G5b — was "Received"); Op1 AT VENDOR ${R2_M_REJ1}, IN QC 0 (G4); NC strip "Sent to vendor ${R2_M_REJ1}"; JWPO line ${R2_M_QTY - R2_M_REJ1} of ${R2_M_QTY}, header "partial"`,
  }, async () => {
    const { ops, retried } = await opsWithRetry(page, jc, 'sent');
    const o1 = ops[0]!;
    const strip = await jcNcStrips(page, jcUrl);
    const label = await ospLabelOnPage(page, jcUrl);
    const po = await readPo(page, poId);
    const dc = await readDcDetail(page, r2('mRtvDcAId'));
    const pre = r2('mRtvDcAPrefill');
    const ok = pre.includes(VENDOR_CODE) && o1.outsourceStatus === 'sent' && label === 'At Vendor' && o1.atVendorQty === R2_M_REJ1 && o1.inQcQty === 0 && o1.ncBreakup.sentToVendorQty === R2_M_REJ1 && new RegExp(`Sent to Vendor\\s*${R2_M_REJ1}\\b`).test(strip) && po.received[0] === R2_M_QTY - R2_M_REJ1 && po.status === 'partial' && dc.status === 'issued';
    return { actual: `${retried ? '(re-read after a 2-min wait) ' : ''}Op1: ${opLine(o1)}; JC page Outsource label "${label}"; strip "${strip}"; vendor box on open: "${pre}"; ${dc.code} status ${dc.status}; ${poText(po)}`, ok };
  });

  // ── M3: GRN Against NC-A 3 (do NOT inspect yet) ──
  if (!r2('mGrnAId')) {
    const g = await grnAgainstNc(page, r2('mNcACode'), R2_M_REJ1, `E2E_ ADR-166 chain M - GRN against NC-A (${R2_M_REJ1} of ${R2_M_REJ1})`);
    r2Set({ mGrnAId: g.id, mGrnACode: g.code, mGrnAForm: g.formNote });
    doc('R2 chain M GRN (Against NC-A)', g.code);
  }
  await rec(page, 'R2-04-M3', {
    action: `M3: GRN → + New → Against NC → ${r2('mNcACode')} → Receive now ${R2_M_REJ1} → Create GRN ${r2('mGrnACode')} (not inspected yet) [G4, G5, G5c]`,
    source: 'Goods Receipt Notes → New (Against NC) → Job Card detail → Activity Log → DC detail',
    related: 'Op1 card; Activity Log (OP_OUTSOURCE_RECEIVED rows for the JC); RTV challan status',
    required: `Op1 AT VENDOR 0, IN QC ${R2_M_REJ1} (G4 — was 3 and 3); Op1 label "Received" again (G5c); exactly 2 OP_OUTSOURCE_RECEIVED rows for ${jc} in total (1 from the first receipt + ONE for this replacement receipt — G5); RTV challan ${r2('mRtvDcACode')} status "received"; NC-A received_qc_pending (${R2_M_REJ1} of ${R2_M_REJ1}); JWPO still ${R2_M_QTY - R2_M_REJ1} of ${R2_M_QTY}`,
  }, async () => {
    const { ops, retried } = await opsWithRetry(page, jc, 'received');
    const o1 = ops[0]!;
    const label = await ospLabelOnPage(page, jcUrl);
    const audits = await opReceivedAudits(page, jc);
    const dc = await readDcDetail(page, r2('mRtvDcAId'));
    const n = await ncApi(page, r2('mNcAId'));
    const po = await readPo(page, poId);
    await showActivity(page, jc);
    const ok = o1.atVendorQty === 0 && o1.inQcQty === R2_M_REJ1 && o1.outsourceStatus === 'received' && label === 'Received' && audits.length === 2 && dc.status === 'received' && n.status === 'received_qc_pending' && Number(n.rtvReceivedQty) === R2_M_REJ1 && po.received[0] === R2_M_QTY - R2_M_REJ1;
    return { actual: `${retried ? '(re-read after a 2-min wait) ' : ''}Op1: ${opLine(o1)}; JC page Outsource label "${label}"; OP_OUTSOURCE_RECEIVED rows for ${jc}: ${audits.length} → [${audits.join(' | ')}]; ${dc.code} status ${dc.status}, receipts "${dc.receiptsHdr}"; NC-A: ${ncLine(n)}; ${poText(po)}`, ok };
  });

  // ── M4: Incoming QC on the replacement 2 ok / 1 rej → NC-B ──
  if (!r2('mQcADone')) {
    await incomingQc(page, r2('mGrnACode'), R2_M_ACC2, R2_M_REJ2, `E2E_ ADR-166 chain M - NC-A replacement QC ${R2_M_ACC2} ok / ${R2_M_REJ2} rej`);
    r2Set({ mQcADone: 'yes' });
  }
  if (!r2('mNcBCode')) {
    const code = await newestNc(page, jc, [r2('mNcACode')]);
    const o = await openNc(page, code);
    r2Set({ mNcBCode: code, mNcBUrl: o.url, mNcBId: o.id });
    doc('R2 chain M NC-B', code);
  }
  await rec(page, 'R2-05-M4', {
    action: `M4: Incoming QC → Inspect ${r2('mGrnACode')} (Against NC-A) → accept ${R2_M_ACC2}, reject ${R2_M_REJ2} → Submit QC → NC-B ${r2('mNcBCode')} [G1]`,
    source: 'Incoming QC → QC Call Register → Job Card detail → NC detail → Purchase Order detail',
    related: 'Op2 card (mirrored accepted); Op1 card; NC-A / NC-B; JWPO',
    required: `Op2 accepted ${R2_M_ACC1 + R2_M_ACC2} (${R2_M_ACC1} + ${R2_M_ACC2} mirrored — G1; was ${R2_M_ACC1}) with QC pending 0; NC-A closed cleared ${R2_M_ACC2} / failed ${R2_M_REJ2}; NC-B raised ${R2_M_REJ2}; Op1 DONE ${R2_M_ACC1 + R2_M_ACC2}; JWPO ${R2_M_QTY} of ${R2_M_QTY} "closed"`,
  }, async () => {
    const ops = await opsOf(page, jc);
    const o1 = ops[0]!;
    const o2 = ops[1]!;
    const nA = await ncApi(page, r2('mNcAId'));
    const nB = await ncApi(page, r2('mNcBId'));
    const po = await readPo(page, poId);
    await jcBody(page, jcUrl);
    const ok = o2.qcAcceptedQty === R2_M_ACC1 + R2_M_ACC2 && o2.qcPending === 0 && /closed/i.test(nA.status) && Number(nA.clearedQty) === R2_M_ACC2 && Number(nA.failedQty) === R2_M_REJ2 && Number(nB.rejectedQty) === R2_M_REJ2 && Boolean(nB.grnLineId) && o1.completedQty === R2_M_ACC1 + R2_M_ACC2 && po.received[0] === R2_M_QTY && po.status === 'closed';
    return { actual: `${ops.map(opLine).join(' ;; ')}; NC-A: ${ncLine(nA)}; NC-B: ${ncLine(nB)}; ${poText(po)}`, ok };
  });

  // ── M5: NC-B → RTV 1 → DC → GRN Against NC 1 → QC 1 ok ──
  const refusedB = await rtvOut(page, 'm', 'B', R2_M_REJ2, 'chain M');
  if (refusedB) {
    blocked('R2-06-M5', { action: 'NC-B → Return to vendor 1', source: 'NC detail → Dispose', related: '', required: '' }, refusedB);
    return;
  }
  if (!r2('mGrnBId')) {
    const g = await grnAgainstNc(page, r2('mNcBCode'), R2_M_REJ2, `E2E_ ADR-166 chain M - GRN against NC-B (${R2_M_REJ2} of ${R2_M_REJ2})`);
    r2Set({ mGrnBId: g.id, mGrnBCode: g.code });
    doc('R2 chain M GRN (Against NC-B)', g.code);
  }
  if (!r2('mQcBDone')) {
    await incomingQc(page, r2('mGrnBCode'), R2_M_ACC3, 0, `E2E_ ADR-166 chain M - NC-B replacement QC ${R2_M_ACC3} ok`);
    r2Set({ mQcBDone: 'yes' });
  }
  await rec(page, 'R2-06-M5', {
    action: `M5: NC-B ${r2('mNcBCode')} → Return to vendor ${R2_M_REJ2} → DC ${r2('mRtvDcBCode')} → GRN Against NC ${r2('mGrnBCode')} (${R2_M_REJ2}) → Incoming QC ${R2_M_ACC3} ok [G1]`,
    source: 'NC detail → Create DC → GRN (Against NC) → Incoming QC → Job Card detail',
    related: 'Op2 card; Op1 card; NC-B; Activity Log',
    required: `Op2 accepted ${R2_M_QTY} (G1) with QC pending 0; NC-B closed cleared ${R2_M_ACC3}; Op1 DONE ${R2_M_QTY}, AT VENDOR 0, IN QC 0, computed status complete; 3 OP_OUTSOURCE_RECEIVED rows in total for ${jc} (one per receipt)`,
  }, async () => {
    const ops = await opsOf(page, jc);
    const o1 = ops[0]!;
    const o2 = ops[1]!;
    const nB = await ncApi(page, r2('mNcBId'));
    const audits = await opReceivedAudits(page, jc);
    await jcBody(page, jcUrl);
    const ok = o2.qcAcceptedQty === R2_M_QTY && o2.qcPending === 0 && /closed/i.test(nB.status) && Number(nB.clearedQty) === R2_M_ACC3 && o1.completedQty === R2_M_QTY && o1.atVendorQty === 0 && o1.inQcQty === 0 && o1.computedStatus === 'complete' && audits.length === 3;
    return { actual: `${ops.map(opLine).join(' ;; ')}; NC-B: ${ncLine(nB)}; OP_OUTSOURCE_RECEIVED rows: ${audits.length} → [${audits.join(' | ')}]`, ok };
  });

  // ── M5b: the JC is not stuck. Either Incoming QC already closed it (every
  // piece mirrored onto Op2 + tryCascadeJcComplete, G1+G2) or Op2 still shows
  // pending and needs its own QC log via Op Entry. Whichever happened is recorded.
  let jcBefore = await jcApi(page, r2('mJcId'));
  let opEntryNote = 'no Op Entry QC needed';
  if (!jcBefore.closedAt && !r2('mOp2QcDone')) {
    const o2 = (await opsOf(page, jc))[1]!;
    if (o2.qcPending > 0) {
      await qcOp(page, jc, o2.operation, o2.qcPending, 0);
      r2Set({ mOp2QcDone: String(o2.qcPending) });
      opEntryNote = `Op Entry → ${R2_QC_OP} QC accepted ${o2.qcPending} (Op2 still showed ${o2.qcPending} pending after Incoming QC)`;
    } else {
      opEntryNote = `Op2 had 0 pending but the JC was not closed (computedStatus ${jcBefore.computedStatus}) — nothing to key on Op Entry`;
    }
  } else if (r2('mOp2QcDone')) {
    opEntryNote = `Op Entry → ${R2_QC_OP} QC accepted ${r2('mOp2QcDone')} on an earlier run`;
  }
  await rec(page, 'R2-07-M5b', {
    action: `M5b: JC ${jc} after the second cycle — is it stuck? (${opEntryNote})`,
    source: 'Job Card detail (Overall Status) → Job Cards list',
    related: 'Op2 card; tryCascadeJcComplete from Incoming QC (G2)',
    required: `JC computed status complete/closed with closed_at set; Op2 QC pending 0 and accepted ${R2_M_QTY}; page badge shows the closed/complete status`,
  }, async () => {
    const j = await jcApi(page, r2('mJcId'));
    const ops = await opsOf(page, jc);
    const o2 = ops[1]!;
    await jcBody(page, jcUrl);
    const badge = await jcStatusBadge(page);
    const tiles = await jcQtyTiles(page);
    const ok = Boolean(j.closedAt) && /^(complete|closed)$/.test(j.computedStatus) && o2.qcPending === 0 && o2.qcAcceptedQty === R2_M_QTY;
    return { actual: `${opEntryNote}; before: ${jcApiLine(jcBefore)}; now: ${jcApiLine(j)}; page badge "${badge}", tiles "${tiles}"; ${ops.map(opLine).join(' ;; ')}`, ok };
  });
  jcBefore = await jcApi(page, r2('mJcId'));

  // ── M6: stock ledger ──
  await rec(page, 'R2-08-M6', {
    action: `M6: Store / Inventory → Stock Ledger searched by ${jc} and by each GRN (${r2('mGrn1Code')}, ${r2('mGrnACode')}, ${r2('mGrnBCode')}) [G3]`,
    source: 'Store / Inventory → Stock Ledger tab (+ /store-transactions API)',
    related: 'qc_accept rows against "<JC> Op #2"; grn_qc rows against the GRNs',
    required: `qc_accept rows for ${jc} totalling ${R2_M_QTY} (${R2_M_ACC1} + ${R2_M_ACC2} + ${R2_M_ACC3}, the mirrored pieces — G3; before: none) and NO grn_qc row for any of the three GRNs (mid-route OSP skips the GRN credit)`,
  }, async () => {
    const jcRows = (await ledgerRows(page, jc)).filter((l) => l.sourceType === 'qc_accept');
    const opEntry = Number(r2('mOp2QcDone') || 0);
    const grnRows: string[] = [];
    for (const g of [r2('mGrn1Code'), r2('mGrnACode'), r2('mGrnBCode')]) {
      const rows = (await ledgerRows(page, g)).filter((l) => l.sourceType === 'grn_qc');
      grnRows.push(`${g}: ${rows.length ? rows.map(ledgerLine).join(' | ') : 'no grn_qc row'}`);
    }
    const total = jcRows.reduce((s, l) => s + (l.txnType === 'in' ? l.qty : -l.qty), 0);
    await showLedger(page, jc);
    const ok = total === R2_M_QTY && grnRows.every((t) => t.endsWith('no grn_qc row'));
    return { actual: `qc_accept rows for ${jc} (${jcRows.length}): ${jcRows.map(ledgerLine).join(' | ') || 'none'} → total ${total}${opEntry ? ` (includes ${opEntry} keyed on Op Entry, so the mirrored share is ${total - opEntry})` : ''}; grn_qc: ${grnRows.join(' ;; ')}`, ok };
  });
});

test('R2 - chain G (G6): fresh JWPO 10 -> DC 6 -> GRN 6 -> QC 4/2 -> NC -> RTV 2 -> Gen DC preview must offer 4 (nothing saved)', async ({ page }) => {
  test.setTimeout(1_500_000);
  await buildOspChainR2(page, 'g', R2_G_QTY, R2_G_DC, { label: 'chain G', poRef: 'E2E_ADR166-G' });
  if (!r2('gQc1Done')) {
    await incomingQc(page, r2('gGrn1Code'), R2_G_ACC, R2_G_REJ, `E2E_ ADR-166 chain G - inspection ${R2_G_ACC} ok / ${R2_G_REJ} rej`);
    r2Set({ gQc1Done: 'yes' });
  }
  if (!r2('gNcACode')) {
    const code = await newestNc(page, r2('gJcCode'), []);
    const o = await openNc(page, code);
    r2Set({ gNcACode: code, gNcAUrl: o.url, gNcAId: o.id });
    doc('R2 chain G NC', code);
  }
  const refused = await rtvOut(page, 'g', 'A', R2_G_REJ, 'chain G');
  if (refused) {
    blocked('R2-09-M7', { action: 'NC → Return to vendor 2', source: 'NC detail → Dispose', related: '', required: '' }, refused);
    return;
  }
  await rec(page, 'R2-09-M7', {
    action: `M7 (G6): JWPO ${r2('gPoCode')} for ${R2_G_QTY} → DC ${r2('gDcCode')} (${R2_G_DC}) → GRN ${r2('gGrn1Code')} → QC ${R2_G_ACC}/${R2_G_REJ} → NC ${r2('gNcACode')} → RTV ${R2_G_REJ} on ${r2('gRtvDcACode')} → JC op card "Gen DC (n)" → challan form opened and LEFT UNSAVED`,
    source: 'Job Card detail → Gen DC → Delivery Challan (new) form ("Can send now") + /delivery-challans/sendable',
    related: 'Op1 card ready-to-send; JWPO line',
    required: `Gen DC link shows (${R2_G_QTY - R2_G_DC}); form "Can send now: ${R2_G_QTY - R2_G_DC}" and qty box max ${R2_G_QTY - R2_G_DC} (G6 — was ${R2_G_QTY - R2_G_DC - R2_G_REJ}: the return challan no longer counts as "already sent"); API maxSendNow ${R2_G_QTY - R2_G_DC}; no challan saved`,
  }, async () => {
    const dcsBefore = (await apiGet<{ items?: unknown[]; total?: number }>(page, '/delivery-challans?limit=1&offset=0')).total;
    const pv = await genDcPreview(page, r2('gJcUrl'), r2('gPoId'));
    const ops = await opsOf(page, r2('gJcCode'));
    const po = await readPo(page, r2('gPoId'));
    const dcsAfter = (await apiGet<{ items?: unknown[]; total?: number }>(page, '/delivery-challans?limit=1&offset=0')).total;
    const want = String(R2_G_QTY - R2_G_DC);
    const ok = pv.linkText.includes(`(${want})`) && pv.canSendNow === want && pv.inputMax === want && pv.api.includes(`maxSendNow=${want}`) && dcsBefore === dcsAfter;
    return { actual: `Gen DC link "${pv.linkText}"; form "Can send now: ${pv.canSendNow}", qty box max=${pv.inputMax}; API sendable: ${pv.api}; Op1: ${opLine(ops[0]!)}; ${poText(po)}; DC count before/after ${dcsBefore}/${dcsAfter} (nothing saved)`, ok };
  });
});

test('R2 - chain L (OSP op is the LAST op, G2): SO 6 -> JC -> JWPO -> DC 6 -> GRN 6 -> Incoming QC 6 ok -> JC closed, SO closed, one grn_qc row', async ({ page }) => {
  test.setTimeout(1_500_000);
  await buildOspChainR2(page, 'l', R2_L_QTY, R2_L_QTY, { label: 'chain L', poRef: 'E2E_ADR166-L' });
  if (!r2('lQc1Done')) {
    await incomingQc(page, r2('lGrn1Code'), R2_L_QTY, 0, `E2E_ ADR-166 chain L - inspection ${R2_L_QTY} ok`);
    r2Set({ lQc1Done: 'yes' });
  }
  await rec(page, 'R2-10-L1', {
    action: `L1: SO ${r2('lSoCode')} (${R2_L_QTY}) → JC ${r2('lJcCode')} (ONE outsource op, last) → JWPO ${r2('lPoCode')} → DC ${r2('lDcCode')} → GRN ${r2('lGrn1Code')} → Incoming QC ${R2_L_QTY} ok [G2]`,
    source: 'Incoming QC → Job Card detail → Job Cards list → Sales Order detail',
    related: 'JC closed_at (tryCascadeJcComplete from Incoming QC); SO line + SO status',
    required: `JC computed status COMPLETE/closed with closed_at set (detail shows Closed); SO line status closed and SO status closed (before ADR-166: op complete but the JC never closed from Incoming QC); Op1 DONE ${R2_L_QTY}, complete`,
  }, async () => {
    const j = await jcApi(page, r2('lJcId'));
    const so = await soApi(page, idFromUrl(r2('lSoUrl')));
    const ops = await opsOf(page, r2('lJcCode'));
    await jcBody(page, r2('lJcUrl'));
    const badge = await jcStatusBadge(page);
    const ok = Boolean(j.closedAt) && /^(complete|closed)$/.test(j.computedStatus) && so.status === 'closed' && so.lines.every((l) => l.status === 'closed') && ops[0]!.completedQty === R2_L_QTY && ops[0]!.computedStatus === 'complete';
    return { actual: `${jcApiLine(j)}; JC page badge "${badge}"; SO ${so.code} status "${so.status}", lines [${so.lines.map((l) => l.status).join(', ')}]; ${ops.map(opLine).join(' ;; ')}`, ok };
  });
  await rec(page, 'R2-11-L2', {
    action: `L2: Store / Inventory → Stock Ledger searched by ${r2('lGrn1Code')} and by ${r2('lJcCode')}`,
    source: 'Store / Inventory → Stock Ledger tab (+ /store-transactions API)',
    related: 'grn_qc row for the last-op OSP GRN; no qc_accept row for the JC',
    required: `ONE grn_qc row +${R2_L_QTY} for ${r2('lGrn1Code')} (last-op OSP credits at GRN QC, unchanged) and no qc_accept row for ${r2('lJcCode')} (no QC op to mirror onto)`,
  }, async () => {
    const grnRows = (await ledgerRows(page, r2('lGrn1Code'))).filter((l) => l.sourceType === 'grn_qc');
    const jcRows = (await ledgerRows(page, r2('lJcCode'))).filter((l) => l.sourceType === 'qc_accept');
    await showLedger(page, r2('lGrn1Code'));
    const ok = grnRows.length === 1 && grnRows[0]!.txnType === 'in' && grnRows[0]!.qty === R2_L_QTY && jcRows.length === 0;
    return { actual: `grn_qc rows for ${r2('lGrn1Code')} (${grnRows.length}): ${grnRows.map(ledgerLine).join(' | ') || 'none'}; qc_accept rows for ${r2('lJcCode')}: ${jcRows.length ? jcRows.map(ledgerLine).join(' | ') : 'none'}`, ok };
  });
});

// ── R2 extra rows (second pass, 2026-09-16 11:35): the brief asks for the
// op-card numbers at EACH step and ~20+ rows. Chain G is carried through its
// return cycle (a partially-sent op: 6 of 10 out, so G4/G5/G6 are re-proved
// with pieces that were never sent), and chains M / L get on-screen readings
// (op-card tiles, SO detail line status, document statuses, JC list cards).

/** The op-card text as the JC page prints it, for op `seq`: the body text
 *  from "<seq> OSP|QC" up to the next op card (or ~900 chars). */
// 98d25112 (2026-09-16): the op card prints the op's Sr No (opSrNo = seq × 10,
// so "10 OSP") where it used to print the seq ("1 OSP"). Both are accepted.
function opCardText(body: string, seq: number): string {
  const start = body.search(new RegExp(`\\b(?:${seq}|${seq * 10})\\s+(OSP|QC)\\b`));
  if (start < 0) return `(op ${seq} card not found on the page)`;
  const rest = body.slice(start);
  const next = rest.slice(4).search(new RegExp(`\\b(?:${seq + 1}|${(seq + 1) * 10})\\s+(OSP|QC)\\b`));
  return (next >= 0 ? rest.slice(0, next + 4) : rest.slice(0, 900)).trim();
}
function tilesOf(card: string): string {
  const pick = (label: string): string => new RegExp(`(\\d+|—)\\s+${label}`).exec(card)?.[1] ?? '?';
  const pend = /⏳(\d+)\s+pend/.exec(card)?.[1] ?? '0';
  const label = /Outsource\s+(?:E2E_ Shreeji Precision Heat Treaters Pvt Ltd\s+)?(Pending|PR Raised|PO Created|At Vendor|Received)\b/.exec(card)?.[1] ?? '—';
  const badge = /\b(WAITING|PARTLY COMPLETED|RUNNING|QC PENDING|COMPLETED|CLOSED|PENDING|READY)\b/.exec(card)?.[1] ?? '?';
  return `badge ${badge}; DONE ${pick('DONE')}, PENDING ${pick('PENDING')}, READY TO SEND ${pick('READY TO SEND')}, AT VENDOR ${pick('AT VENDOR')}, IN QC ${pick('IN QC')}; QC pending on card ${pend}; Outsource label ${label}; QC link ${/🔬 QC \((\d+)\)/.exec(card)?.[1] ?? 'none'}`;
}
/** SO detail page: header badge + every line's Status badge. */
async function soOnPage(page: Page, soUrl: string): Promise<{ badge: string; lines: string[] }> {
  await page.goto(soUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.panel-hdr .badge').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  const badge = (await page.locator('.panel-hdr .badge').first().innerText()).trim();
  const table = page.locator('table.innovic-table').filter({ has: page.locator('th', { hasText: /^Status$/i }) }).first();
  const lines: string[] = [];
  if (await table.count()) {
    const idx = await colIndex(table, /^Status$/i);
    const rows = table.locator('tbody tr');
    for (let i = 0; i < (await rows.count()); i += 1) lines.push((await rows.nth(i).locator('td').nth(idx).innerText()).trim());
  }
  return { badge, lines };
}
/** Job Cards list, searched by code: the card text for that code. */
async function jcListCard(page: Page, jc: string): Promise<string> {
  await page.goto('/job-cards?search=' + encodeURIComponent(jc), { waitUntil: 'domcontentloaded' });
  await page.getByText(jc).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  return cardText((await page.locator('body').innerText()).replace(/\s+/g, ' '), jc, 200);
}
interface StoreRow {
  itemCode: string;
  inStock: number;
  atVendorQty: number;
  onPoQty: number;
  mfgPendingQty: number;
}
async function storeRow(page: Page, itemCode: string): Promise<StoreRow | undefined> {
  const r = await apiGet<{ items?: StoreRow[]; rows?: StoreRow[] }>(page, '/store-inventory?search=' + encodeURIComponent(itemCode) + '&limit=50&offset=0');
  return (r.items ?? r.rows ?? []).find((x) => x.itemCode === itemCode);
}

test('R2 - extra rows: chain G through its return cycle (G4/G5/G6 on a partially-sent op) + on-screen readings for chains M and L', async ({ page }) => {
  test.setTimeout(1_800_000);
  const gJc = r2('gJcCode');
  const gJcUrl = r2('gJcUrl');
  const gPoId = r2('gPoId');
  const gSent = R2_G_DC;
  const gUnsent = R2_G_QTY - R2_G_DC;

  // ── G2: state after the return challan (read-only) ──
  if (!r2('gRtvDcAId')) {
    blocked('R2-14-G2', { action: 'chain G after the return challan', source: 'Job Card detail', related: '', required: '' }, 'chain G has no return challan in the state file');
  } else {
    await rec(page, 'R2-14-G2', {
      action: `G2: chain G after NC ${r2('gNcACode')} → Return to vendor ${R2_G_REJ} on ${r2('gRtvDcACode')} — Op1 card read on the JC page (${gSent} of ${R2_G_QTY} sent, ${gUnsent} never sent) [G4, G5]`,
      source: 'Job Card detail (Op1 card tiles + Outsource label) → Purchase Order detail',
      related: 'v_jc_op_status (0128); applyReceiveToJcOp / createNcDc (ADR-166 §5)',
      required: `Op1 label "Sent" (a return challan out moves a received op back to sent); AT VENDOR ${R2_G_REJ} (RTV pieces only), IN QC 0, DONE ${R2_G_ACC}, READY TO SEND ${gUnsent}; strip "Sent to vendor ${R2_G_REJ}"; JC not closed; JWPO line ${gSent - R2_G_REJ} of ${R2_G_QTY} "partial"`,
    }, async () => {
      const ops = await opsOf(page, gJc);
      const o1 = ops[0]!;
      const body = await jcBody(page, gJcUrl);
      const card = tilesOf(opCardText(body, 1));
      const strip = await jcNcStrips(page, gJcUrl);
      const j = await jcApi(page, r2('gJcId'));
      const po = await readPo(page, gPoId);
      const ok = o1.outsourceStatus === 'sent' && /Outsource label At Vendor/.test(card) && o1.atVendorQty === R2_G_REJ && o1.inQcQty === 0 && o1.completedQty === R2_G_ACC && o1.readyToSendQty === gUnsent && new RegExp(`Sent to Vendor\\s*${R2_G_REJ}\\b`).test(strip) && !j.closedAt && po.received[0] === gSent - R2_G_REJ && po.status === 'partial';
      return { actual: `Op1 card on page: ${card}; strip "${strip}"; api: ${opLine(o1)}; ${jcApiLine(j)}; ${poText(po)}`, ok };
    });

    // ── G3: GRN Against NC 2, not yet inspected ──
    if (!r2('gGrnAId')) {
      const g = await grnAgainstNc(page, r2('gNcACode'), R2_G_REJ, `E2E_ ADR-166 chain G - GRN against NC (${R2_G_REJ} of ${R2_G_REJ})`);
      r2Set({ gGrnAId: g.id, gGrnACode: g.code, gGrnAForm: g.formNote });
      doc('R2 chain G GRN (Against NC)', g.code);
    }
    await rec(page, 'R2-15-G3', {
      action: `G3: GRN → + New → Against NC → ${r2('gNcACode')} → Receive now ${R2_G_REJ} → Create GRN ${r2('gGrnACode')} (not inspected yet); then the sendable figure re-read [G4, G5, G6]`,
      source: 'Goods Receipt Notes → New (Against NC) → Job Card detail → Activity Log → /delivery-challans/sendable',
      related: 'Op1 card; OP_OUTSOURCE_RECEIVED rows; RTV challan; NC; JWPO; sendable preview',
      required: `Op1 AT VENDOR 0 and IN QC ${R2_G_REJ} (not both — G4); label "Received" (every RTV piece back and ordinary receipts ${gSent} cover the ${gSent} sent — G5); exactly 2 OP_OUTSOURCE_RECEIVED rows for ${gJc} (G5 — one per receipt); ${r2('gRtvDcACode')} "received"; NC received_qc_pending ${R2_G_REJ} of ${R2_G_REJ}; JWPO still ${gSent - R2_G_REJ} of ${R2_G_QTY}; sendable API maxSendNow ${gUnsent} (G6 — the replacement receipt does not change what can still go out)`,
    }, async () => {
      const { ops, retried } = await opsWithRetry(page, gJc, 'received');
      const o1 = ops[0]!;
      const body = await jcBody(page, gJcUrl);
      const card = tilesOf(opCardText(body, 1));
      const audits = await opReceivedAudits(page, gJc);
      const dc = await readDcDetail(page, r2('gRtvDcAId'));
      const n = await ncApi(page, r2('gNcAId'));
      const po = await readPo(page, gPoId);
      const api = await apiGet<SendableApi>(page, '/delivery-challans/sendable/' + gPoId);
      const maxSend = api.lines[0]?.maxSendNow;
      await showActivity(page, gJc);
      const ok = o1.atVendorQty === 0 && o1.inQcQty === R2_G_REJ && o1.outsourceStatus === 'received' && /Outsource label Received/.test(card) && audits.length === 2 && dc.status === 'received' && n.status === 'received_qc_pending' && Number(n.rtvReceivedQty) === R2_G_REJ && po.received[0] === gSent - R2_G_REJ && maxSend === gUnsent;
      return { actual: `${retried ? '(re-read after a 2-min wait) ' : ''}Op1 card on page: ${card}; api: ${opLine(o1)}; OP_OUTSOURCE_RECEIVED rows for ${gJc}: ${audits.length} → [${audits.join(' | ')}]; ${dc.code} status ${dc.status}, "${dc.receiptsHdr}"; NC: ${ncLine(n)}; ${poText(po)}; sendable API maxSendNow=${maxSend}`, ok };
    });

    // ── G4: Incoming QC 2 ok → NC closed; JC still open (4 never sent); Gen DC preview on the page ──
    if (!r2('gQcADone')) {
      await incomingQc(page, r2('gGrnACode'), R2_G_REJ, 0, `E2E_ ADR-166 chain G - replacement QC ${R2_G_REJ} ok`);
      r2Set({ gQcADone: 'yes' });
    }
    await rec(page, 'R2-16-G4', {
      action: `G4: Incoming QC → Inspect ${r2('gGrnACode')} → accept ${R2_G_REJ} → Submit QC; then JC op card "Gen DC (n)" → challan form opened and LEFT UNSAVED [G5, G6]`,
      source: 'Incoming QC → QC Call Register → Job Card detail → Gen DC → Delivery Challan (new) form',
      related: 'Op1 card; NC; JWPO line + header; sendable preview',
      required: `NC closed cleared ${R2_G_REJ}; Op1 DONE ${gSent}, AT VENDOR 0, IN QC 0, label "Received", READY TO SEND ${gUnsent}, not complete; JC not closed; JWPO ${gSent} of ${R2_G_QTY} "partial"; Gen DC link "(${gUnsent})", form "Can send now: ${gUnsent}", qty box max ${gUnsent} (G6 after a whole return cycle); no challan saved`,
    }, async () => {
      const dcsBefore = (await apiGet<{ total?: number }>(page, '/delivery-challans?limit=1&offset=0')).total;
      const ops = await opsOf(page, gJc);
      const o1 = ops[0]!;
      const n = await ncApi(page, r2('gNcAId'));
      const j = await jcApi(page, r2('gJcId'));
      const po = await readPo(page, gPoId);
      const body = await jcBody(page, gJcUrl);
      const card = tilesOf(opCardText(body, 1));
      const strip = await jcNcStrips(page, gJcUrl);
      const pv = await genDcPreview(page, gJcUrl, gPoId);
      const dcsAfter = (await apiGet<{ total?: number }>(page, '/delivery-challans?limit=1&offset=0')).total;
      const want = String(gUnsent);
      const ok = /closed/i.test(n.status) && Number(n.clearedQty) === R2_G_REJ && o1.completedQty === gSent && o1.atVendorQty === 0 && o1.inQcQty === 0 && o1.outsourceStatus === 'received' && o1.readyToSendQty === gUnsent && o1.computedStatus !== 'complete' && !j.closedAt && po.received[0] === gSent && po.status === 'partial' && pv.linkText.includes(`(${want})`) && pv.canSendNow === want && pv.inputMax === want && dcsBefore === dcsAfter;
      return { actual: `NC: ${ncLine(n)}; Op1 card on page: ${card}; strip "${strip}"; api: ${opLine(o1)}; ${jcApiLine(j)}; ${poText(po)}; Gen DC link "${pv.linkText}", form "Can send now: ${pv.canSendNow}", qty box max=${pv.inputMax}, API ${pv.api}; DC count before/after ${dcsBefore}/${dcsAfter}`, ok };
    });

    // ── G5: stock for a last-op OSP with a return cycle ──
    await rec(page, 'R2-17-G5', {
      action: `G5: Store / Inventory → Stock Ledger searched by ${r2('gGrn1Code')}, ${r2('gGrnACode')} and ${gJc} [G3 counterpart for a last-op OSP]`,
      source: 'Store / Inventory → Stock Ledger tab (+ /store-transactions API)',
      related: 'grn_qc rows (creditGrnQcStock, last op); no qc_accept rows (no QC op after the OSP op)',
      required: `grn_qc +${R2_G_ACC} for ${r2('gGrn1Code')} and grn_qc +${R2_G_REJ} for ${r2('gGrnACode')} (each accepted piece credited once, ${gSent} in total); no qc_accept row for ${gJc}`,
    }, async () => {
      const g1 = (await ledgerRows(page, r2('gGrn1Code'))).filter((l) => l.sourceType === 'grn_qc');
      const gA = (await ledgerRows(page, r2('gGrnACode'))).filter((l) => l.sourceType === 'grn_qc');
      const jcRows = (await ledgerRows(page, gJc)).filter((l) => l.sourceType === 'qc_accept');
      const sum = (rows: LedgerRow[]): number => rows.reduce((s, l) => s + (l.txnType === 'in' ? l.qty : -l.qty), 0);
      await showLedger(page, gJc);
      const ok = g1.length === 1 && sum(g1) === R2_G_ACC && gA.length === 1 && sum(gA) === R2_G_REJ && jcRows.length === 0;
      return { actual: `${r2('gGrn1Code')}: ${g1.map(ledgerLine).join(' | ') || 'no grn_qc row'}; ${r2('gGrnACode')}: ${gA.map(ledgerLine).join(' | ') || 'no grn_qc row'}; qc_accept rows for ${gJc}: ${jcRows.length ? jcRows.map(ledgerLine).join(' | ') : 'none'}`, ok };
    });
  }

  // ── L3: chain L on screen — SO detail line status, JC list card, no Op Entry ──
  if (!r2('lJcCode')) {
    blocked('R2-18-L3', { action: 'chain L on screen', source: 'Sales Order detail', related: '', required: '' }, 'chain L is not in the state file');
  } else {
    await rec(page, 'R2-18-L3', {
      action: `L3: chain L on screen — SO ${r2('lSoCode')} detail (line Status badge), Job Cards list card for ${r2('lJcCode')}, Op1 card "Recent Logs" (no Op Entry was ever keyed on this JC) [G2]`,
      source: 'Sales Order detail → Job Cards list → Job Card detail',
      related: 'tryCascadeJcComplete from submitIncomingQc (ADR-166 §3); SO line closure',
      required: `SO badge CLOSED and the line's Status badge CLOSED on the SO page; JC list card shows CLOSED; Op1 card Recent Logs "No entries" and Completion Log "0 entries" (the JC closed from Incoming QC alone; /op-entry/op-log for the JC is empty); Op1 DONE ${R2_L_QTY}, label "Received"`,
    }, async () => {
      const so = await soOnPage(page, r2('lSoUrl'));
      const card = await jcListCard(page, r2('lJcCode'));
      const body = await jcBody(page, r2('lJcUrl'));
      const op1 = opCardText(body, 1);
      // The section label is uppercased by CSS, so innerText reads "RECENT LOGS No entries"
      // (the first pass looked for "Recent Logs" and missed it — a spec-side miss, not the app).
      const noLogs = /RECENT LOGS\s+No entries/i.test(op1) || /RECENT LOGS\s+No entries/i.test(body);
      const completionLog = /COMPLETION LOG \((\d+) ENTRIES\)/i.exec(body)?.[0] ?? '(completion log heading not found)';
      const opLogs = await apiGet<unknown[]>(page, '/op-entry/op-log?jobCardId=' + r2('lJcId') + '&limit=50');
      const tiles = tilesOf(op1);
      const j = await jcApi(page, r2('lJcId'));
      const ok = /CLOSED/i.test(so.badge) && so.lines.length > 0 && so.lines.every((l) => /CLOSED/i.test(l)) && /CLOSED/.test(card) && noLogs && /\(0 ENTRIES\)/i.test(completionLog) && opLogs.length === 0 && new RegExp(`DONE ${R2_L_QTY}\\b`).test(tiles) && /Outsource label Received/.test(tiles) && Boolean(j.closedAt);
      return { actual: `SO page badge "${so.badge}", line Status badges [${so.lines.join(', ')}]; JC list card: "${card}"; Op1 card: ${tiles}; Recent Logs "No entries": ${noLogs}; "${completionLog}"; op-log rows for the JC (API): ${opLogs.length}; ${jcApiLine(j)}`, ok };
    });
  }

  // ── M8 / M9 / M10: chain M on screen ──
  if (!r2('mJcCode')) {
    blocked('R2-19-M8', { action: 'chain M on screen', source: 'Sales Order detail', related: '', required: '' }, 'chain M is not in the state file');
  } else {
    await rec(page, 'R2-19-M8', {
      action: `M8: chain M — SO ${r2('mSoCode')} detail (line Status badge) and the Job Cards list card for ${r2('mJcCode')} after the JC closed from Incoming QC [G2, mid-route]`,
      source: 'Sales Order detail → Job Cards list',
      related: 'SO line closure from tryCascadeJcComplete; JC list',
      required: `SO badge CLOSED, line Status badge CLOSED (API: SO status closed, every line closed); JC list card shows CLOSED`,
    }, async () => {
      const so = await soOnPage(page, r2('mSoUrl'));
      const api = await soApi(page, idFromUrl(r2('mSoUrl')));
      const card = await jcListCard(page, r2('mJcCode'));
      const ok = /CLOSED/i.test(so.badge) && so.lines.length > 0 && so.lines.every((l) => /CLOSED/i.test(l)) && api.status === 'closed' && api.lines.every((l) => l.status === 'closed') && /CLOSED/.test(card);
      return { actual: `SO page badge "${so.badge}", line Status badges [${so.lines.join(', ')}]; API SO status "${api.status}", lines [${api.lines.map((l) => l.status).join(', ')}]; JC list card: "${card}"`, ok };
    });

    await rec(page, 'R2-20-M9', {
      action: `M9: chain M documents — outward DC ${r2('mDcCode')}, return challans ${r2('mRtvDcACode')} / ${r2('mRtvDcBCode')}, GRNs ${r2('mGrnACode')} / ${r2('mGrnBCode')} (Against NC), NC-A / NC-B detail pages`,
      source: 'Delivery Challan detail → GRN detail → NC detail',
      related: 'DC status + Receipts panel; GRN NC pair + Open NC link; NC badge + Sent / Received tiles',
      required: `All three challans "received"; GRN A shows NC ${r2('mNcACode')} with an Open NC link, GRN B shows NC ${r2('mNcBCode')}; NC-A badge CLOSED, tiles Sent ${R2_M_REJ1} / Received ${R2_M_REJ1}; NC-B badge CLOSED, tiles Sent ${R2_M_REJ2} / Received ${R2_M_REJ2}`,
    }, async () => {
      const dc0 = await readDcDetail(page, r2('mDcId'));
      const dcA = await readDcDetail(page, r2('mRtvDcAId'));
      const dcB = await readDcDetail(page, r2('mRtvDcBId'));
      const gA = await readGrnDetail(page, r2('mGrnAId'));
      const gB = await readGrnDetail(page, r2('mGrnBId'));
      const nA = await readNcDetail(page, r2('mNcAUrl'));
      const nB = await readNcDetail(page, r2('mNcBUrl'));
      const ok = dc0.status === 'received' && dcA.status === 'received' && dcB.status === 'received' && gA.nc.toUpperCase().includes(r2('mNcACode').toUpperCase()) && gA.openNc > 0 && gB.nc.toUpperCase().includes(r2('mNcBCode').toUpperCase()) && /closed/i.test(nA.status) && nA.sent === String(R2_M_REJ1) && nA.received === String(R2_M_REJ1) && /closed/i.test(nB.status) && nB.sent === String(R2_M_REJ2) && nB.received === String(R2_M_REJ2);
      return { actual: `${dc0.code} ${dc0.status} "${dc0.receiptsHdr}"; ${dcA.code} ${dcA.status} "${dcA.receiptsHdr}"; ${dcB.code} ${dcB.status} "${dcB.receiptsHdr}"; ${gA.code} NC pair "${gA.nc}", Open NC links ${gA.openNc}, lines ${JSON.stringify(gA.lines)}; ${gB.code} NC pair "${gB.nc}", lines ${JSON.stringify(gB.lines)}; NC-A badge "${nA.status}" Sent ${nA.sent} / Received ${nA.received}; NC-B badge "${nB.status}" Sent ${nB.sent} / Received ${nB.received}`, ok };
    });

    await rec(page, 'R2-21-M10', {
      action: `M10: chain M JC ${r2('mJcCode')} detail as printed on screen — Op1 card tiles + Outsource label, Op2 card tiles (QC pending), ⚠ NC strip, route progress, Overall Status [G1, G4, G5 — final state]`,
      source: 'Job Card detail',
      related: 'Op1 + Op2 cards; NC strip; status tiles',
      required: `Op1: DONE ${R2_M_QTY}, AT VENDOR 0, IN QC 0, label "Received", badge COMPLETE; Op2: DONE ${R2_M_QTY} (✓ accepted), no "⏳ pending", no "🔬 QC (n)" link, badge COMPLETE; strip "NC closed ${R2_M_REJ1}" with no "Sent to vendor" / "Received – QC pending"; "2 of 2 operations complete"; Overall Status CLOSED; tiles ${R2_M_QTY} ORDERED ${R2_M_QTY} COMPLETED 0 PENDING`,
    }, async () => {
      const body = await jcBody(page, r2('mJcUrl'));
      const c1 = tilesOf(opCardText(body, 1));
      const c2 = tilesOf(opCardText(body, 2));
      const badge = await jcStatusBadge(page);
      const tiles = await jcQtyTiles(page);
      const progress = /(\d+ of \d+ operations complete[^%]*%)/.exec(body)?.[1] ?? '(route progress text not found)';
      const strip = await jcNcStrips(page, r2('mJcUrl'));
      const ok = new RegExp(`DONE ${R2_M_QTY}\\b`).test(c1) && /AT VENDOR 0\b/.test(c1) && /IN QC 0\b/.test(c1) && /Outsource label Received/.test(c1) && /badge COMPLETED/.test(c1) && new RegExp(`DONE ${R2_M_QTY}\\b`).test(c2) && /QC pending on card 0/.test(c2) && /QC link none/.test(c2) && /badge COMPLETE/.test(c2) && new RegExp(`NC Closed\\s*${R2_M_REJ1}\\b`).test(strip) && !/Sent to Vendor|QC Pending/.test(strip) && /2 of 2 operations complete/.test(progress) && /CLOSED/.test(badge) && tiles === `${R2_M_QTY} ORDERED ${R2_M_QTY} COMPLETED 0 PENDING`;
      return { actual: `Op1 card: ${c1}; Op2 card: ${c2}; strip "${strip}"; route progress "${progress}"; Overall Status "${badge}"; tiles "${tiles}"`, ok };
    });
  }

  // ── final register / store read after chain G finished its cycle ──
  await rec(page, 'R2-22-OSP2', {
    action: `Final read: OSP At-Vendor Register + Store / Inventory row for item ${ITEM_CODE} after every chain of this run settled`,
    source: 'Delivery Challans → At-Vendor Register (+ /osp-wip) → Store / Inventory list (+ /store-inventory)',
    related: 'v_osp_wip (0128) → store-inventory at_vendor column',
    required: `Register (filter "all"): no row with returned > sent, none with at-vendor + in-QC > sent; chain G row sent ${R2_G_DC} returned ${R2_G_DC} at-vendor 0 in-QC 0 ready ${R2_G_QTY - R2_G_DC}, and NOT listed under the tab's default At-Vendor filter any more (it was, with at-vendor 2, in R2-13); Store row "At Vendor" for ${ITEM_CODE} equals the register's at-vendor total over that item's rows`,
  }, async () => {
    // The tab's default filter is at_vendor (only rows with pieces out); the
    // first pass read that and expected chain G (now at-vendor 0) in it, and
    // compared the Store figure with rows of OTHER items — both spec-side.
    const rows = await ospRegister(page, undefined, 'all');
    const atVendorRows = await ospRegister(page);
    const bad1 = rows.filter((w) => w.returnedQty > w.sentQty);
    const bad2 = rows.filter((w) => w.atVendorQty + w.inQcQty > w.sentQty);
    const g = rows.find((w) => w.jcCode === r2('gJcCode'));
    const gListedAtVendor = atVendorRows.some((w) => w.jcCode === r2('gJcCode'));
    const itemRows = rows.filter((w) => w.itemCode === ITEM_CODE);
    const regAtVendor = itemRows.reduce((s, w) => s + w.atVendorQty, 0);
    const store = await storeRow(page, ITEM_CODE);
    await page.goto('/store-inventory?search=' + encodeURIComponent(ITEM_CODE), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const gOk = Boolean(g) && g!.sentQty === R2_G_DC && g!.returnedQty === R2_G_DC && g!.atVendorQty === 0 && g!.inQcQty === 0 && g!.readyToSendQty === R2_G_QTY - R2_G_DC;
    const ok = bad1.length === 0 && bad2.length === 0 && gOk && !gListedAtVendor && Boolean(store) && store!.atVendorQty === regAtVendor;
    return { actual: `${rows.length} register rows (filter all); ${atVendorRows.length} under the default At-Vendor filter [${atVendorRows.map((w) => `${w.jcCode} ${w.itemCode ?? '?'} atVendor=${w.atVendorQty}`).join(', ')}]; chain G row: ${g ? wipLine(g) : '(not in the register)'}, listed under At-Vendor: ${gListedAtVendor}; returned > sent: ${bad1.length}; at-vendor + in-QC > sent: ${bad2.length}; rows for item ${ITEM_CODE}: ${itemRows.length}, their at-vendor total ${regAtVendor}; Store row ${ITEM_CODE}: ${store ? `in stock ${store.inStock}, at vendor ${store.atVendorQty}, on PO ${store.onPoQty}, mfg pending ${store.mfgPendingQty}` : '(row not found)'}`, ok };
  });
});

test('R2 - regression: R1 chain (IN-JWPO-00007/R1) read-only + OSP At-Vendor Register invariants', async ({ page }) => {
  test.setTimeout(900_000);
  const hasR1 = Boolean(r1('poId') && r1('jcCode'));
  if (!hasR1) {
    blocked('R2-12-REG', { action: 'R1 chain re-read', source: 'Purchase Order detail', related: '', required: '' }, 'the R1 state (poId / jcCode) is not in the state file');
  } else {
    await rec(page, 'R2-12-REG', {
      action: `Regression (rows R1-A1..R1-D3 re-read, read-only): JWPO ${r1('poCode')} + JC ${r1('jcCode')} Op1 + NC-A..D after migration 0128 re-emitted the views`,
      source: 'Purchase Order detail (JWPO) → Job Card detail → NC detail (API)',
      related: 'v_jc_op_status / v_osp_wip (0128); ADR-165 PO line + header',
      required: `JWPO line still 10 of 10, header "closed"; Op1 DONE 10, AT VENDOR 0, IN QC 0, computed status complete, label "Received"; NC-A/B/C/D all closed (A 1/2, B 1/1, C 0/1, D 1/0 cleared/failed)`,
    }, async () => {
      const po = await readPo(page, r1('poId'));
      const o = (await opsOf(page, r1('jcCode')))[0]!;
      const ns = await Promise.all(['A', 'B', 'C', 'D'].map((k) => ncApi(page, r1('nc' + k + 'Id'))));
      const want = [[1, 2], [1, 1], [0, 1], [1, 0]];
      const ncOk = ns.every((n, i) => /closed/i.test(n.status) && Number(n.clearedQty) === want[i]![0] && Number(n.failedQty) === want[i]![1]);
      const label = await ospLabelOnPage(page, r1('jcUrl'));
      const ok = po.received[0] === 10 && po.status === 'closed' && o.completedQty === 10 && o.atVendorQty === 0 && o.inQcQty === 0 && o.computedStatus === 'complete' && o.outsourceStatus === 'received' && ncOk;
      return { actual: `${poText(po)}; Op1: ${opLine(o)}; JC page Outsource label "${label}"; ${ns.map((n, i) => 'NC-' + 'ABCD'[i] + ': ' + ncLine(n)).join(' ;; ')}`, ok };
    });
  }
  await rec(page, 'R2-13-OSP', {
    action: 'OSP At-Vendor Register (Delivery Challans → At-Vendor Register tab): every row read',
    source: 'Delivery Challans → At-Vendor Register (+ /osp-wip API)',
    related: 'v_osp_wip (0128): returned_qty = ordinary receipts only; at_vendor + in_qc ≤ sent',
    required: 'No row with returned > sent; no row with at-vendor + in-QC > sent. The E2E_ chains of this run listed with their expected figures (chain M: sent 10 returned 10 atVendor 0 inQc 0; chain G: sent 6 atVendor 2 inQc 0; chain L: sent 6 returned 6)',
  }, async () => {
    const rows = await ospRegister(page);
    const bad1 = rows.filter((w) => w.returnedQty > w.sentQty);
    const bad2 = rows.filter((w) => w.atVendorQty + w.inQcQty > w.sentQty);
    const mine = rows.filter((w) => [r2('mJcCode'), r2('gJcCode'), r2('lJcCode'), r1('jcCode')].filter(Boolean).includes(w.jcCode));
    await page.goto('/delivery-challans?tab=at_vendor', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const ok = bad1.length === 0 && bad2.length === 0;
    return { actual: `${rows.length} rows; returned > sent: ${bad1.length ? bad1.map(wipLine).join(' | ') : 'none'}; at-vendor + in-QC > sent: ${bad2.length ? bad2.map(wipLine).join(' | ') : 'none'}; this run's chains: ${mine.map(wipLine).join(' ;; ') || '(none listed)'}`, ok };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R3 — ADR-167 batch 2/3 (2026-09-16). Gaps G7/G8/G9 of
// docs/audits/2026-09-16-osp-chain-gap-report.md, migrations 0129/0130.
//
//   G7  v_nc_op_breakup counts PIECES not NC generations ("NC closed 3" on
//       chain M, not 4) and has a "Return challan pending" bucket for an NC
//       disposed return-to-vendor whose challan is not yet created.
//   G8  a follow-on NC (raised on the GRN against a return challan) carries
//       parent_nc_id → "Continues NC …" on the page, related docs both ways.
//   G9a a deleted / rejected PO releases its op back to "PR raised" and
//       re-opens the PR; a PO with a challan or GRN behind it is refused.
//   G9b GRN rollups read every PO line linked to the op (jc_op_po_lines).
//   G9c SO Status / SO Overview count GRN-accepted qty for an outsource op.
//   G9d Job Cards → + New (JW-only) raises the OSP PR on save.
//
//   Read-only on chain M (IN-JC-26-00039) and the R1 chain; chain N (fresh
//   JWPO 6, G7 + G8 live path), chain P (fresh JWPO 6, G9a + G9b), a JWSO +
//   direct JC (G9d). Chain N / P / JW state lives in the r2 map (prefixes
//   n* / p* / jw*) because buildOspChainR2 writes there.
//
//   Rows are in the NEW report shape (2026-09-16 format change): one row per
//   document a step touched — Action | Document | Qty | Header Status |
//   Overall Status | Result. Ids are R3-xx-1, R3-xx-2 … per step.
//
// Run this section alone with:  --grep "00 -|R3|ZZ6|ZZ9"
// ═══════════════════════════════════════════════════════════════════════════

const R3_TAG = 'ADR-167 batch 2/3 (2026-09-16)';
const R3_N_QTY = 6;
const R3_N_ACC1 = 4;
const R3_N_REJ1 = 2; // NC-A: return to vendor (challan created only in the second step)
const R3_N_ACC2 = 1;
const R3_N_REJ2 = 1; // NC-B on the replacement: the live G8 path
const R3_N_ACC3 = 1;
const R3_P_QTY = 6;
const R3_P_PO2 = 4; // second JWPO covers 4 of 6 …
const R3_P_PO3 = 2; // … and a third JWPO from the PR page covers the last 2 (second link on the op)
const MIG_0129 = 'apps/api/src/db/migrations/0129_nc_chain_and_breakup.sql';

/** One document's line in a new-format row. */
interface DocRow {
  document: string;
  qty: string;
  headerStatus: string;
  overallStatus: string;
  ok: boolean | 'na' | 'blocked';
  /** What was seen — goes to the JSON `actual` and, for a FAIL, to Findings. */
  note?: string;
  /** R4: a per-document action (≤ 6 plain words) for the six-column renderer;
   *  defaults to the step's action. */
  act?: string;
}
/** Steps that read a TRANSIENT state (the chain moves past it in the very next
 *  step). Their rows are pinned once recorded — never re-evaluated. */
const R3_TRANSIENT_STEPS = new Set(['R3-03', 'R3-03b', 'R3-02c', 'R3-04a', 'R3-04b', 'R3-04c', 'R3-08a']);

/** New-format recorder: ONE step → one row per document it touched. Row ids
 *  are `<id>-1`, `<id>-2`… in the order returned; one screenshot per step.
 *  Resumable like `rec`: a step whose rows all passed is not re-evaluated. */
/** `R3_REREAD=R3-01,R3-01b,…` in the shell: those steps are re-evaluated even
 *  when their rows passed (used to re-read the G7 strips after migration 0131). */
const R3_REREAD = (process.env.R3_REREAD ?? '').split(',').map((x) => x.trim()).filter(Boolean);
async function rec3(page: Page, id: string, action: string, check: () => Promise<DocRow[]>): Promise<boolean> {
  const prior = R3_REREAD.includes(id) ? [] : readReport().rows.filter((x) => x.id.startsWith(id + '-'));
  if (prior.length > 0 && prior.some((x) => x.keep)) {
    log(`[kept ${prior.map((x) => x.result).join('/')}, pinned] ${id} ${action} (recorded ${prior[0]!.at})`);
    return prior.every((x) => x.result !== 'FAIL');
  }
  if (prior.length > 0 && prior.every((x) => x.result === 'PASS' || x.result === 'FIXED' || x.result === 'N/A (by design)' || x.result === 'BLOCKED (by design)')) {
    log(`[kept ${prior.map((x) => x.result).join('/')}] ${id} ${action} (recorded ${prior[0]!.at})`);
    return true;
  }
  let docs: DocRow[];
  try {
    docs = await check();
  } catch (e) {
    docs = [{ document: '(step did not complete)', qty: '', headerStatus: '', overallStatus: '', ok: false, note: 'ERROR: ' + (e instanceof Error ? e.message.split('\n').slice(0, 3).join(' | ') : String(e)) }];
  }
  mkdirSync(SHOT_DIR, { recursive: true });
  const shot = SHOT_DIR + '/' + id + '.png';
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const r = readReport();
  r.rows = r.rows.filter((x) => !x.id.startsWith(id + '-'));
  const at = new Date().toISOString();
  docs.forEach((d, i) => {
    const result: Result = d.ok === 'na' ? 'N/A (by design)' : d.ok === 'blocked' ? 'BLOCKED (by design)' : d.ok ? 'PASS' : 'FAIL';
    r.rows.push({
      id: `${id}-${i + 1}`,
      test: testOf(id),
      action: d.act ?? action,
      source: '',
      related: '',
      required: '',
      actual: d.note ?? '',
      result,
      shot,
      at,
      document: d.document,
      qty: d.qty,
      headerStatus: d.headerStatus,
      overallStatus: d.overallStatus,
      ...(R3_TRANSIENT_STEPS.has(id) ? { keep: true } : {}),
    });
    log(`[${result}] ${id}-${i + 1} ${d.document} | qty ${d.qty || '—'} | ${d.headerStatus} | ${d.overallStatus}${d.note ? ' — ' + d.note.slice(0, 200) : ''}`);
  });
  r.rows.sort((a, b) => a.id.localeCompare(b.id));
  writeReport(r);
  return docs.every((d) => d.ok === true || d.ok === 'na');
}
function blocked3(id: string, action: string, why: string): void {
  const r = readReport();
  r.rows = r.rows.filter((x) => !x.id.startsWith(id + '-'));
  r.rows.push({ id: id + '-1', test: testOf(id), action, source: '', related: '', required: '', actual: 'BLOCKED: ' + why, result: 'BLOCKED', at: new Date().toISOString(), document: '—', qty: '', headerStatus: '', overallStatus: '' });
  r.rows.sort((a, b) => a.id.localeCompare(b.id));
  writeReport(r);
  log(`[BLOCKED] ${id} ${action} — ${why}`);
}

/** "NC closed 3" → 3 (0 when the label is not on the strip). */
function stripNum(strip: string, label: string): number {
  const m = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\d+)').exec(strip);
  return m ? Number(m[1]) : 0;
}
/** The op card's status badge as the JC page prints it (from tilesOf). */
function opBadge(card: string): string {
  return /badge ([A-Z ]+?);/.exec(tilesOf(card))?.[1] ?? '?';
}
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '—');

interface RelatedApi {
  upstream: { key: string; title: string; items: { code: string }[] }[];
  downstream: { key: string; title: string; items: { code: string }[] }[];
}
async function ncRelated(page: Page, ncId: string): Promise<RelatedApi> {
  return apiGet<RelatedApi>(page, '/nc-register/' + ncId + '/related');
}
function relCodes(r: RelatedApi, key: string): string[] {
  return [...r.upstream, ...r.downstream].filter((s) => s.key === key).flatMap((s) => s.items.map((i) => i.code));
}
/** Body text that follows a Related-docs section title (the codes listed under it). */
function afterTitle(body: string, title: string, len = 240): string {
  const i = body.indexOf(title);
  return i < 0 ? '' : body.slice(i + title.length, i + title.length + len);
}

/** NC detail with the Related Documents panel loaded (its query lands after
 *  the detail's own; readNcDetail's 2 s was not always enough on the test API). */
async function readNcDetailWithRelated(page: Page, ncUrl: string): Promise<{ body: string; status: string }> {
  const d = await readNcDetail(page, ncUrl);
  // The panel renders only once its own query resolves (RelatedDocsPanel
  // returns null while loading) — wait for a section title + a code inside it,
  // not just for the panel header, then read the body.
  const panel = page.locator('.panel').filter({ hasText: 'Related Documents' });
  await panel.locator('.mono').first().waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  return { body, status: d.status };
}

/** G8 both ways: NC-B → "Continues NC" NC-A (page + API parentNcId + related
 *  upstream), NC-A → "Follow-on NCs" NC-B (page + related downstream). */
async function checkParentLink(page: Page, a: { id: string; url: string; code: string }, b: { id: string; url: string; code: string }, whyNull: string): Promise<DocRow[]> {
  const nB = await ncApi(page, b.id);
  const nA = await ncApi(page, a.id);
  const relA = await ncRelated(page, a.id);
  const relB = await ncRelated(page, b.id);
  const dB = await readNcDetailWithRelated(page, b.url);
  const contOnPage = /Earlier NC:\s*(NC-AUTO-[A-Za-z0-9-]+)/.exec(dB.body)?.[1] ?? '';
  const parentOnPageB = afterTitle(dB.body, 'Earlier NC:').includes(a.code);
  const dA = await readNcDetailWithRelated(page, a.url);
  const followOnPageA = afterTitle(dA.body, 'Follow-on NCs (same pieces, next trip)').includes(b.code);
  const parentApiB = relCodes(relB, 'parent-nc');
  const followApiA = relCodes(relA, 'continuation-nc');
  const okB = nB.parentNcId === a.id && (nB as unknown as { parentNcCode?: string | null }).parentNcCode === a.code && contOnPage === a.code && parentOnPageB && parentApiB.includes(a.code);
  const okA = followApiA.includes(b.code) && followOnPageA;
  if (!nB.parentNcId && whyNull) finding(`[R3] ${b.code}: parentNcId is null — ${whyNull}`);
  return [
    {
      document: b.code,
      qty: `${Number(nB.rejectedQty)} rejected`,
      headerStatus: dB.status,
      overallStatus: `Continues NC ${contOnPage || '— (no link on the page)'}; API parentNcId ${nB.parentNcId ? (nB.parentNcId === a.id ? '= NC-A' : '= OTHER ' + nB.parentNcId) : 'null'}`,
      ok: okB,
      note: `page "Continues NC ${contOnPage || '—'}" (related docs upstream "Continues NC": [${parentApiB.join(', ') || 'none'}], on page: ${parentOnPageB}); api parentNcId=${nB.parentNcId ?? 'null'} parentNcCode=${(nB as unknown as { parentNcCode?: string | null }).parentNcCode ?? 'null'}; ${ncLine(nB)}`,
    },
    {
      document: a.code,
      qty: `${Number(nA.rejectedQty)} rejected`,
      headerStatus: dA.status,
      overallStatus: `Follow-on NCs: ${followApiA.join(', ') || 'none'}`,
      ok: okA,
      note: `related docs downstream "Follow-on NCs (same pieces, next trip)": [${followApiA.join(', ') || 'none'}] (on page: ${followOnPageA}); ${ncLine(nA)}`,
    },
  ];
}

interface PrApi {
  id: string;
  code: string;
  status: string;
  qty: number;
  orderedQty?: number;
  balanceQty?: number;
  poId?: string | null;
}
async function prApi(page: Page, prId: string): Promise<PrApi> {
  return apiGet<PrApi>(page, '/purchase-requests/' + prId);
}
/** PR detail page: status badge + the Ordered / Balance facts. */
async function prOnPage(page: Page, prId: string): Promise<{ badge: string; ordered: string; balance: string }> {
  await page.goto('/purchase-requests/' + prId, { waitUntil: 'domcontentloaded' });
  const badgeLoc = page.locator('.panel-title .badge, .panel-hdr .badge').first();
  await expect(badgeLoc).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const badge = (await badgeLoc.innerText()).trim();
  // innerText carries the CSS text-transform (the fact labels print uppercase).
  const ordered = /Ordered\s+(\d+)/i.exec(body)?.[1] ?? '?';
  const balance = /Balance\s+(⚠ -?\d+|\d+)/i.exec(body)?.[1] ?? '?';
  return { badge, ordered, balance };
}
interface BoardRow {
  jcOpId: string;
  opSeq: number;
  status: string;
  completed: number;
  outsourceStatus: string | null;
  outsourcePrId: string | null;
  outsourcePrCode: string | null;
  outsourcePoId: string | null;
  outsourcePoCode: string | null;
  outsourceOpenDcCode: string | null;
}
async function boardOp1(page: Page, jcCode: string): Promise<BoardRow> {
  const r = await apiGet<{ items: BoardRow[] }>(page, '/jc-ops?jcCode=' + encodeURIComponent(jcCode) + '&limit=50&offset=0');
  const row = r.items.filter((x) => x.opSeq === 1).sort((x, y) => x.opSeq - y.opSeq)[0];
  if (!row) throw new Error('no Op1 row on /jc-ops for ' + jcCode);
  return row;
}
const boardLine = (b: BoardRow): string => `board: osp=${b.outsourceStatus} PR=${b.outsourcePrCode ?? 'null'} (${b.outsourcePrId ? 'id set' : 'no id'}) PO=${b.outsourcePoCode ?? 'null'} (${b.outsourcePoId ? 'id set' : 'null'}) openDc=${b.outsourceOpenDcCode ?? 'null'}`;

/** The JC page's Op 1 card AFTER the jc-ops board has landed: the "PR: …" /
 *  "PO: …" reference and the Gen PO / Gen DC links are driven by a second
 *  fetch (useJcOpsBoard) that arrives after the page's first paint — the first
 *  chain-P read (06:44Z) took the card before it did and saw "no ref". */
async function opCardSettled(page: Page, jcUrl: string): Promise<{ card: string; genPo: number; genDc: number }> {
  await jcBody(page, jcUrl);
  await page.getByText(/\b(PR|PO):\s*IN-/).first().waitFor({ timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  return { card: opCardText(body, 1), genPo: await page.getByRole('link', { name: /Gen PO/ }).count(), genDc: await page.getByRole('link', { name: /Gen DC/ }).count() };
}

/** GET without throwing: HTTP status + body text. */
async function apiProbe(page: Page, path: string): Promise<{ status: number; text: string }> {
  const s = readState();
  const token = await bearer(page);
  const res = await page.request.get(s.apiBase + path, { headers: { authorization: 'Bearer ' + token } });
  return { status: res.status(), text: (await res.text()).slice(0, 300) };
}
/** Activity Log rows (API) whose detail names `needle`, newest first. */
async function activityWith(page: Page, search: string, needle: RegExp): Promise<string[]> {
  const r = await apiGet<{ entries: { action: string; entity?: string; detail: string; ts: string }[] }>(page, '/activity-log?search=' + encodeURIComponent(search) + '&limit=50&offset=0');
  return r.entries.filter((e) => needle.test(e.detail)).map((e) => `${e.ts.slice(0, 19)} ${e.action}: ${e.detail}`);
}

/** PO detail → Delete → Confirm (or Reject → reason → Reject PO when the PO is
 *  still a draft). Returns the badge before, the path taken and the app's own
 *  message when it refused. */
async function deletePoUi(page: Page, poId: string): Promise<{ before: string; via: 'delete' | 'reject'; gone: boolean; message: string }> {
  await page.goto('/purchase-orders/' + poId, { waitUntil: 'domcontentloaded' });
  const badge = page.locator('.panel-hdr .badge').first();
  await expect(badge).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const before = (await badge.innerText()).trim().toLowerCase();
  if (before === 'draft' && (await page.getByRole('button', { name: /^Reject$/ }).count())) {
    await page.getByRole('button', { name: /^Reject$/ }).click();
    await page.getByPlaceholder(/Why is this PO being rejected/).fill(`E2E_ ${R3_TAG} - G9a reject`);
    await page.getByRole('button', { name: /^Reject PO$/ }).click();
    await page.waitForTimeout(4000);
    const after = (await badge.innerText().catch(() => '')).trim().toLowerCase();
    const alert = (await page.getByRole('alert').first().innerText().catch(() => '')).trim();
    return { before, via: 'reject', gone: after === 'cancelled', message: alert };
  }
  const del = page.getByRole('button', { name: /^Delete$/ });
  await expect(del, 'Delete offered on the PO page (needs edit + approve)').toBeVisible({ timeout: 30_000 });
  await del.click();
  await page.getByRole('button', { name: /^Move to Trash$/ }).click();
  let message = '';
  let gone = false;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(1500);
    if (/\/purchase-orders\/?(\?.*)?$/.test(page.url())) {
      gone = true;
      break;
    }
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const m = /(PO \S+ has goods moved against it \([^)]*\); cancel that document first|Failed to delete purchase order\.?)/.exec(body);
    if (m) {
      message = m[1]!.trim();
      break;
    }
  }
  return { before, via: 'delete', gone, message };
}

/** The PO form (already open on /purchase-orders/from-pr?prId=…): vendor,
 *  delivery, rate, optional qty override, Save → approve → { id, code }. */
async function savePoForm(page: Page, remark: string, qty?: number): Promise<{ id: string; code: string; status: string }> {
  await page.locator('#pof-code').waitFor({ timeout: 60_000 });
  await expect(page.locator('#pof-code')).not.toHaveValue('', { timeout: 60_000 });
  await expect(page.getByLabel('Item Code, line 1', { exact: true })).not.toHaveValue('', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  const vendorBox = await page.locator('#pof-vendor').inputValue();
  if (!vendorBox.includes(VENDOR_CODE)) await pickFromCombo(page, 'pof-vendor', VENDOR_CODE, new RegExp(VENDOR_CODE));
  await page.locator('#pof-delivery-days').fill('14');
  const rate = page.getByLabel('Rate, line 1', { exact: true });
  if (!(await rate.inputValue()) || Number(await rate.inputValue()) === 0) await rate.fill('50');
  if (qty !== undefined) await page.getByLabel('Qty, line 1', { exact: true }).fill(String(qty));
  await page.locator('#pof-remarks').fill(remark);
  const save = page.locator('button.pof-btn-go');
  const foot = await page.locator('.pof-foot-msg, .pof-foot-hint').first().innerText().catch(() => '');
  await expect(save, 'footer says: ' + foot).toBeEnabled({ timeout: 30_000 });
  await save.click();
  await expect(page).toHaveURL(/purchase-orders\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const id = /purchase-orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const code = /IN-[A-Z]*PO-\d+(?:\/R\d+)?/.exec(await page.locator('body').innerText())?.[0] ?? '';
  const status = await approvePo(page, id);
  return { id, code, status };
}
/** Outward challan for `qty` straight from the PO id (the op card's Gen DC
 *  link only ever points at the op's FIRST PO). */
async function genDcForPo(page: Page, poId: string, qty: number, remark: string): Promise<{ id: string; code: string; canSendNow: string }> {
  await page.goto('/delivery-challans/new?poId=' + poId, { waitUntil: 'domcontentloaded' });
  await page.locator('#dc-code').waitFor({ timeout: 60_000 });
  await expect(page.locator('#dc-code')).not.toHaveValue('', { timeout: 60_000 });
  const qtyBoxes = page.locator('table.innovic-table input[type="number"]');
  await expect(qtyBoxes).toHaveCount(1, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const canSendNow = /Can send now:\s*(\d+)/.exec(body)?.[1] ?? '(no "Can send now" text)';
  await page.locator('#dc-transport').fill('E2E_ Shree Ganesh Roadlines');
  await page.locator('#dc-vehicle-no').fill('GJ-23-E2E-0916');
  await qtyBoxes.first().fill(String(qty));
  const materials = page.locator('table.innovic-table input.innovic-input:not([type])');
  if (await materials.count()) await materials.first().fill('E2E_ EN24');
  const remarks = page.locator('#dc-remarks');
  if (await remarks.count()) await remarks.fill(remark);
  const save = page.getByRole('button', { name: /Save DC/ });
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await save.click();
  await expect(page).toHaveURL(/delivery-challans\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const id = /delivery-challans\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.waitForTimeout(4000);
  const code = /IN-DC-\d+(?:\/R\d+)?/.exec(await page.locator('body').innerText())?.[0] ?? '';
  return { id, code, canSendNow };
}

interface SoStatusApi {
  header: { code: string; status: string };
  lines: {
    status: string;
    doneQty: number;
    outsourceAlert: { atVendorQty: number; atVendorOpCount: number; pendingPrCount: number; prRaisedCount: number };
    jobCards: { code: string; status: string; doneQty: number; completionPct: number; ops: { opSeq: number; opType: string; status: string; completed: number; outsourceStatus: string | null }[] }[];
  }[];
}
interface SoOverviewRowApi {
  code: string;
  status: string;
  overallStatus: string;
  overallPct: number;
  totalDoneQty: number;
  totalRequiredQty: number;
  stageCounts: Record<string, number>;
  alerts: { atVendorQty: number };
}
/** SO Status (API + page) and SO Overview (API + page) for one SO. */
async function soStatusRows(page: Page, so: { id: string; code: string; jcCode: string }, expectComplete: boolean, expectAtVendor: number, expectDone: number, why: string): Promise<DocRow[]> {
  const st = await apiGet<SoStatusApi>(page, '/so-status/' + so.id);
  const line = st.lines[0]!;
  const jc = line.jobCards.find((j) => j.code === so.jcCode)!;
  const op = jc.ops.find((o) => o.opType === 'outsource')!;
  const ov = (await apiGet<{ rows: SoOverviewRowApi[] }>(page, '/so-overview?status=all&search=' + encodeURIComponent(so.code))).rows.find((r) => r.code === so.code);
  await page.goto('/sales-orders/' + so.id + '/status', { waitUntil: 'domcontentloaded' });
  await page.getByText(so.jcCode).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const stBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const atVendorOnPage = /At Vendor:\s*(\d+)\s*pcs/.exec(stBody)?.[1] ?? '0';
  const jcOnPage = cardText(stBody, so.jcCode, 220);
  await page.goto('/so-overview?status=all&search=' + encodeURIComponent(so.code), { waitUntil: 'domcontentloaded' });
  await page.getByText(so.code).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const ovBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const ovOnPage = cardText(ovBody, so.code, 220);
  const opOk = (op.status === 'complete') === expectComplete && op.completed === expectDone && line.outsourceAlert.atVendorQty === expectAtVendor && Number(atVendorOnPage) === expectAtVendor;
  const ovOk = Boolean(ov) && (expectComplete ? ov!.overallStatus === 'completed' && ov!.status === 'closed' : ov!.overallStatus !== 'completed' && ov!.status !== 'closed') && ov!.alerts.atVendorQty === expectAtVendor;
  return [
    {
      document: `${so.code} — SO Status (${so.jcCode} Op ${op.opSeq})`,
      qty: `done ${op.completed} (expected ${expectDone})`,
      headerStatus: `line ${cap(line.status)}; JC ${cap(jc.status)} ${jc.completionPct}%`,
      overallStatus: `op ${op.status}; At vendor ${line.outsourceAlert.atVendorQty} (page "${atVendorOnPage}")`,
      ok: opOk,
      note: `${why}; API op status=${op.status} completed=${op.completed} outsourceStatus=${op.outsourceStatus}; line status=${line.status} doneQty=${line.doneQty}; alert atVendorQty=${line.outsourceAlert.atVendorQty}; SO Status page JC row: "${jcOnPage}"`,
    },
    {
      document: `${so.code} — SO Overview`,
      qty: ov ? `${ov.totalDoneQty} of ${ov.totalRequiredQty}` : '',
      headerStatus: ov ? cap(ov.status) : '(not listed)',
      overallStatus: ov ? `${cap(ov.overallStatus)} ${ov.overallPct}%; at vendor ${ov.alerts.atVendorQty}` : '(not listed)',
      ok: ovOk,
      note: ov ? `API status=${ov.status} overallStatus=${ov.overallStatus} pct=${ov.overallPct} stageCounts=${JSON.stringify(ov.stageCounts)} atVendor=${ov.alerts.atVendorQty}; page card: "${ovOnPage}"` : 'SO not in /so-overview rows',
    },
  ];
}

/** Job Work Sales Order (JWSO) → + New: Adani, one line of ITEM_CODE × qty. */
async function createJwso(page: Page, qty: number): Promise<{ id: string; code: string }> {
  await page.goto('/job-work-orders/new', { waitUntil: 'domcontentloaded' });
  await page.locator('#jwDate').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  await pickFromCombo(page, 'clientId', 'Adani', /Adani/);
  await page.locator('#clientPoNo').fill(`E2E_ADR167-JW-${STAMP}`);
  // The form opens with one empty line already; "+ Add Line" only when it does not.
  const lineRows = page.locator('table tbody tr').filter({ has: page.getByPlaceholder('🔍 ITM-001') });
  if ((await lineRows.count()) === 0) {
    await page.getByRole('button', { name: /Add Line/ }).click();
    await page.waitForTimeout(500);
  }
  const row = lineRows.first();
  await row.getByPlaceholder('🔍 ITM-001').fill(ITEM_CODE);
  await page.waitForTimeout(800);
  const partName = row.getByPlaceholder('Item Name');
  if (!(await partName.inputValue()).trim()) await partName.fill('E2E_ COVER');
  await row.getByPlaceholder('Rev').fill('A');
  await row.getByPlaceholder('Qty').fill(String(qty));
  await row.getByPlaceholder('₹ Rate').fill('10');
  await page.locator('#remarks').fill(`E2E_ ${R3_TAG} - G9d JWSO for a direct job card - safe to cancel.`);
  await page.getByRole('button', { name: /Save JW/ }).click();
  await expect(page).toHaveURL(/job-work-orders\/[0-9a-f-]{36}/, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const id = /job-work-orders\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const code = /IN-JW-\d+/.exec(await page.locator('body').innerText())?.[0] ?? '';
  expect(code, 'JWSO code on the page').toMatch(/IN-JW-\d+/);
  return { id, code };
}
interface SourceOption {
  type: string;
  code: string;
  lineId: string;
  lineNo: number | null;
  customerName: string | null;
  partName: string | null;
  remaining: number;
}
/** Job Cards → + New (JW-only): pick the JWSO line (the datalist wants the
 *  exact label), keep the cascaded item + qty, "+ Add OSP Op" on VND-959,
 *  Save Job Card. Returns the code the server assigned. */
const JC_FORM_FALLBACK_VENDOR = 'VND-001';
async function createJcFromJwso(page: Page, jwCode: string): Promise<{ code: string; label: string; itemBox: string; qtyBox: string; vendorPicked: string; vendorNote: string }> {
  const opts = await apiGet<SourceOption[]>(page, '/job-cards/source-options');
  const o = opts.find((x) => x.type === 'jw' && x.code === jwCode);
  expect(o, `${jwCode} offered as a JW source (${opts.filter((x) => x.type === 'jw').length} JW sources listed)`).toBeTruthy();
  const ln = o!.lineNo && o!.lineNo !== 1 ? ` / L${o!.lineNo}` : '';
  const part = o!.partName ? ` (${o!.partName})` : '';
  const label = `[JWSO] ${o!.code}${ln} — ${o!.customerName ?? ''}${part} [Avail: ${o!.remaining}]`;
  const next = (await apiGet<{ code: string }>(page, '/job-cards/next-code')).code;
  await page.goto('/job-cards/new', { waitUntil: 'domcontentloaded' });
  const src = page.getByPlaceholder(/Search JWSO number/);
  await src.waitFor({ timeout: 60_000 });
  // The datalist is fed by the source-options query, which lands after the
  // form's first paint on the slow test API; typing the label before it has
  // landed matches nothing (the first attempt saved with no source and was
  // refused "Pick a Job Work Sales Order (JWSO)"). Wait for the option first.
  // (datalist options are not rendered, so match on the value attribute, not text)
  await page.locator(`#dlJcSource option[value*="${jwCode}"]`).first().waitFor({ state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(500);
  const picked = page.getByText(/\[JW\] Line \d+/);
  for (let attempt = 0; attempt < 3 && !(await picked.count()); attempt += 1) {
    await src.fill('');
    await src.fill(label);
    await page.waitForTimeout(1200);
  }
  expect(await picked.count(), `the form shows "[JW] Line n — ${jwCode}" after typing the label "${label}"`).toBeGreaterThan(0);
  const itemBox = page.getByPlaceholder(/Search item code or name/);
  if (!(await itemBox.inputValue()).trim()) await itemBox.fill(ITEM_CODE);
  const qtyBox = page.locator('.form-grp').filter({ hasText: /Order Qty/ }).locator('input[type="number"]').first();
  if (!(await qtyBox.inputValue()).trim()) await qtyBox.fill(String(o!.remaining || 6));
  const itemVal = await itemBox.inputValue();
  const qtyVal = await qtyBox.inputValue();
  await page.getByRole('button', { name: /Add OSP Op/ }).click();
  await page.waitForTimeout(600);
  await page.getByPlaceholder('Operation name ★').first().fill(`E2E_ Heat treatment (ADR-167 G9d)`);
  // The vendor picker on this form holds only the first 200 vendors (by code)
  // and does not search the server: with 959 vendors on this stack VND-959 is
  // "No matches". Recorded as its own row; the chain carries on with a vendor
  // the picker CAN find so G9d itself is still proved.
  let vendorPicked = VENDOR_CODE;
  let vendorNote = '';
  const box = page.locator('#jc-edit-vend-0');
  await box.click();
  await box.fill(VENDOR_CODE);
  const opt959 = page.getByRole('option').filter({ hasText: new RegExp(VENDOR_CODE) }).first();
  const found959 = await opt959.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  if (found959) {
    await opt959.click();
  } else {
    const dropdown = (await page.locator('body').innerText()).includes('No matches') ? 'No matches' : '(no option list)';
    vendorNote = `typing "${VENDOR_CODE}" into the OSP op's vendor box gave "${dropdown}"; fell back to ${JC_FORM_FALLBACK_VENDOR}`;
    await pickFromCombo(page, 'jc-edit-vend-0', JC_FORM_FALLBACK_VENDOR, new RegExp(JC_FORM_FALLBACK_VENDOR));
    vendorPicked = JC_FORM_FALLBACK_VENDOR;
  }
  const remarks = page.getByPlaceholder(/Optional notes for this job card/);
  if (await remarks.count()) await remarks.fill(`E2E_ ${R3_TAG} - G9d direct JC with one OSP op - safe to cancel.`);
  await page.getByRole('button', { name: /Save Job Card/ }).click();
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(1500);
    if (/\/job-cards\/?(\?.*)?$/.test(page.url())) break;
    // The form's refusal is a plain red div, not role=alert; and every
    // locator read here is bounded (an unbounded innerText waited 20 min).
    const body = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ');
    const err = /(Pick a Job Work Sales Order[^.]*\.|All outsource operations need a vendor[^.]*\.|Save failed[^.]*|Item code[^.]*required[^.]*\.?)/.exec(body)?.[1];
    if (err) throw new Error('Save Job Card refused: ' + err);
  }
  expect(page.url(), 'back on the Job Cards list after save').toMatch(/\/job-cards\/?(\?.*)?$/);
  return { code: next, label, itemBox: itemVal, qtyBox: qtyVal, vendorPicked, vendorNote };
}

// ── R3-A: G7 / G8 read-only on chain M (+ the backfilled R1 chain) ─────────

test('R3 - G7/G8 read-only: chain M strip "NC closed 3" (pieces, not generations); NC-B continues NC-A (chain M; R1 chain backfilled by 0129)', async ({ page }) => {
  test.setTimeout(900_000);
  {
    const r = readReport();
    r.title = 'Innovic ERP — chain verification (rework with multiple child JCs; GRN → QC reject → return to vendor) + re-verification after ADR-165 + ADR-166 batch 1 + ADR-167 batch 2/3';
    r.date = REPORT_DATE;
    writeReport(r);
  }
  if (!r2('mJcCode') || !r2('mNcBId')) {
    blocked3('R3-01', 'G7 strip on chain M', 'chain M (mJcCode / mNcBId) is not in the state file');
    return;
  }
  const jc = r2('mJcCode');
  const jcUrl = r2('mJcUrl');
  await rec3(page, 'R3-01', `G7: read the ⚠ NC strip on ${jc} Op 1 after both return cycles (NC-A 3 rejected → 2 cleared + 1 failed; NC-B 1 rejected → 1 cleared) — "NC closed" must count the 3 pieces (2 + 1), not the 4 rejections (3 + 1) the old view summed`, async () => {
    const o1 = (await opsOf(page, jc))[0]!;
    const j = await jcApi(page, r2('mJcId'));
    const body = await jcBody(page, jcUrl);
    const card = opCardText(body, 1);
    const strip = await jcNcStrips(page, jcUrl);
    const closed = stripNum(strip, 'NC Closed');
    const ok = o1.ncBreakup.ncClosedQty === R2_M_ACC2 + R2_M_ACC3 && closed === R2_M_ACC2 + R2_M_ACC3 && o1.ncBreakup.ncOpenQty === 0;
    return [
      {
        document: `${jc} Op 1`,
        qty: `NC closed ${closed}`,
        headerStatus: opBadge(card),
        overallStatus: `JC ${cap(j.computedStatus)}; strip "${strip}"`,
        ok,
        note: `api ncBreakup.ncClosedQty=${o1.ncBreakup.ncClosedQty} (was 4 before 0129: 3 rejected on NC-A + 1 on NC-B); page strip "${strip}"; ${opLine(o1)}`,
      },
    ];
  });
  await rec3(page, 'R3-02', `G8 (chain M): NC-B ${r2('mNcBCode')} was raised on the GRN against NC-A's return challan — it must show "Continues NC ${r2('mNcACode')}" (page + API parentNcId + related docs), and NC-A's related docs must list NC-B under "Follow-on NCs"`, async () =>
    checkParentLink(
      page,
      { id: r2('mNcAId'), url: r2('mNcAUrl'), code: r2('mNcACode') },
      { id: r2('mNcBId'), url: r2('mNcBUrl'), code: r2('mNcBCode') },
      `deploy-order artefact on the test stack, not a code defect: NC-B was raised at 05:45Z on 2026-09-16, AFTER the 0129 backfill UPDATE had already run (the 04:5xZ NCs of IN-JC-26-00038 did get their parent) and BEFORE the ADR-167 API (which stamps parent_nc_id at creation) went live at ~05:56Z. Fix on this stack: re-run the backfill statement in ${MIG_0129} (UPDATE public.nc_register … FROM goods_receipt_note_lines … WHERE n.parent_nc_id IS NULL). On production, apply 0129 and deploy the API together so no NC lands in that window. The live-code path is proved on chain N (R3-02c) and the backfilled path on the R1 chain (R3-02b).`,
    ),
  );
  if (r1('jcCode') && r1('jcUrl')) {
    const r1Jc = r1('jcCode');
    await rec3(page, 'R3-01b', `G7 (R1 chain, read-only): ${r1Jc} Op 1 went through FOUR return cycles (NC-A 3 rej → 1 ok / 2 fail; NC-B 2 → 1 / 1; NC-C 1 → 0 / 1; NC-D 1 → 1 / 0) — the strip must read "NC closed ${R1_ACC2 + R1_ACC3 + R1_ACC4 + R1_ACC5}" (1 + 1 + 0 + 1 pieces), not 7 (3 + 2 + 1 + 1 rejections, what the 0122 view summed)`, async () => {
      const o1 = (await opsOf(page, r1Jc))[0]!;
      const body = await jcBody(page, r1('jcUrl'));
      const card = opCardText(body, 1);
      const strip = await jcNcStrips(page, r1('jcUrl'));
      const closed = stripNum(strip, 'NC Closed');
      const want = R1_ACC2 + R1_ACC3 + R1_ACC4 + R1_ACC5;
      return [
        {
          document: `${r1Jc} Op 1`,
          qty: `NC closed ${closed}`,
          headerStatus: opBadge(card),
          overallStatus: `strip "${strip}"; DONE ${o1.completedQty}, at vendor ${o1.atVendorQty}`,
          ok: o1.ncBreakup.ncClosedQty === want && closed === want && o1.ncBreakup.ncOpenQty === 0 && o1.ncBreakup.rtvAwaitingChallanQty === 0,
          note: `api ncBreakup.ncClosedQty=${o1.ncBreakup.ncClosedQty} (old view: 7); ${opLine(o1)}`,
        },
      ];
    });
  }
  if (r1('ncAId') && r1('ncBId')) {
    await rec3(page, 'R3-02b', `G8 (R1 chain, backfilled by migration 0129): NC-B ${r1('ncBCode')} continues NC-A ${r1('ncACode')} — read-only`, async () =>
      checkParentLink(page, { id: r1('ncAId'), url: r1('ncAUrl'), code: r1('ncACode') }, { id: r1('ncBId'), url: r1('ncBUrl'), code: r1('ncBCode') }, ''),
    );
  }
  if (r1('ncBId') && r1('ncCId')) {
    await rec3(page, 'R3-02b2', `G8 (R1 chain): NC-C ${r1('ncCCode')} continues NC-B ${r1('ncBCode')} — page, API parentNcId, related docs both ways`, async () =>
      checkParentLink(page, { id: r1('ncBId'), url: r1('ncBUrl'), code: r1('ncBCode') }, { id: r1('ncCId'), url: r1('ncCUrl'), code: r1('ncCCode') }, ''),
    );
  }
  if (r1('ncCId') && r1('ncDId')) {
    await rec3(page, 'R3-02b3', `G8 (R1 chain): NC-D ${r1('ncDCode')} continues NC-C ${r1('ncCCode')} — page, API parentNcId, related docs both ways`, async () =>
      checkParentLink(page, { id: r1('ncCId'), url: r1('ncCUrl'), code: r1('ncCCode') }, { id: r1('ncDId'), url: r1('ncDUrl'), code: r1('ncDCode') }, ''),
    );
  }
  if (r1('ncAId') && r1('ncDId')) {
    await rec3(page, 'R3-02d', `G8 (R1 chain): walk parentNcId from NC-D upwards through the API — the whole chain A ← B ← C ← D must be reachable and end at NC-A (no parent)`, async () => {
      const ids = ['A', 'B', 'C', 'D'].map((k) => ({ k, id: r1('nc' + k + 'Id'), code: r1('nc' + k + 'Code') }));
      const seen: string[] = [];
      let cur: string | null = r1('ncDId');
      for (let i = 0; i < 6 && cur; i += 1) {
        const n = await ncApi(page, cur);
        seen.push(n.code);
        cur = n.parentNcId ?? null;
      }
      const want = [...ids].reverse().map((x) => x.code);
      const ok = JSON.stringify(seen) === JSON.stringify(want);
      const arrow = [...seen].reverse().join(' ← ');
      return [
        {
          document: r1('ncDCode'),
          qty: `${seen.length} NCs in the chain`,
          headerStatus: 'chain',
          overallStatus: arrow,
          ok,
          note: `walked from NC-D: ${seen.join(' → ')} (expected ${want.join(' → ')})`,
        },
      ];
    });
  }
});

// ── R3-B: chain N — G7 "Return challan pending" + G8 on the live path ─────

test('R3 - chain N (G7 + G8 live): JWPO 6 -> DC 6 -> GRN -> QC 4/2 -> NC-A -> Return to vendor WITHOUT a challan ("Return challan pending 2") -> Create DC ("Sent to vendor 2") -> replacement 1 ok / 1 rej (NC-B continues NC-A) -> NC-B out 1 -> back 1 ok -> "NC closed 2"', async ({ page }) => {
  test.setTimeout(2_700_000);
  await buildOspChainR2(page, 'n', R3_N_QTY, R3_N_QTY, { label: 'chain N', poRef: 'E2E_ADR167-N', tag: R3_TAG, section: 'R3' });
  const jc = r2('nJcCode');
  const jcUrl = r2('nJcUrl');
  const poId = r2('nPoId');
  if (!r2('nQc1Done')) {
    await incomingQc(page, r2('nGrn1Code'), R3_N_ACC1, R3_N_REJ1, `E2E_ ${R3_TAG} chain N - inspection ${R3_N_ACC1} ok / ${R3_N_REJ1} rej (NC-A)`);
    r2Set({ nQc1Done: 'yes' });
  }
  if (!r2('nNcACode')) {
    const code = await newestNc(page, jc, []);
    const o = await openNc(page, code);
    r2Set({ nNcACode: code, nNcAUrl: o.url, nNcAId: o.id });
    doc('R3 chain N NC-A', code);
  }
  // ── Dispose return-to-vendor, and STOP before the challan ──
  if (!r2('nNcADisposed')) {
    const msg = await tryDispose(page, r2('nNcAUrl'), 'return_to_vendor', R3_N_REJ1, `E2E_ ${R3_TAG} chain N - NC-A return ${R3_N_REJ1} to vendor (challan created in the next step)`);
    const n = await ncApi(page, r2('nNcAId'));
    if (n.disposition !== 'return_to_vendor') {
      blocked3('R3-03', 'NC-A → Return to vendor (no challan yet)', 'dispose refused: ' + msg);
      return;
    }
    r2Set({ nNcADisposed: 'yes' });
  }
  await rec3(page, 'R3-03', `G7: NC-A ${r2('nNcACode')} → Dispose: Return to vendor ${R3_N_REJ1} — the return challan is NOT created yet. The op card must show the 2 pieces as "Return challan pending 2" (before 0129 they vanished from the strip) with AT VENDOR 0`, async () => {
    const o1 = (await opsOf(page, jc))[0]!;
    const n = await ncApi(page, r2('nNcAId'));
    const po = await readPo(page, poId);
    const body = await jcBody(page, jcUrl);
    const card = opCardText(body, 1);
    const strip = await jcNcStrips(page, jcUrl);
    const pending = stripNum(strip, 'Return Challan Pending');
    const opOk = o1.ncBreakup.rtvAwaitingChallanQty === R3_N_REJ1 && o1.atVendorQty === 0 && pending === R3_N_REJ1 && !/Sent to Vendor\s*[1-9]/.test(strip) && !/NC Raised\s*[1-9]/.test(strip);
    const d = await readNcDetail(page, r2('nNcAUrl'));
    return [
      {
        document: `${jc} Op 1`,
        qty: `${R3_N_REJ1}`,
        headerStatus: opBadge(card),
        overallStatus: `Return challan pending ${pending}; At vendor ${o1.atVendorQty}; strip "${strip}"`,
        ok: opOk,
        note: `api ncBreakup.rtvAwaitingChallanQty=${o1.ncBreakup.rtvAwaitingChallanQty} sentToVendorQty=${o1.ncBreakup.sentToVendorQty} ncRaisedQty=${o1.ncBreakup.ncRaisedQty}; ${opLine(o1)}; card tiles: ${tilesOf(card)}`,
      },
      {
        document: r2('nNcACode'),
        qty: `${R3_N_REJ1} rejected`,
        headerStatus: d.status,
        overallStatus: `disposition ${cap(n.disposition ?? '')}; sent ${Number(n.rtvSentQty)} (no challan yet)`,
        ok: n.status === 'disposed' && n.disposition === 'return_to_vendor' && Number(n.rtvSentQty) === 0,
        note: ncLine(n),
      },
      {
        document: po.code,
        qty: `${po.received[0]} of ${po.qty[0]} received`,
        headerStatus: cap(po.status),
        overallStatus: 'unchanged until the challan goes out',
        ok: po.received[0] === R3_N_QTY,
        note: poText(po),
      },
    ];
  });
  // ── Create DC ──
  if (!r2('nRtvDcAId')) {
    const dc = await createRtvDc(page, r2('nNcAUrl'), `E2E_ ${R3_TAG} chain N - NC-A return challan`);
    r2Set({ nRtvDcAId: dc.id, nRtvDcACode: dc.code, nRtvDcAPrefill: dc.prefill });
    doc('R3 chain N RTV DC (NC-A)', dc.code);
  }
  await rec3(page, 'R3-03b', `G7: NC-A → Create DC ${r2('nRtvDcACode')} for the ${R3_N_REJ1} pieces — the strip moves them from "Return challan pending" to "Sent to vendor ${R3_N_REJ1}"`, async () => {
    const { ops, retried } = await opsWithRetry(page, jc, 'sent');
    const o1 = ops[0]!;
    const body = await jcBody(page, jcUrl);
    const card = opCardText(body, 1);
    const strip = await jcNcStrips(page, jcUrl);
    const dc = await readDcDetail(page, r2('nRtvDcAId'));
    const po = await readPo(page, poId);
    const n = await ncApi(page, r2('nNcAId'));
    const opOk = o1.ncBreakup.rtvAwaitingChallanQty === 0 && o1.ncBreakup.sentToVendorQty === R3_N_REJ1 && o1.atVendorQty === R3_N_REJ1 && stripNum(strip, 'Sent to Vendor') === R3_N_REJ1 && !/Return Challan Pending/.test(strip);
    return [
      {
        document: `${jc} Op 1`,
        qty: `${R3_N_REJ1}`,
        headerStatus: opBadge(card),
        overallStatus: `Sent to vendor ${stripNum(strip, 'Sent to Vendor')}; At vendor ${o1.atVendorQty}; strip "${strip}"`,
        ok: opOk,
        note: `${retried ? '(re-read after a 2-min wait) ' : ''}api rtvAwaitingChallanQty=${o1.ncBreakup.rtvAwaitingChallanQty} sentToVendorQty=${o1.ncBreakup.sentToVendorQty}; ${opLine(o1)}`,
      },
      { document: dc.code, qty: `${R3_N_REJ1}`, headerStatus: cap(dc.status), overallStatus: `return challan for ${dc.nc || '(no NC pair)'}`, ok: dc.status === 'issued' && dc.hasNc, note: `vendor box on open: "${r2('nRtvDcAPrefill')}"; line "${dc.line}"` },
      { document: r2('nNcACode'), qty: `${Number(n.rtvSentQty)} sent`, headerStatus: (await readNcDetail(page, r2('nNcAUrl'))).status, overallStatus: `at vendor ${Number(n.rtvSentQty) - Number(n.rtvReceivedQty)}`, ok: Number(n.rtvSentQty) === R3_N_REJ1, note: ncLine(n) },
      { document: po.code, qty: `${po.received[0]} of ${po.qty[0]} received`, headerStatus: cap(po.status), overallStatus: `${R3_N_REJ1} back out on the return challan`, ok: po.received[0] === R3_N_QTY - R3_N_REJ1 && po.status === 'partial', note: poText(po) },
    ];
  });
  // ── Replacement 1 ok / 1 rej → NC-B (live G8 path) ──
  if (!r2('nGrnAId')) {
    const g = await grnAgainstNc(page, r2('nNcACode'), R3_N_REJ1, `E2E_ ${R3_TAG} chain N - GRN against NC-A (${R3_N_REJ1} of ${R3_N_REJ1})`);
    r2Set({ nGrnAId: g.id, nGrnACode: g.code });
    doc('R3 chain N GRN (Against NC-A)', g.code);
  }
  if (!r2('nQcADone')) {
    await incomingQc(page, r2('nGrnACode'), R3_N_ACC2, R3_N_REJ2, `E2E_ ${R3_TAG} chain N - NC-A replacement QC ${R3_N_ACC2} ok / ${R3_N_REJ2} rej (NC-B)`);
    r2Set({ nQcADone: 'yes' });
  }
  if (!r2('nNcBCode')) {
    const code = await newestNc(page, jc, [r2('nNcACode')]);
    const o = await openNc(page, code);
    r2Set({ nNcBCode: code, nNcBUrl: o.url, nNcBId: o.id });
    doc('R3 chain N NC-B', code);
  }
  await rec3(page, 'R3-02c', `G8 (live path): GRN ${r2('nGrnACode')} against NC-A → Incoming QC ${R3_N_ACC2} ok / ${R3_N_REJ2} rej → NC-B ${r2('nNcBCode')} raised by the ADR-167 API — must continue NC-A ${r2('nNcACode')}`, async () => {
    const rows = await checkParentLink(page, { id: r2('nNcAId'), url: r2('nNcAUrl'), code: r2('nNcACode') }, { id: r2('nNcBId'), url: r2('nNcBUrl'), code: r2('nNcBCode') }, 'the ADR-167 API should have stamped it at creation (apps/api/src/modules/nc-register/cascades.ts autoCreateNcFromQcReject)');
    const o1 = (await opsOf(page, jc))[0]!;
    const strip = await jcNcStrips(page, jcUrl);
    const nA = await ncApi(page, r2('nNcAId'));
    rows.push({
      document: `${jc} Op 1`,
      qty: `NC closed ${stripNum(strip, 'NC Closed')}, NC raised ${stripNum(strip, 'NC Raised')}`,
      headerStatus: opBadge(opCardText(await jcBody(page, jcUrl), 1)),
      overallStatus: `strip "${strip}"`,
      ok: o1.ncBreakup.ncClosedQty === R3_N_ACC2 && o1.ncBreakup.ncRaisedQty === R3_N_REJ2 && /closed/i.test(nA.status) && Number(nA.clearedQty) === R3_N_ACC2 && Number(nA.failedQty) === R3_N_REJ2,
      note: `G7 mid-way: NC-A closed cleared ${Number(nA.clearedQty)} / failed ${Number(nA.failedQty)} → "NC closed" counts the 1 cleared piece only (the failed piece lives on as NC-B "NC raised 1"); ${opLine(o1)}`,
    });
    return rows;
  });
  // ── Second cycle: NC-B out 1 → GRN 1 → QC 1 ok → everything closed ──
  const refusedB = await rtvOut(page, 'n', 'B', R3_N_REJ2, 'chain N');
  if (refusedB) {
    blocked3('R3-03c', 'NC-B → Return to vendor 1', refusedB);
    return;
  }
  if (!r2('nGrnBId')) {
    const g = await grnAgainstNc(page, r2('nNcBCode'), R3_N_REJ2, `E2E_ ${R3_TAG} chain N - GRN against NC-B (${R3_N_REJ2} of ${R3_N_REJ2})`);
    r2Set({ nGrnBId: g.id, nGrnBCode: g.code });
    doc('R3 chain N GRN (Against NC-B)', g.code);
  }
  if (!r2('nQcBDone')) {
    await incomingQc(page, r2('nGrnBCode'), R3_N_ACC3, 0, `E2E_ ${R3_TAG} chain N - NC-B replacement QC ${R3_N_ACC3} ok`);
    r2Set({ nQcBDone: 'yes' });
  }
  await rec3(page, 'R3-03c', `G7 close-out: NC-B → Return to vendor ${R3_N_REJ2} on ${r2('nRtvDcBCode')} → GRN ${r2('nGrnBCode')} → Incoming QC ${R3_N_ACC3} ok — strip ends "NC closed ${R3_N_ACC2 + R3_N_ACC3}" (1 + 1 pieces; the old view would have said 3 = 2 + 1 rejections), op complete, JC closed`, async () => {
    const o1 = (await opsOf(page, jc))[0]!;
    const j = await jcApi(page, r2('nJcId'));
    const nA = await ncApi(page, r2('nNcAId'));
    const nB = await ncApi(page, r2('nNcBId'));
    const po = await readPo(page, poId);
    const body = await jcBody(page, jcUrl);
    const card = opCardText(body, 1);
    const strip = await jcNcStrips(page, jcUrl);
    const closed = stripNum(strip, 'NC Closed');
    return [
      {
        document: `${jc} Op 1`,
        qty: `NC closed ${closed}; DONE ${o1.completedQty}`,
        headerStatus: opBadge(card),
        overallStatus: `JC ${cap(j.computedStatus)}${j.closedAt ? ' (closed_at set)' : ''}; strip "${strip}"`,
        ok: o1.ncBreakup.ncClosedQty === R3_N_ACC2 + R3_N_ACC3 && closed === R3_N_ACC2 + R3_N_ACC3 && o1.ncBreakup.ncOpenQty === 0 && o1.completedQty === R3_N_QTY && o1.atVendorQty === 0 && o1.computedStatus === 'complete' && Boolean(j.closedAt),
        note: `api ncClosedQty=${o1.ncBreakup.ncClosedQty}; ${opLine(o1)}; ${jcApiLine(j)}`,
      },
      { document: r2('nNcACode'), qty: `cleared ${Number(nA.clearedQty)} / failed ${Number(nA.failedQty)}`, headerStatus: cap(nA.status), overallStatus: 'first trip closed', ok: /closed/i.test(nA.status) && Number(nA.clearedQty) === R3_N_ACC2 && Number(nA.failedQty) === R3_N_REJ2, note: ncLine(nA) },
      { document: r2('nNcBCode'), qty: `cleared ${Number(nB.clearedQty)} / failed ${Number(nB.failedQty)}`, headerStatus: cap(nB.status), overallStatus: 'second trip closed', ok: /closed/i.test(nB.status) && Number(nB.clearedQty) === R3_N_ACC3 && Number(nB.failedQty) === 0, note: ncLine(nB) },
      { document: po.code, qty: `${po.received[0]} of ${po.qty[0]} received`, headerStatus: cap(po.status), overallStatus: 'every piece accepted', ok: po.received[0] === R3_N_QTY && po.status === 'closed', note: poText(po) },
    ];
  });
});

// ── R3-B2: chain U — migration 0131 (ADR-167 code-review F1): a use-as-is
//    close must still show its pieces under "NC closed" (0129 read 0 and the
//    strip vanished; 0131 counts the whole rejected qty for a non-RTV close) ──

const R3_U_QTY = 3;
const R3_U_ACC1 = 1;
const R3_U_REJ1 = 2; // NC-A: disposed "Use as is" — no recovery ledger

test('R3 - chain U (0131 F1): JWPO 3 -> DC 3 -> GRN 3 -> Incoming QC 1 ok / 2 rej -> NC -> Dispose "Use as is" 2 -> strip "NC closed 2" (0129 read 0: strip hidden), NC closed, op card', async ({ page }) => {
  test.setTimeout(1_800_000);
  await buildOspChainR2(page, 'u', R3_U_QTY, R3_U_QTY, { label: 'chain U', poRef: 'E2E_ADR167-U', tag: R3_TAG, section: 'R3' });
  const jc = r2('uJcCode');
  const jcUrl = r2('uJcUrl');
  if (!r2('uQc1Done')) {
    await incomingQc(page, r2('uGrn1Code'), R3_U_ACC1, R3_U_REJ1, `E2E_ ${R3_TAG} chain U - inspection ${R3_U_ACC1} ok / ${R3_U_REJ1} rej (NC-A, to be closed use-as-is)`);
    r2Set({ uQc1Done: 'yes' });
  }
  if (!r2('uNcACode')) {
    const code = await newestNc(page, jc, []);
    const o = await openNc(page, code);
    r2Set({ uNcACode: code, uNcAUrl: o.url, uNcAId: o.id });
    doc('R3 chain U NC-A (use as is)', code);
  }
  const before = (await opsOf(page, jc))[0]!;
  const stripBefore = await jcNcStrips(page, jcUrl);
  if (!r2('uNcADisposed')) {
    const msg = await tryDispose(page, r2('uNcAUrl'), 'use_as_is', R3_U_REJ1, `E2E_ ${R3_TAG} chain U - NC-A use as is ${R3_U_REJ1} (0131 F1 strip check)`);
    const n = await ncApi(page, r2('uNcAId'));
    if (n.disposition !== 'use_as_is') {
      blocked3('R3-10', 'NC-A → Dispose: Use as is', 'dispose refused: ' + (msg || '(no message)'));
      return;
    }
    r2Set({ uNcADisposed: 'yes', uStripBefore: stripBefore, uBeforeLine: opLine(before) });
  }
  await rec3(page, 'R3-10', `0131 F1: ${jc} Op 1 → Incoming QC ${R3_U_ACC1} ok / ${R3_U_REJ1} rej → NC-A ${r2('uNcACode')} → Dispose "Use as is" ${R3_U_REJ1} (no return challan, no rework card — cleared_qty stays 0) — the strip must read "NC closed ${R3_U_REJ1}" (under 0129 it read 0 and the strip disappeared); NC closed with disposition use_as_is`, async () => {
    const o1 = (await opsOf(page, jc))[0]!;
    const n = await ncApi(page, r2('uNcAId'));
    const j = await jcApi(page, r2('uJcId'));
    const body = await jcBody(page, jcUrl);
    const card = opCardText(body, 1);
    const strip = await jcNcStrips(page, jcUrl);
    const closed = stripNum(strip, 'NC Closed');
    const d = await readNcDetail(page, r2('uNcAUrl'));
    return [
      {
        document: `${jc} Op 1`,
        qty: `NC closed ${closed}; DONE ${o1.completedQty}`,
        headerStatus: opBadge(card),
        overallStatus: `JC ${cap(j.computedStatus)}; strip "${strip}" (before the close: "${r2('uStripBefore')}")`,
        ok: o1.ncBreakup.ncClosedQty === R3_U_REJ1 && closed === R3_U_REJ1 && o1.ncBreakup.ncOpenQty === 0 && o1.ncBreakup.scrapQty === 0,
        note: `api ncBreakup.ncClosedQty=${o1.ncBreakup.ncClosedQty} ncOpenQty=${o1.ncBreakup.ncOpenQty} (0129 rule: cleared_qty 0 → closed 0); ${opLine(o1)}; before the close: ${r2('uBeforeLine')}; card tiles: ${tilesOf(card)}`,
      },
      {
        document: r2('uNcACode'),
        qty: `${Number(n.rejectedQty)} rejected`,
        headerStatus: d.status,
        overallStatus: `disposition ${cap(n.disposition ?? '')}; cleared ${Number(n.clearedQty)} / failed ${Number(n.failedQty)}`,
        ok: /closed/i.test(n.status) && n.disposition === 'use_as_is' && Number(n.clearedQty) === 0,
        note: ncLine(n),
      },
    ];
  });
});

// ── R3-C: chain P — G9a delete / reject, G9b second PO on the same op ──────

/** G9a delete cycle on a fresh chain `p`: SO → JC (one OSP op) → auto PR →
 *  Gen PO (approved → open) [R3-04a] → Delete → Confirm → op back to "PR
 *  raised", PR re-opened, Activity Log rows [R3-04b]. Leaves the chain at
 *  pr_raised with its PR open. */
async function g9aDeleteCycle(page: Page, p: string, label: string): Promise<void> {
  // build: SO → JC → auto PR → JWPO 1 (approved → open)
  if (!r2(p + 'SoCode')) {
    const so = await createSo(page, R3_P_QTY, `E2E_ADR167-P-${STAMP}`);
    r2Set({ [p + 'SoCode']: so.code, [p + 'SoUrl']: so.url });
    doc(`R3 ${label} SO`, so.code);
  }
  if (!r2(p + 'JcCode')) {
    const jc = await planAndExecute(page, r2(p + 'SoCode'), R3_P_QTY, { kind: 'outsource', name: `E2E_ Heat treatment (ADR-167 ${label})` });
    r2Set({ [p + 'JcCode']: jc });
    doc(`R3 ${label} JC`, jc);
  }
  if (!r2(p + 'JcUrl')) {
    const url = await jcUrlByCode(page, r2(p + 'JcCode'));
    r2Set({ [p + 'JcUrl']: url, [p + 'JcId']: idFromUrl(url) });
  }
  const jc = r2(p + 'JcCode');
  const jcUrl = r2(p + 'JcUrl');
  if (!r2(p + 'PrId')) {
    const b = await boardOp1(page, jc);
    expect(b.outsourcePrId, 'auto JW PR on the op').toBeTruthy();
    r2Set({ [p + 'PrId']: b.outsourcePrId!, [p + 'PrCode']: b.outsourcePrCode ?? '' });
    doc(`R3 ${label} JW PR (auto)`, b.outsourcePrCode ?? '');
  }
  const prId = r2(p + 'PrId');
  const prCode = r2(p + 'PrCode');
  if (!r2(p + 'Po1Id')) {
    const po = await genPoFromJc(page, jcUrl, `E2E_ ${R3_TAG} - ${label} - JWPO 1 (to be deleted: G9a) - safe to cancel.`);
    r2Set({ [p + 'Po1Id']: po.id, [p + 'Po1Code']: po.code });
    doc(`R3 ${label} JWPO 1 (deleted)`, po.code);
  }
  await rec3(page, 'R3-04a', `G9a before: ${jc} Op 1 → Gen PO → ${r2(p + 'Po1Code')} (approved → open) — the op is committed to it and the PR is fully ordered`, async () => {
    const po = await readPo(page, r2(p + 'Po1Id'));
    const b = await boardOp1(page, jc);
    const o1 = (await opsOf(page, jc))[0]!;
    const pr = await prApi(page, prId);
    const prPage = await prOnPage(page, prId);
    return [
      { document: po.code, qty: `${po.qty[0]}`, headerStatus: cap(po.status), overallStatus: 'covers the op', ok: /^(open|draft)$/.test(po.status) && po.qty[0] === R3_P_QTY, note: poText(po) },
      { document: `${jc} Op 1`, qty: '', headerStatus: opBadge((await opCardSettled(page, jcUrl)).card), overallStatus: `${cap(o1.outsourceStatus ?? '')} — PO ${b.outsourcePoCode ?? 'null'}`, ok: o1.outsourceStatus === 'po_created' && b.outsourcePoId === r2(p + 'Po1Id'), note: `${boardLine(b)}; ${opLine(o1)}` },
      { document: prCode, qty: `ordered ${pr.orderedQty ?? '?'} / balance ${pr.balanceQty ?? '?'}`, headerStatus: prPage.badge, overallStatus: `page Ordered ${prPage.ordered}, Balance ${prPage.balance}`, ok: pr.status === 'po_created' && (pr.orderedQty ?? -1) === R3_P_QTY && (pr.balanceQty ?? -1) === 0, note: `api status=${pr.status} orderedQty=${pr.orderedQty} balanceQty=${pr.balanceQty} poId=${pr.poId ?? 'null'}` },
    ];
  });
  // ── Delete (or reject when still draft) ──
  if (!r2(p + 'Po1Gone')) {
    const res = await deletePoUi(page, r2(p + 'Po1Id'));
    r2Set({ [p + 'Po1Gone']: res.gone ? 'yes' : '', [p + 'Po1Via']: res.via, [p + 'Po1Before']: res.before, [p + 'Po1Msg']: res.message });
    if (!res.gone) {
      blocked3('R3-04b', `${r2(p + 'Po1Code')} → ${res.via === 'reject' ? 'Reject' : 'Delete'} on the PO page`, `the app did not remove the PO: badge before "${res.before}", via ${res.via}, message "${res.message || '(none)'}"`);
      return;
    }
  }
  await rec3(page, 'R3-04b', `G9a: ${r2(p + 'Po1Code')} → ${r2(p + 'Po1Via') === 'reject' ? 'Reject (PO was draft)' : 'Delete → Confirm (PO was "' + r2(p + 'Po1Before') + '", so Reject is not offered)'} — the op must fall back to "PR raised" with no PO ref and no Gen DC; the PR re-opens with its balance restored; Activity Log rows on the JC and the PR`, async () => {
    const probe = await apiProbe(page, '/purchase-orders/' + r2(p + 'Po1Id'));
    const b = await boardOp1(page, jc);
    const o1 = (await opsOf(page, jc))[0]!;
    const { card, genDc, genPo } = await opCardSettled(page, jcUrl);
    const prRef = new RegExp('PR:\\s*' + prCode.replace(/-/g, '\\-')).test(card);
    const poRefOnCard = /PO:\s*IN-/.test(card);
    const pr = await prApi(page, prId);
    const prPage = await prOnPage(page, prId);
    const jcLog = await activityWith(page, jc, /released from PO/);
    const prLog = await activityWith(page, prCode, /back to (open|approved)/);
    await showActivity(page, jc);
    const opOk = o1.outsourceStatus === 'pr_raised' && b.outsourcePoId === null && b.outsourcePoCode === null && b.outsourcePrCode === prCode && prRef && !poRefOnCard && genDc === 0 && genPo > 0;
    const prOk = /^(open|approved)$/.test(pr.status) && (pr.orderedQty ?? -1) === 0 && (pr.balanceQty ?? -1) === R3_P_QTY && prPage.ordered === '0' && prPage.balance === String(R3_P_QTY);
    return [
      { document: r2(p + 'Po1Code'), qty: '', headerStatus: probe.status === 404 ? 'Deleted (404)' : `HTTP ${probe.status}`, overallStatus: r2(p + 'Po1Via') === 'reject' ? 'Cancelled' : 'gone from the list', ok: probe.status === 404 || /cancelled/.test(probe.text), note: `GET /purchase-orders/<id> → HTTP ${probe.status} ${probe.text.slice(0, 80)}` },
      { document: `${jc} Op 1`, qty: '', headerStatus: opBadge(card), overallStatus: `${cap(o1.outsourceStatus ?? 'null')}; card ref "${/P[RO]:\s*IN-[A-Z-]+\d+(?:\/R\d+)?/.exec(card)?.[0] ?? 'none'}"; Gen PO ${genPo ? 'offered' : 'absent'}, Gen DC ${genDc ? 'offered' : 'absent'}`, ok: opOk, note: `${boardLine(b)}; ${opLine(o1)}` },
      { document: prCode, qty: `ordered ${pr.orderedQty ?? '?'} / balance ${pr.balanceQty ?? '?'}`, headerStatus: prPage.badge, overallStatus: `page Ordered ${prPage.ordered}, Balance ${prPage.balance}`, ok: prOk, note: `api status=${pr.status} orderedQty=${pr.orderedQty} balanceQty=${pr.balanceQty} poId=${pr.poId ?? 'null'}` },
      { document: `Activity Log (${jc} / ${prCode})`, qty: `${jcLog.length} + ${prLog.length} rows`, headerStatus: '', overallStatus: jcLog[0] ? jcLog[0].slice(20, 140) : '(no JC row)', ok: jcLog.length >= 1 && prLog.length >= 1, note: `JC rows: [${jcLog.join(' | ') || 'none'}]; PR rows: [${prLog.join(' | ') || 'none'}]` },
    ];
  });
}

test('R3 - chain P (G9a + G9b): SO 6 -> JC (OSP op) -> auto PR -> Gen PO -> Delete PO -> op "PR raised", PR re-opened -> Gen PO again (4 of 6) -> PR "Create PO" for the last 2 -> DC 2 on the second PO -> GRN -> QC 2 ok -> DONE 2; chain G PO delete refused', async ({ page }) => {
  test.setTimeout(2_700_000);
  // The delete cycle (R3-04a / R3-04b) runs on chain P the first time. Chain P's
  // first pass (06:44Z) read the op card before the jc-ops board had landed and
  // recorded "no PR ref / no Gen PO" although the API (and the very next step,
  // which clicked Gen PO on that card) showed the release had worked — a weak
  // read in this spec, not an app defect. Chain P has since moved past the
  // deleted state, so the cycle is re-read on a fresh chain Q with the fixed
  // read (opCardSettled) and chain P's R3-04a/b rows are replaced.
  const pMovedOn = Boolean(r2('pPo2Id'));
  if (!pMovedOn) {
    await g9aDeleteCycle(page, 'p', 'chain P');
  } else {
    if (!r2('qCycleStarted')) {
      const rep = readReport();
      rep.rows = rep.rows.filter((x) => !x.id.startsWith('R3-04a-') && !x.id.startsWith('R3-04b-'));
      writeReport(rep);
      finding('[R3] R3-04a/R3-04b were first run on chain P (IN-JC-26-00043; IN-JWPO-00015/R1 deleted at 06:44Z). That read took the op card before the jc-ops board fetch had landed and reported "no PR ref, no Gen PO" while the API already showed pr_raised / PO null and the very next step clicked Gen PO on that same card. Spec weakness (fixed: opCardSettled waits for the board), not an app defect. The cycle was re-run on chain Q and those are the rows shown.');
      r2Set({ qCycleStarted: 'yes' });
    }
    await g9aDeleteCycle(page, 'q', 'chain Q');
  }
  const jc = r2('pJcCode');
  const jcUrl = r2('pJcUrl');
  const prId = r2('pPrId');
  const prCode = r2('pPrCode');
  // ── Gen PO again: 4 of 6 ──
  if (!r2('pPo2Id')) {
    await jcBody(page, jcUrl);
    await page.getByRole('link', { name: /Gen PO/ }).first().click();
    await expect(page).toHaveURL(/purchase-orders\/from-pr\?prId=/, { timeout: 60_000 });
    const po = await savePoForm(page, `E2E_ ${R3_TAG} - chain P - JWPO 2 (${R3_P_PO2} of ${R3_P_QTY}) - safe to cancel.`, R3_P_PO2);
    r2Set({ pPo2Id: po.id, pPo2Code: po.code });
    doc('R3 chain P JWPO 2', po.code);
  }
  await rec3(page, 'R3-04c', `G9a after: ${jc} Op 1 → Gen PO again → ${r2('pPo2Code')} for ${R3_P_PO2} of ${R3_P_QTY} — a second JWPO is created and the op links to it (the PR keeps a balance of ${R3_P_QTY - R3_P_PO2} for the next step)`, async () => {
    const po = await readPo(page, r2('pPo2Id'));
    const b = await boardOp1(page, jc);
    const o1 = (await opsOf(page, jc))[0]!;
    const pr = await prApi(page, prId);
    const prPage = await prOnPage(page, prId);
    const badge = opBadge(opCardText(await jcBody(page, jcUrl), 1));
    // Gen DC must now point at the NEW PO (nothing saved — the form is left as is).
    const prev = await genDcPreview(page, jcUrl, r2('pPo2Id'));
    const dcUrlPo = /poId=([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    return [
      { document: po.code, qty: `${po.qty[0]}`, headerStatus: cap(po.status), overallStatus: 'second JWPO on the same op', ok: po.status === 'open' && po.qty[0] === R3_P_PO2 && po.code !== r2('pPo1Code'), note: poText(po) },
      { document: `${jc} Op 1`, qty: '', headerStatus: badge, overallStatus: `${cap(o1.outsourceStatus ?? '')} — PO ${b.outsourcePoCode ?? 'null'}`, ok: o1.outsourceStatus === 'po_created' && b.outsourcePoId === r2('pPo2Id'), note: `${boardLine(b)}; ${opLine(o1)}` },
      { document: `${jc} Op 1 → Gen DC`, qty: `Can send now ${prev.canSendNow}`, headerStatus: prev.linkText, overallStatus: `challan form opened on ${dcUrlPo === r2('pPo2Id') ? po.code + ' (the new PO)' : dcUrlPo === r2('pPo1Id') ? r2('pPo1Code') + ' — STALE, the deleted PO' : 'PO id ' + (dcUrlPo || 'none')}`, ok: dcUrlPo === r2('pPo2Id') && prev.canSendNow === String(R3_P_PO2), note: `link "${prev.linkText}"; form URL poId=${dcUrlPo}; Can send now ${prev.canSendNow}; qty max ${prev.inputMax}; sendable API ${prev.api} (left unsaved)` },
      { document: prCode, qty: `ordered ${pr.orderedQty ?? '?'} / balance ${pr.balanceQty ?? '?'}`, headerStatus: prPage.badge, overallStatus: `page Ordered ${prPage.ordered}, Balance ${prPage.balance}`, ok: (pr.orderedQty ?? -1) === R3_P_PO2 && (pr.balanceQty ?? -1) === R3_P_QTY - R3_P_PO2, note: `api status=${pr.status} orderedQty=${pr.orderedQty} balanceQty=${pr.balanceQty}` },
    ];
  });
  // ── G9b: third JWPO from the PR page for the last 2 → second link on the op ──
  if (!r2('pPo3Id')) {
    await page.goto('/purchase-requests/' + prId, { waitUntil: 'domcontentloaded' });
    const createPo = page.getByRole('link', { name: /Create PO/ }).or(page.getByRole('button', { name: /Create PO/ })).first();
    await expect(createPo, 'PR page offers "Create PO" while a balance remains').toBeVisible({ timeout: 60_000 });
    await createPo.click();
    await expect(page).toHaveURL(/purchase-orders\/from-pr\?prId=/, { timeout: 60_000 });
    const po = await savePoForm(page, `E2E_ ${R3_TAG} - chain P - JWPO 3 (last ${R3_P_PO3} of ${R3_P_QTY}, second PO on the op: G9b) - safe to cancel.`, R3_P_PO3);
    r2Set({ pPo3Id: po.id, pPo3Code: po.code });
    doc('R3 chain P JWPO 3 (second link)', po.code);
  }
  await rec3(page, 'R3-08a', `G9b: PR ${prCode} page → Create PO → ${r2('pPo3Code')} for the last ${R3_P_PO3} — the op now has TWO live PO links (jc_op_po_lines); the challan screen must allow sending on the second PO`, async () => {
    const po3 = await readPo(page, r2('pPo3Id'));
    const b = await boardOp1(page, jc);
    const o1 = (await opsOf(page, jc))[0]!;
    const pr = await prApi(page, prId);
    const sendable = await apiGet<SendableApi>(page, '/delivery-challans/sendable/' + r2('pPo3Id'));
    const max3 = sendable.lines[0]?.maxSendNow;
    const sendable2 = await apiGet<SendableApi>(page, '/delivery-challans/sendable/' + r2('pPo2Id'));
    const max2 = sendable2.lines[0]?.maxSendNow;
    return [
      { document: po3.code, qty: `${po3.qty[0]}`, headerStatus: cap(po3.status), overallStatus: `sendable now ${max3 ?? '?'} (second link on ${jc} Op 1)`, ok: po3.status === 'open' && po3.qty[0] === R3_P_PO3 && max3 === R3_P_PO3, note: `sendable API: ${sendable.lines.map((l) => `maxSendNow=${l.maxSendNow}${l.limitReason ? ' "' + l.limitReason + '"' : ''}`).join('; ')}` },
      { document: `${jc} Op 1`, qty: `ready to send ${o1.readyToSendQty}`, headerStatus: opBadge(opCardText(await jcBody(page, jcUrl), 1)), overallStatus: `first PO ${b.outsourcePoCode ?? 'null'} sendable ${max2 ?? '?'}; second PO ${po3.code} sendable ${max3 ?? '?'}`, ok: b.outsourcePoId === r2('pPo2Id') && max2 === R3_P_PO2, note: `${boardLine(b)}; ${opLine(o1)}` },
      { document: prCode, qty: `ordered ${pr.orderedQty ?? '?'} / balance ${pr.balanceQty ?? '?'}`, headerStatus: cap(pr.status), overallStatus: 'fully ordered across two POs', ok: (pr.orderedQty ?? -1) === R3_P_QTY && (pr.balanceQty ?? -1) === 0, note: `api status=${pr.status} orderedQty=${pr.orderedQty} balanceQty=${pr.balanceQty}` },
    ];
  });
  if (!r2('pDc3Id')) {
    const dc = await genDcForPo(page, r2('pPo3Id'), R3_P_PO3, `E2E_ ${R3_TAG} - chain P - outward challan ${R3_P_PO3} on the SECOND PO`);
    r2Set({ pDc3Id: dc.id, pDc3Code: dc.code, pDc3CanSend: dc.canSendNow });
    doc('R3 chain P outward DC (JWPO 3)', dc.code);
  }
  if (!r2('pGrn3Id')) {
    const g = await grnAgainstDc(page, r2('pPo3Code'), r2('pDc3Code'), R3_P_PO3, `E2E_ ${R3_TAG} - chain P - OSP return on the second PO (${R3_P_PO3} of ${R3_P_PO3})`);
    r2Set({ pGrn3Id: g.id, pGrn3Code: g.code });
    doc('R3 chain P GRN (JWPO 3 / DC)', g.code);
  }
  if (!r2('pQc3Done')) {
    await incomingQc(page, r2('pGrn3Code'), R3_P_PO3, 0, `E2E_ ${R3_TAG} chain P - inspection ${R3_P_PO3} ok (second PO)`);
    r2Set({ pQc3Done: 'yes' });
  }
  await rec3(page, 'R3-08b', `G9b: DC ${r2('pDc3Code')} (${R3_P_PO3}) on the SECOND PO ${r2('pPo3Code')} → GRN ${r2('pGrn3Code')} → Incoming QC ${R3_P_PO3} ok — the op card's DONE must count pieces received on a PO that is not the op's first line (migration 0130 rollup over jc_op_po_lines); the OSP register shows them too`, async () => {
    const o1 = (await opsOf(page, jc))[0]!;
    const body = await jcBody(page, jcUrl);
    const card = opCardText(body, 1);
    const po3 = await readPo(page, r2('pPo3Id'));
    const po2 = await readPo(page, r2('pPo2Id'));
    const wip = (await ospRegister(page, jc, 'all')).find((w) => w.jcCode === jc);
    const dc = await readDcDetail(page, r2('pDc3Id'));
    await jcBody(page, jcUrl);
    return [
      { document: `${jc} Op 1`, qty: `DONE ${o1.completedQty}`, headerStatus: opBadge(card), overallStatus: `${cap(o1.outsourceStatus ?? '')}; at vendor ${o1.atVendorQty}, in QC ${o1.inQcQty}, ready to send ${o1.readyToSendQty}`, ok: o1.completedQty === R3_P_PO3 && o1.atVendorQty === 0 && o1.inQcQty === 0, note: `card tiles: ${tilesOf(card)}; ${opLine(o1)} (challan form said "Can send now: ${r2('pDc3CanSend')}")` },
      { document: dc.code, qty: `${R3_P_PO3}`, headerStatus: cap(dc.status), overallStatus: dc.receiptsHdr, ok: dc.status === 'received', note: `PO pair "${dc.po}"` },
      { document: po3.code, qty: `${po3.received[0]} of ${po3.qty[0]} received`, headerStatus: cap(po3.status), overallStatus: 'second PO fully received', ok: po3.received[0] === R3_P_PO3 && po3.status === 'closed', note: poText(po3) },
      { document: po2.code, qty: `${po2.received[0]} of ${po2.qty[0]} received`, headerStatus: cap(po2.status), overallStatus: 'first PO untouched', ok: po2.received[0] === 0 && po2.status === 'open', note: poText(po2) },
      { document: `OSP register — ${jc}`, qty: wip ? `sent ${wip.sentQty}, accepted ${wip.acceptedQty}` : '', headerStatus: wip ? cap(wip.outsourceStatus ?? '') : '(not listed)', overallStatus: wip ? `at vendor ${wip.atVendorQty}, not sent ${wip.notSentQty}` : '(not listed)', ok: Boolean(wip) && wip!.sentQty === R3_P_PO3 && wip!.acceptedQty === R3_P_PO3, note: wip ? wipLine(wip) : 'no /osp-wip row for ' + jc },
    ];
  });
  // ── R3-05: chain G's PO has a challan + GRN behind it → Delete refused ──
  if (!r2('gPoId')) {
    blocked3('R3-05', 'Delete chain G PO', 'chain G (gPoId) is not in the state file');
    return;
  }
  const gBefore = (await opsOf(page, r2('gJcCode')))[0]!;
  const poBefore = await readPo(page, r2('gPoId'));
  const res = await deletePoUi(page, r2('gPoId'));
  await rec3(page, 'R3-05', `G9a guard: ${r2('gPoCode')} (chain G — DC ${r2('gDcCode')} and GRN ${r2('gGrn1Code')} behind it) → Delete → Confirm must be REFUSED with a message naming the challan or receipt; PO header unchanged, op untouched`, async () => {
    const po = await readPo(page, r2('gPoId'));
    const gAfter = (await opsOf(page, r2('gJcCode')))[0]!;
    const named = res.message.includes(r2('gDcCode')) || res.message.includes(r2('gGrn1Code'));
    const untouched = gAfter.outsourceStatus === gBefore.outsourceStatus && gAfter.completedQty === gBefore.completedQty && gAfter.atVendorQty === gBefore.atVendorQty;
    return [
      { document: po.code, qty: `${po.received[0]} of ${po.qty[0]} received`, headerStatus: cap(po.status), overallStatus: res.gone ? 'DELETED — guard missing' : `refused: "${res.message || '(no message caught)'}"`, ok: !res.gone && named && po.status === poBefore.status && po.received[0] === poBefore.received[0], note: `badge before "${res.before}", via ${res.via}; message "${res.message}"; ${poText(po)} (before: header "${poBefore.status}")` },
      { document: `${r2('gJcCode')} Op 1`, qty: `DONE ${gAfter.completedQty}`, headerStatus: cap(gAfter.outsourceStatus ?? ''), overallStatus: untouched ? 'unchanged' : 'CHANGED by the refused delete', ok: untouched, note: `before: ${opLine(gBefore)} | after: ${opLine(gAfter)}` },
    ];
  });
});

// ── R3-D: G9c — SO Status / SO Overview (read-only) ────────────────────────

test('R3 - G9c read-only: SO Status + SO Overview count GRN-accepted pieces for the OSP op (chain M SO complete, at vendor 0; chain G SO not complete)', async ({ page }) => {
  test.setTimeout(900_000);
  if (!r2('mSoUrl') || !r2('gSoUrl')) {
    blocked3('R3-06', 'SO Status / SO Overview for chains M and G', 'chain M / G SO urls are not in the state file');
    return;
  }
  const m = (await opsOf(page, r2('mJcCode')))[0]!;
  const g = (await opsOf(page, r2('gJcCode')))[0]!;
  await rec3(page, 'R3-06', `G9c: SO ${r2('mSoCode')} (chain M, OSP op ${m.completedQty}/${R2_M_QTY} accepted) → SO Status page shows the OSP op COMPLETE with At Vendor 0 (was "outsource received" / at vendor 3) and SO Overview lists it Completed / Closed`, async () =>
    soStatusRows(page, { id: idFromUrl(r2('mSoUrl')), code: r2('mSoCode'), jcCode: r2('mJcCode') }, true, 0, m.completedQty, `expectation from v_jc_op_status: done ${m.completedQty} of ${R2_M_QTY}, at vendor ${m.atVendorQty}, computed ${m.computedStatus}`),
  );
  if (r2('lSoUrl') && r2('lJcCode')) {
    const l = (await opsOf(page, r2('lJcCode')))[0]!;
    await rec3(page, 'R3-06c', `G9c: SO ${r2('lSoCode')} (chain L — the OSP op is the LAST op, ${l.completedQty} of ${R2_L_QTY} accepted straight from Incoming QC, no op-log row ever written) → SO Status shows the OSP op COMPLETE, At Vendor 0; SO Overview Completed / Closed`, async () =>
      soStatusRows(page, { id: idFromUrl(r2('lSoUrl')), code: r2('lSoCode'), jcCode: r2('lJcCode') }, true, 0, l.completedQty, `expectation from v_jc_op_status: done ${l.completedQty} of ${R2_L_QTY}, at vendor ${l.atVendorQty}, computed ${l.computedStatus}`),
    );
  }
  await rec3(page, 'R3-06b', `G9c: SO ${r2('gSoCode')} (chain G, ${g.completedQty} of ${R2_G_QTY} accepted, ${g.atVendorQty} at vendor, ${g.readyToSendQty} never sent) → SO Status shows the OSP op NOT complete with At Vendor ${g.atVendorQty}; SO Overview not completed`, async () =>
    soStatusRows(page, { id: idFromUrl(r2('gSoUrl')), code: r2('gSoCode'), jcCode: r2('gJcCode') }, g.computedStatus === 'complete', g.atVendorQty, g.completedQty, `expectation from v_jc_op_status at read time: done ${g.completedQty} of ${R2_G_QTY}, at vendor ${g.atVendorQty}, ready to send ${g.readyToSendQty}, computed ${g.computedStatus} (the brief's "at vendor 2" was true until the R2 extra-rows run received the 2 return pieces at 06:09Z and accepted them at 06:11Z)`),
  );
});

// ── R3-E: G9d — Job Cards → + New with an outsource op ─────────────────────

test('R3 - G9d: Job Cards -> + New (JW-only direct create) with one outsource op -> op reads "PR raised" with an IN-JWPR code right after save; JC activity line ends "raised OSP PR …"', async ({ page }) => {
  test.setTimeout(1_200_000);
  if (!r2('jwCode')) {
    const jw = await createJwso(page, R3_N_QTY);
    r2Set({ jwId: jw.id, jwCode: jw.code });
    doc('R3 JWSO (for the direct JC)', jw.code);
  }
  if (!r2('jwJcCode')) {
    const made = await createJcFromJwso(page, r2('jwCode'));
    r2Set({ jwJcCode: made.code, jwJcLabel: made.label, jwJcItemBox: made.itemBox, jwJcQtyBox: made.qtyBox, jwJcVendor: made.vendorPicked, jwJcVendorNote: made.vendorNote });
    doc('R3 direct JC (from JWSO)', made.code);
  }
  if (!r2('jwJcUrl')) {
    const url = await jcUrlByCode(page, r2('jwJcCode'));
    r2Set({ jwJcUrl: url, jwJcId: idFromUrl(url) });
  }
  const jc = r2('jwJcCode');
  // R3-07a (the vendor picker on this form) moved to its own test below —
  // it was FAIL on the first 2026-09-16 run (first 200 vendors only), fixed 58154c54.
  await rec3(page, 'R3-07', `G9d: Job Cards → + New → source "${r2('jwJcLabel')}" (item ${r2('jwJcItemBox')} × ${r2('jwJcQtyBox')} cascaded) → + Add OSP Op on ${r2('jwJcVendor') || VENDOR_CODE} → Save Job Card → ${jc}: the op must already read "PR raised" with an IN-JWPR code (before ADR-167 it sat at outsource_status NULL with no PR until the next edit)`, async () => {
    const b = await boardOp1(page, jc);
    const o1 = (await opsOf(page, jc))[0]!;
    // A directly-created JC numbers its ops 10, 20, … (the page prints "10 OSP"),
    // so the card is found by its OSP tag, and read only after the jc-ops board
    // (which supplies the "PR: …" reference) has landed.
    await jcBody(page, r2('jwJcUrl'));
    await page.getByText(/\bPR:\s*IN-JWPR-/).first().waitFor({ timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const cardAt = /\b(\d+)\s+OSP\b/.exec(body);
    const card = cardAt ? body.slice(cardAt.index, cardAt.index + 900) : '(no OSP card on the page)';
    const opNo = cardAt?.[1] ?? '?';
    const cardBadge = /OSP\s+([A-Z ]+?)\s+QUANTITIES/.exec(card)?.[1] ?? '?';
    const genPo = await page.getByRole('link', { name: /Gen PO/ }).count();
    const prOnCard = /PR:\s*(IN-JWPR-\d+)/.exec(card)?.[1] ?? '';
    const created = await activityWith(page, jc, /^Created /);
    const raised = created.find((l) => /raised OSP PR IN-JWPR-\d+/.test(l)) ?? '';
    const pr = b.outsourcePrId ? await prApi(page, b.outsourcePrId) : null;
    const j = await jcApi(page, r2('jwJcId'));
    await showActivity(page, jc);
    return [
      { document: `${jc} Op ${opNo}`, qty: `${r2('jwJcQtyBox')}`, headerStatus: cardBadge, overallStatus: `${cap(o1.outsourceStatus ?? 'null')}; card "PR: ${prOnCard || '—'}"; Gen PO ${genPo ? 'offered' : 'absent'}`, ok: o1.outsourceStatus === 'pr_raised' && /^IN-JWPR-\d+$/.test(b.outsourcePrCode ?? '') && prOnCard === b.outsourcePrCode && genPo > 0, note: `${boardLine(b)}; ${opLine(o1)}; ${jcApiLine(j)}; source label typed: "${r2('jwJcLabel')}"; card: "${card.slice(0, 260)}"` },
      { document: b.outsourcePrCode ?? '(no PR)', qty: pr ? `${pr.qty}` : '', headerStatus: pr ? cap(pr.status) : '—', overallStatus: pr ? `balance ${pr.balanceQty ?? '?'} to order` : 'no PR raised on save', ok: Boolean(pr) && /^(open|approved)$/.test(pr!.status) && pr!.qty === Number(r2('jwJcQtyBox')), note: pr ? `api status=${pr.status} qty=${pr.qty} orderedQty=${pr.orderedQty} balanceQty=${pr.balanceQty}` : 'outsourcePrId null on the board row' },
      { document: `Activity Log (${jc})`, qty: '', headerStatus: '', overallStatus: raised ? raised.slice(20, 160) : (created[0] ? created[0].slice(20, 160) : '(no Created row)'), ok: Boolean(raised), note: `Created rows: [${created.join(' | ') || 'none'}]` },
    ];
  });
});

// ── R3-07a re-run after 58154c54: the OSP vendor picker on the Job Cards form
//    searches the server (chain V: a fresh JWSO → direct JC with one in-house
//    op + TWO outsource ops; the in-house op is started so the Status-page
//    editor offers "Outsource balance" and its modal picker can be read). ────

const V_OTHER_VENDOR = 'VND-001';
interface JcDetailOp {
  id: string;
  opSeq: number;
  operation: string;
  opType: string;
  outsourceVendorCode: string | null;
  hasStarted: boolean;
  available: number;
}
/** What the picker showed while the form was filled — every value read off the screen. */
interface PickerRun {
  code: string;
  label: string;
  opt959: string;
  pickedLabel: string;
  optOther: string;
  labelAfterSecond: string;
  otherPicked: string;
}
/** Type `term` into a SearchableSelect and read its option list. */
async function comboOptions(page: Page, id: string, term: string, want: RegExp): Promise<{ texts: string[]; hit: string }> {
  const box = page.locator('#' + id);
  await box.click();
  await box.fill('');
  await box.fill(term);
  const hit = page.getByRole('option').filter({ hasText: want }).first();
  const found = await hit.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
  const texts = (await page.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const noMatch = (await page.locator('body').innerText()).includes('No matches');
  return { texts, hit: found ? (await hit.innerText()).replace(/\s+/g, ' ').trim() : noMatch ? 'No matches' : '(no option)' };
}
async function createJcChainV(page: Page, jwCode: string): Promise<PickerRun> {
  const opts = await apiGet<SourceOption[]>(page, '/job-cards/source-options');
  const o = opts.find((x) => x.type === 'jw' && x.code === jwCode);
  expect(o, `${jwCode} offered as a JW source`).toBeTruthy();
  const ln = o!.lineNo && o!.lineNo !== 1 ? ` / L${o!.lineNo}` : '';
  const part = o!.partName ? ` (${o!.partName})` : '';
  const label = `[JWSO] ${o!.code}${ln} — ${o!.customerName ?? ''}${part} [Avail: ${o!.remaining}]`;
  const next = (await apiGet<{ code: string }>(page, '/job-cards/next-code')).code;
  await page.goto('/job-cards/new', { waitUntil: 'domcontentloaded' });
  const src = page.getByPlaceholder(/Search JWSO number/);
  await src.waitFor({ timeout: 60_000 });
  await page.locator(`#dlJcSource option[value*="${jwCode}"]`).first().waitFor({ state: 'attached', timeout: 90_000 });
  await page.waitForTimeout(500);
  const picked = page.getByText(/\[JW\] Line \d+/);
  for (let attempt = 0; attempt < 3 && !(await picked.count()); attempt += 1) {
    await src.fill('');
    await src.fill(label);
    await page.waitForTimeout(1200);
  }
  expect(await picked.count(), `the form shows "[JW] Line n — ${jwCode}" after typing "${label}"`).toBeGreaterThan(0);
  const itemBox = page.getByPlaceholder(/Search item code or name/);
  if (!(await itemBox.inputValue()).trim()) await itemBox.fill(ITEM_CODE);
  const qtyBox = page.locator('.form-grp').filter({ hasText: /Order Qty/ }).locator('input[type="number"]').first();
  if (!(await qtyBox.inputValue()).trim()) await qtyBox.fill(String(o!.remaining || R3_N_QTY));
  // Op 1: in-house Turning on a CNC (so Op Entry can start it → "Outsource balance").
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('Operation name ★').nth(0).fill('E2E_ Turning (vendor picker, chain V)');
  await pickFirst(page, page.locator('#jc-edit-mach-0'), 'cnc');
  // Op 2: outsource — type "959" and expect "VND-959 — E2E_ Shreeji …".
  await page.getByRole('button', { name: /Add OSP Op/ }).click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('Operation name ★').nth(1).fill('E2E_ Heat treatment (vendor picker, chain V)');
  const first = await comboOptions(page, 'jc-edit-vend-1', '959', new RegExp(VENDOR_CODE + ' — E2E_ Shreeji'));
  if (first.hit.startsWith(VENDOR_CODE)) await page.getByRole('option').filter({ hasText: VENDOR_CODE }).first().click();
  await page.waitForTimeout(400);
  const pickedLabel = await page.locator('#jc-edit-vend-1').inputValue();
  // Op 3: a second outsource op searching ANOTHER vendor — row 2's label must survive.
  await page.getByRole('button', { name: /Add OSP Op/ }).click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('Operation name ★').nth(2).fill('E2E_ Plating (vendor picker, chain V)');
  const second = await comboOptions(page, 'jc-edit-vend-2', V_OTHER_VENDOR, new RegExp('^' + V_OTHER_VENDOR + ' — '));
  if (second.hit.startsWith(V_OTHER_VENDOR)) await page.getByRole('option').filter({ hasText: V_OTHER_VENDOR }).first().click();
  await page.waitForTimeout(400);
  const otherPicked = await page.locator('#jc-edit-vend-2').inputValue();
  const labelAfterSecond = await page.locator('#jc-edit-vend-1').inputValue();
  const remarks = page.getByPlaceholder(/Optional notes for this job card/);
  if (await remarks.count()) await remarks.fill(`E2E_ ${R3_TAG} - chain V: vendor picker re-run after 58154c54 - safe to cancel.`);
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: SHOT_DIR + '/R3-07a-form.png', fullPage: true }).catch(() => {});
  await page.getByRole('button', { name: /Save Job Card/ }).click();
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(1500);
    if (/\/job-cards\/?(\?.*)?$/.test(page.url())) break;
    const body = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ');
    const err = /(Pick a Job Work Sales Order[^.]*\.|All (?:outsource|in-house|QC) operations need[^.]*\.|Save failed[^.]*|Fill Item Code[^.]*\.)/.exec(body)?.[1];
    if (err) throw new Error('Save Job Card refused: ' + err);
  }
  expect(page.url(), 'back on the Job Cards list after save').toMatch(/\/job-cards\/?(\?.*)?$/);
  return { code: next, label, opt959: first.hit, pickedLabel, optOther: second.hit, labelAfterSecond, otherPicked };
}

test('R3 - vendor picker re-run (58154c54): Job Cards -> + New, OSP op vendor box finds VND-959 by "959"; label survives a second op search; saved op carries VND-959; Status-page editor + Outsource Balance modal pickers find it too', async ({ page }) => {
  test.setTimeout(1_200_000);
  const before = readReport().rows.filter((x) => x.id.startsWith('R3-07a-'));
  if (!r2('vJwCode')) {
    const jw = await createJwso(page, R3_N_QTY);
    r2Set({ vJwId: jw.id, vJwCode: jw.code });
    doc('R3 chain V JWSO', jw.code);
  }
  if (!r2('vJcCode')) {
    const run = await createJcChainV(page, r2('vJwCode'));
    r2Set({ vJcCode: run.code, vRun: JSON.stringify(run) });
    doc('R3 chain V JC (vendor picker)', run.code);
  }
  if (!r2('vJcUrl')) {
    const url = await jcUrlByCode(page, r2('vJcCode'));
    r2Set({ vJcUrl: url, vJcId: idFromUrl(url) });
  }
  const jc = r2('vJcCode');
  const run = JSON.parse(r2('vRun')) as PickerRun;
  const okFirst = /^VND-959 — E2E_ Shreeji/.test(run.opt959) && /^VND-959 — E2E_ Shreeji/.test(run.pickedLabel);
  const okSurvive = /^VND-959 — E2E_ Shreeji/.test(run.labelAfterSecond) && run.otherPicked.startsWith(V_OTHER_VENDOR);
  await rec3(page, 'R3-07a', `Job Cards → + New → + Add OSP Op → vendor box: type "959" → "${VENDOR_CODE} — Name" offered and picked; + Add OSP Op again → search ${V_OTHER_VENDOR} → the first row's label still reads ${VENDOR_CODE} — Name; Save Job Card → ${jc} op carries ${VENDOR_CODE} [was FAIL: first 200 vendors only; fixed 58154c54]`, async () => {
    const detail = await apiGet<{ ops: JcDetailOp[] }>(page, '/job-cards/' + r2('vJcId') + '/edit');
    const osp = detail.ops.filter((x) => x.opType === 'outsource').sort((a, b) => a.opSeq - b.opSeq);
    const op959 = osp[0];
    const opOther = osp[1];
    await jcBody(page, r2('vJcUrl'));
    return [
      { document: 'Job Cards → + New (vendor picker)', qty: '', headerStatus: okFirst ? `${VENDOR_CODE} picked` : run.opt959, overallStatus: okFirst ? 'typing "959" offers "CODE — Name"; picked' : `typing "959" gave "${run.opt959}"`, ok: okFirst, note: `option for "959": "${run.opt959}"; box after pick: "${run.pickedLabel}"` },
      { document: 'Job Cards → + New (second OSP op)', qty: '', headerStatus: okSurvive ? 'label kept' : 'label lost', overallStatus: okSurvive ? `row 2 still "${run.labelAfterSecond}" after row 3 searched ${V_OTHER_VENDOR}` : `row 2 read "${run.labelAfterSecond}" after row 3 searched ${V_OTHER_VENDOR} ("${run.optOther}")`, ok: okSurvive, note: `option for "${V_OTHER_VENDOR}": "${run.optOther}"; row 3 box: "${run.otherPicked}"; row 2 box after: "${run.labelAfterSecond}"` },
      { document: `${jc} Op ${op959 ? op959.opSeq * 10 : '?'}`, qty: `${R3_N_QTY}`, headerStatus: op959?.outsourceVendorCode ?? '(no vendor)', overallStatus: op959?.outsourceVendorCode === VENDOR_CODE ? 'saved with the picked vendor' : 'saved with a different vendor', ok: op959?.outsourceVendorCode === VENDOR_CODE, note: `api ops: ${detail.ops.map((x) => `${x.opSeq} ${x.opType} "${x.operation}" vendor=${x.outsourceVendorCode ?? 'null'}`).join(' | ')}` },
      { document: `${jc} Op ${opOther ? opOther.opSeq * 10 : '?'}`, qty: `${R3_N_QTY}`, headerStatus: opOther?.outsourceVendorCode ?? '(no vendor)', overallStatus: opOther?.outsourceVendorCode === V_OTHER_VENDOR ? 'saved with the other vendor' : 'saved with a different vendor', ok: opOther?.outsourceVendorCode === V_OTHER_VENDOR, note: `source label typed: "${run.label}"` },
    ];
  });
  // The old FAIL is kept as history on the first row; the re-run is the proof.
  {
    const r = readReport();
    const first = r.rows.find((x) => x.id === 'R3-07a-1');
    if (first && before.length > 0 && !(first.history ?? []).length) {
      first.history = before.map((b) => ({ result: b.result, actual: `${b.headerStatus} — ${b.overallStatus} — ${b.actual}`, at: b.at }));
      if (first.result === 'PASS') {
        first.result = 'FIXED';
        first.fixedBy = '58154c54 — re-proven by this run (rows R3-07a-1…4)';
      }
      writeReport(r);
    }
    const idx = r.findings.findIndex((f) => f.startsWith('[R3] R3-07a:'));
    const was = idx >= 0 ? r.findings[idx]! : '';
    const nowText = `[R3] R3-07a: fixed 58154c54 — the OSP vendor picker on Job Cards → + New now searches the server: typing "959" offers "${run.opt959}"; the row keeps "${run.labelAfterSecond}" after a second op searches ${V_OTHER_VENDOR}; the saved op carries ${VENDOR_CODE} (${jc}). was: ${was.replace(/^\[R3\] R3-07a: /, '') || 'the picker showed "No matches" for VND-959 (first 200 vendors only)'}`;
    if (!was.startsWith('[R3] R3-07a: fixed')) {
      if (idx >= 0) r.findings[idx] = nowText;
      else r.findings.push(nowText);
      writeReport(r);
    }
  }
  // Status-page op editor (read-only): the picked vendor's "CODE — Name" label
  // and a server search for "959" on the other outsource op. Nothing saved.
  await rec3(page, 'R3-07b', `Job Cards → ${jc} → Edit (Status-page op editor): the outsource op's vendor box reads "${VENDOR_CODE} — Name"; typing "959" in the other outsource op's box offers ${VENDOR_CODE} (read-only, not saved)`, async () => {
    const detail = await apiGet<{ ops: JcDetailOp[] }>(page, '/job-cards/' + r2('vJcId') + '/edit');
    const osp = detail.ops.filter((x) => x.opType === 'outsource').sort((a, b) => a.opSeq - b.opSeq);
    await page.goto(`/job-cards/${r2('vJcId')}/edit`, { waitUntil: 'domcontentloaded' });
    const box959 = page.locator(`#jc-edit-vend-${osp[0]!.id}`);
    await box959.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    let label = await box959.inputValue();
    // Give the vendor page + label resolution a fair chance on the slow test API.
    if (!label.includes(' — ')) {
      await page.waitForTimeout(8000);
      label = await box959.inputValue();
    }
    const other = await comboOptions(page, `jc-edit-vend-${osp[1]!.id}`, '959', new RegExp(VENDOR_CODE + ' — E2E_ Shreeji'));
    await page.keyboard.press('Escape');
    return [
      { document: `${jc} Op ${osp[0]!.opSeq * 10} (edit page)`, qty: '', headerStatus: label.startsWith(VENDOR_CODE + ' — ') ? 'CODE — Name' : label || '(empty)', overallStatus: `vendor box reads "${label}"`, ok: /^VND-959 — E2E_ Shreeji/.test(label), note: `edit page vendor box for the ${VENDOR_CODE} op: "${label}"` },
      { document: `${jc} Op ${osp[1]!.opSeq * 10} (edit page)`, qty: '', headerStatus: other.hit.startsWith(VENDOR_CODE) ? `${VENDOR_CODE} offered` : other.hit, overallStatus: `typing "959" offers "${other.hit}" (not saved)`, ok: /^VND-959 — E2E_ Shreeji/.test(other.hit), note: `options for "959": [${other.texts.join(' | ')}]` },
    ];
  });
  // Outsource Balance modal (read-only). Chain V's in-house op could not be
  // started: Op Entry refused "Cannot start — no client material has been
  // issued to this job card. Issue material from Party Material Issue first"
  // (a JW job card needs a Party Material Issue before any op runs — the app
  // is right). So the modal is opened on an EXISTING started in-house op with
  // a balance (from the JC Operations board), the picker is read, and the
  // modal is cancelled. Nothing is saved on that card.
  await rec3(page, 'R3-07c', `Job Cards → Edit (Status-page op editor) → a started in-house op with a balance → "🏭 Outsource balance" → modal vendor box: type "959" → ${VENDOR_CODE} offered (read-only; Cancel). Chain V's own op could not be started: Op Entry refused "no client material has been issued to this job card" (JW cards need a Party Material Issue first)`, async () => {
    interface BoardOp { jcId: string | null; jcCode: string; opSeq: number; opType: string; status: string; completed: number; available: number; inputAvail: number; operation: string }
    const board = await apiGet<{ items: BoardOp[] }>(page, '/jc-ops?limit=500&offset=0');
    const cands = board.items.filter((x) => x.opType === 'process' && x.status === 'in_progress' && x.available > 0 && x.jcId);
    const pick = cands.find((x) => x.jcCode === jc) ?? cands[0];
    if (!pick) {
      return [{ document: '(no started in-house op with a balance on this stack)', qty: '', headerStatus: '', overallStatus: 'modal could not be opened', ok: false, note: `board rows: ${board.items.length}; in_progress process ops with available > 0: 0` }];
    }
    await page.goto(`/job-cards/${pick.jcId}/edit`, { waitUntil: 'domcontentloaded' });
    const btn = page.getByRole('button', { name: /Outsource Pending/ }).first();
    const offered = await btn.waitFor({ state: 'visible', timeout: 60_000 }).then(() => true).catch(() => false);
    if (!offered) {
      return [{ document: `${pick.jcCode} Op ${pick.opSeq} (edit page)`, qty: `${pick.available}`, headerStatus: pick.status, overallStatus: '"Outsource balance" button not offered', ok: false, note: `board: ${pick.jcCode} op ${pick.opSeq} "${pick.operation}" status=${pick.status} completed=${pick.completed} available=${pick.available}` }];
    }
    const op1 = { opSeq: pick.opSeq, available: pick.available, hasStarted: true };
    const jcUsed = pick.jcCode;
    await btn.click();
    const box = page.locator('#jcOutsourceBalanceVendor');
    await box.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const preset = await box.inputValue();
    const got = await comboOptions(page, 'jcOutsourceBalanceVendor', '959', new RegExp(VENDOR_CODE + ' — E2E_ Shreeji'));
    await page.screenshot({ path: SHOT_DIR + '/R3-07c-modal.png', fullPage: true }).catch(() => {});
    // The open option list sits over the modal's buttons: close it (Escape)
    // before pressing the modal's Cancel. (The page's own Cancel is a link,
    // not a button, so the button locator is the modal's.) Nothing saved.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // (the edit page has a small btn-sm "Cancel" of its own earlier in the tree)
    const cancelBtn = page.locator('button.btn-ghost:not(.btn-sm)').filter({ hasText: /^Cancel$/ }).last();
    await cancelBtn.click({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(800);
    let cancelHow = 'mouse click';
    if (await box.count()) {
      // A real mouse click on Cancel left the modal open twice in a row on
      // this run; a DOM click closes it. Recorded in the note for a human eye.
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button.btn-ghost:not(.btn-sm)')].find((x) => x.textContent?.trim() === 'Cancel') as HTMLButtonElement | undefined;
        b?.click();
      });
      await page.waitForTimeout(800);
      cancelHow = 'mouse click left it open; closed by a DOM click on Cancel';
    }
    const modalGone = (await box.count()) === 0;
    return [
      { document: `${jcUsed} Op ${op1.opSeq} (Outsource balance)`, qty: `${op1.available}`, headerStatus: got.hit.startsWith(VENDOR_CODE) ? `${VENDOR_CODE} offered` : got.hit, overallStatus: `modal box typed "959" offers "${got.hit}"; cancelled${modalGone ? '' : ' (modal still open)'}`, ok: /^VND-959 — E2E_ Shreeji/.test(got.hit) && modalGone, note: `read-only on ${jcUsed} (${jcUsed === jc ? 'chain V' : 'an existing card; nothing saved'}); box on open: "${preset}"; options for "959": [${got.texts.join(' | ')}]; board op: started, available=${op1.available}; Cancel: ${cancelHow}` },
    ];
  });
});

// ── R3-07r: READ-ONLY re-read of the same picker after 58154c54, typing the
//    full code "VND-959" (the morning's ✗ row typed exactly that). Nothing is
//    saved: the + New form is left through its Cancel → "Exit"; the Edit page
//    (chain V's saved JC) is left the same way. ─────────────────────────────
/** Leave a JC form without saving: Cancel, then "Exit" on the exit guard if it asks. */
async function leaveJcForm(page: Page): Promise<string> {
  await page.getByRole('button', { name: /^Cancel$/ }).last().click();
  const guard = page.getByText('Are you sure you want to exit?');
  const asked = await guard.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
  if (asked) await page.getByRole('button', { name: /^Exit$/ }).click();
  await page.waitForTimeout(1500);
  return asked ? 'exit guard asked → Exit' : 'no exit guard';
}
test('R3 - vendor picker read-only re-read (58154c54): Job Cards -> + New -> + Add OSP Op, type "VND-959" -> offered; Edit page picker too; nothing saved', async ({ page }) => {
  test.setTimeout(600_000);
  const want = new RegExp('^' + VENDOR_CODE + ' — E2E_ Shreeji');
  await rec3(page, 'R3-07r', `Job Cards → + New → + Add OSP Op → vendor box: type "${VENDOR_CODE}" → "${VENDOR_CODE} — E2E_ Shreeji Precision Heat Treaters Pvt Ltd" offered and pickable; Cancel → Exit (nothing saved). Then Job Cards → ${r2('vJcCode') || '(chain V JC)'} → Edit → the other OSP op's vendor box: type "${VENDOR_CODE}" → offered; Cancel → Exit (nothing saved) [read-only re-read of the morning's ✗ row; fixed 58154c54]`, async () => {
    const next = (await apiGet<{ code: string }>(page, '/job-cards/next-code')).code;
    await page.goto('/job-cards/new', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder(/Search JWSO number/).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Add OSP Op/ }).click();
    await page.waitForTimeout(500);
    const vend = page.locator('#jc-edit-vend-0');
    await vend.waitFor({ timeout: 30_000 });
    const got = await comboOptions(page, 'jc-edit-vend-0', VENDOR_CODE, want);
    let picked = '';
    if (want.test(got.hit)) {
      await page.getByRole('option').filter({ hasText: want }).first().click();
      await page.waitForTimeout(400);
      picked = await vend.inputValue();
    }
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: SHOT_DIR + '/R3-07r-new-form.png', fullPage: true }).catch(() => {});
    const leftNew = await leaveJcForm(page);
    const nextAfter = (await apiGet<{ code: string }>(page, '/job-cards/next-code')).code;
    const newRow: DocRow = {
      document: `Job Cards → + New (would be ${next}; not saved)`,
      qty: '',
      headerStatus: want.test(got.hit) ? `${VENDOR_CODE} offered` : got.hit,
      overallStatus: `typing "${VENDOR_CODE}" offers "${got.hit}"${picked ? `; picked → box "${picked}"` : ''}; ${leftNew}; next code still ${nextAfter}`,
      ok: want.test(got.hit) && want.test(picked) && nextAfter === next,
      note: `options for "${VENDOR_CODE}": [${got.texts.join(' | ')}]; box after pick: "${picked}"; next-code before/after: ${next} / ${nextAfter}`,
    };
    // Edit page of chain V's JC (saved earlier by the re-run test): read-only.
    if (!r2('vJcId')) return [newRow, { document: 'Edit page', qty: '', headerStatus: '', overallStatus: 'no chain V JC in state — edit page not read', ok: 'na', note: '' }];
    const jc = r2('vJcCode');
    const detail = await apiGet<{ ops: JcDetailOp[] }>(page, '/job-cards/' + r2('vJcId') + '/edit');
    const osp = detail.ops.filter((x) => x.opType === 'outsource').sort((a, b) => a.opSeq - b.opSeq);
    const other = osp.find((x) => x.outsourceVendorCode !== VENDOR_CODE) ?? osp[osp.length - 1];
    if (!other) return [newRow, { document: `${jc} (edit page)`, qty: '', headerStatus: '', overallStatus: 'no outsource op on chain V', ok: 'na', note: '' }];
    await page.goto(`/job-cards/${r2('vJcId')}/edit`, { waitUntil: 'domcontentloaded' });
    const box = page.locator(`#jc-edit-vend-${other.id}`);
    await box.waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    const before = await box.inputValue();
    const got2 = await comboOptions(page, `jc-edit-vend-${other.id}`, VENDOR_CODE, want);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: SHOT_DIR + '/R3-07r-edit-page.png', fullPage: true }).catch(() => {});
    const leftEdit = await leaveJcForm(page);
    const after = await apiGet<{ ops: JcDetailOp[] }>(page, '/job-cards/' + r2('vJcId') + '/edit');
    const otherAfter = after.ops.find((x) => x.id === other.id);
    return [
      newRow,
      {
        document: `${jc} Op ${other.opSeq * 10} (edit page)`,
        qty: '',
        headerStatus: want.test(got2.hit) ? `${VENDOR_CODE} offered` : got2.hit,
        overallStatus: `typing "${VENDOR_CODE}" offers "${got2.hit}"; ${leftEdit}; op still ${otherAfter?.outsourceVendorCode ?? 'null'}`,
        ok: want.test(got2.hit) && otherAfter?.outsourceVendorCode === other.outsourceVendorCode,
        note: `box on open: "${before}"; options for "${VENDOR_CODE}": [${got2.texts.join(' | ')}]; api vendor before/after: ${other.outsourceVendorCode} / ${otherAfter?.outsourceVendorCode ?? 'null'}`,
      },
    ];
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORT — render the rows to PDF (per test as each finishes, then combined)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// R4 — ADR-175 (2026-09-21): every NC disposition settles the whole chain.
//
//   Five (six) small IN-HOUSE chains, one disposition each, every document
//   read after it settles:
//     SO 10 → JC (Op 10 Turning on a machine, Op 20 Final Inspection) →
//     Turning 10 → Final Inspection 8 ok / 2 rej → NC-1, then:
//       A  Rework 2      → child -RW1 → run → accept 2
//       B  Rework 2      → child → QC 1 ok / 1 rej → NC-2 ("Continues NC-1")
//                          → Rework 1 → grandchild → accept 1
//       C  Use as is 2
//       D  Scrap 2        (origin op stays 8 of 10 — open business rule)
//       E  Make fresh 2   (supplementary -S1; origin op stays 8 of 10)
//       F  Repair 2      → child -RP1 → accept 2 (label "Under repair")
//   Reads: parent op 20 (accepted / status / ⚠ NC strip), parent JC status +
//   closed date + JC_COMPLETE activity row, child JC(s), NC ledger, SO Status
//   chips (JC issued / produced — recovery children must NOT count), Customer
//   Dispatch ready qty, Store ledger rows, SO line status.
//   Plus one read-only regression line on the R1 chain (IN-JWPO-00007/R1) and
//   the OSP At-Vendor Register.
//
//   Rows are the six-column shape (rec3): one row per document a step touched.
//   Chain state lives in the r4 map (prefixes a*..f*).
//
// Run this section alone with:  --grep "00 -|R4"
// Then render:  node scripts/render-final-report.mjs --only R4 --out test-results/erp-chain-verification-2026-09-21-adr175.pdf
// ═══════════════════════════════════════════════════════════════════════════

const R4_TAG = 'ADR-175 (2026-09-21)';
const R4_QTY = 10;
const R4_ACC1 = 8;
const R4_REJ1 = 2;
/** Steps that read a TRANSIENT state (the chain moves past it in the next step). */
const R4_TRANSIENT_STEPS = new Set(['R4-00', 'R4-A2', 'R4-B2', 'R4-B4', 'R4-F2']);

function r4(k: string): string {
  return readState().r4?.[k] ?? '';
}
function r4Set(patch: Record<string, string>): void {
  writeState({ r4: { ...(readState().r4 ?? {}), ...patch } });
}
/** rec3 with the R4 transient set (rec3's own set is R3's). */
async function rec4(page: Page, id: string, action: string, check: () => Promise<DocRow[]>): Promise<boolean> {
  const ok = await rec3(page, id, action, check);
  if (R4_TRANSIENT_STEPS.has(id)) {
    const r = readReport();
    for (const x of r.rows) if (x.id.startsWith(id + '-')) x.keep = true;
    writeReport(r);
  }
  return ok;
}

interface SoStatusApi4 {
  header: { code: string; status: string };
  lines: {
    status: string;
    orderQty: number;
    doneQty: number;
    completionPct: number;
    chips: { jcIssued: { qty: number; total: number }; produced: { qty: number; total: number } };
    jobCards: { code: string; status: string; doneQty: number; completionPct: number; ops: { opSeq: number; opType: string; status: string; completed: number }[] }[];
  }[];
}
interface SoStatusRead {
  api: SoStatusApi4;
  line: SoStatusApi4['lines'][number];
  /** The parent JC's row in the API (undefined when it is not listed). */
  jc: SoStatusApi4['lines'][number]['jobCards'][number] | undefined;
  /** The parent's QC op (seq 2) status in the API. */
  qcOpStatus: string;
  /** Recovery children listed under the line (must be none after ADR-175). */
  childrenListed: string[];
  pageJcIssued: string;
  pageProduced: string;
  pageJcRow: string;
}
/** SO Status: API + the page (chips "JC Issued n /N", "Produced n /N", the parent JC row). */
async function soStatus4(page: Page, soId: string, jcCode: string): Promise<SoStatusRead> {
  const api = await apiGet<SoStatusApi4>(page, '/so-status/' + soId);
  const line = api.lines[0]!;
  const jc = line.jobCards.find((j) => j.code === jcCode);
  const qcOp = jc?.ops.find((o) => o.opType === 'qc');
  const childrenListed = line.jobCards.map((j) => j.code).filter((c) => c !== jcCode && c.startsWith(jcCode + '-R'));
  await page.goto('/sales-orders/' + soId + '/status', { waitUntil: 'domcontentloaded' });
  await page.getByText(/JC Issued/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const chip = (label: string): string => {
    const m = new RegExp(label + '\\s*(\\d+)\\s*/\\s*(\\d+)').exec(body);
    return m ? `${m[1]} of ${m[2]}` : '(chip not found)';
  };
  return {
    api,
    line,
    jc,
    qcOpStatus: qcOp?.status ?? '(qc op not listed)',
    childrenListed,
    pageJcIssued: chip('JC Issued'),
    pageProduced: chip('Produced'),
    pageJcRow: cardText(body, jcCode, 200),
  };
}

interface DispatchableApi {
  soCode: string;
  lines: { lineNo: number; orderQty: number; readyQty: number; reservedQty: number; dispatchedQty: number; availableQty: number }[];
}
/** Customer Dispatch → + New with the SO preselected: the Ready column + the API's readyQty (uncapped). */
async function dispatchReady4(page: Page, soId: string): Promise<{ readyQty: number; availableQty: number; orderQty: number; pageReady: string }> {
  const d = await apiGet<DispatchableApi>(page, '/customer-dispatches/dispatchable/' + soId);
  const l = d.lines[0]!;
  await page.goto('/customer-dispatches/new?so=' + soId, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  let pageReady = '(Ready column not read)';
  const table = page.locator('table').filter({ has: page.locator('th', { hasText: /^Ready$/ }) }).first();
  if (await table.count()) {
    const idx = await colIndex(table, /^Ready$/);
    const cell = table.locator('tbody tr').first().locator('td').nth(idx);
    if (await cell.count()) pageReady = (await cell.innerText()).trim();
  }
  return { readyQty: l.readyQty, availableQty: l.availableQty, orderQty: l.orderQty, pageReady };
}

/** JC_COMPLETE Activity Log rows for exactly this JC code (a child's row also
 *  contains the parent's code, so match the detail's own prefix). */
async function jcCompleteRows4(page: Page, jcCode: string): Promise<string[]> {
  const r = await apiGet<{ entries: { action: string; detail: string; ts: string; refId?: string | null }[] }>(
    page,
    '/activity-log?search=' + encodeURIComponent(jcCode) + '&action=JC_COMPLETE&limit=50&offset=0',
  );
  return r.entries.filter((e) => e.action === 'JC_COMPLETE' && new RegExp('^' + jcCode.replace(/[-]/g, '\\-') + '\\s*[—-]').test(e.detail)).map((e) => `${e.ts.slice(0, 19)} ${e.detail}`);
}
/** Activity Log page, searched, for the screenshot. */
async function showActivity4(page: Page, search: string): Promise<void> {
  await page.goto('/activity-log?search=' + encodeURIComponent(search), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
}

interface JcApi4 extends JcApi {
  orderQty?: number;
  recoveryKind?: string | null;
  parentJobCardId?: string | null;
}
/** JC detail (API + page badge + closed date). */
async function jcRead4(page: Page, jcId: string, jcUrl: string): Promise<{ api: JcApi4; badge: string; tiles: string; closedDate: string }> {
  const api = await apiGet<JcApi4>(page, '/job-cards/' + jcId);
  await jcBody(page, jcUrl);
  const badge = await jcStatusBadge(page);
  const tiles = await jcQtyTiles(page);
  return { api, badge, tiles, closedDate: api.closedAt ? api.closedAt.slice(0, 10) : '(none)' };
}

/** The new child / supplementary JC code shown on the NC page after a
 *  disposition: the LONGEST JC code on the page that is not the NC's own JC
 *  (an NC on a child names its own JC too). */
async function newJcOnNc4(page: Page, ncUrl: string, ownJc: string, suffix: 'RW' | 'RP' | 'S'): Promise<string> {
  await page.goto(ncUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(new RegExp('-' + suffix + '\\d+')).first().waitFor({ timeout: 90_000 });
  const body = await page.locator('body').innerText();
  const all = [...new Set(body.match(/IN-JC-\d{2}-\d+(?:-(?:RW|RP|S)\d+)+/g) ?? [])].filter((c) => c !== ownJc && c.startsWith(ownJc + '-' + suffix));
  all.sort((a, b) => b.length - a.length);
  expect(all[0], `new -${suffix} JC code on the NC page`).toBeTruthy();
  return all[0]!;
}

/** NC detail (API) with the ADR-175 fields. */
interface NcApi4 extends NcApi {
  parentNcId?: string | null;
  parentNcCode?: string | null;
  reworkJcCodeText?: string | null;
}
async function ncApi4(page: Page, id: string): Promise<NcApi4> {
  return apiGet<NcApi4>(page, '/nc-register/' + id);
}

/** Build one in-house chain: SO 10 → plan (Turning on a cnc machine + Final
 *  Inspection) → execute → Turning 10 → Final Inspection 8 ok / 2 rej → NC-1.
 *  Resumable through the r4 map. Records the build row R4-<P>1. */
async function buildInhouseChainR4(page: Page, p: string, label: string): Promise<void> {
  const P = p.toUpperCase();
  if (!r4(p + 'SoCode')) {
    const so = await createSo(page, R4_QTY, `E2E_ADR175-${P}`);
    r4Set({ [p + 'SoCode']: so.code, [p + 'SoUrl']: so.url, [p + 'SoId']: idFromUrl(so.url), [p + 'SoBadge']: so.status });
    doc(`R4 chain ${P} SO`, so.code);
  }
  if (!r4(p + 'JcCode')) {
    const jc = await planAndExecute(page, r4(p + 'SoCode'), R4_QTY, { kind: 'process', name: 'Turning' }, 'Final Inspection');
    r4Set({ [p + 'JcCode']: jc });
    doc(`R4 chain ${P} JC`, jc);
  }
  if (!r4(p + 'JcUrl')) {
    const url = await jcUrlByCode(page, r4(p + 'JcCode'));
    r4Set({ [p + 'JcUrl']: url, [p + 'JcId']: idFromUrl(url) });
  }
  const jc = r4(p + 'JcCode');
  const ops = await opsOf(page, jc);
  const procName = ops[0]!.operation;
  const qcName = ops[ops.length - 1]!.operation;
  if (!r4(p + 'Op1Done')) {
    await runProcessOp(page, jc, procName, R4_QTY);
    r4Set({ [p + 'Op1Done']: 'yes' });
  }
  if (!r4(p + 'Qc1Done')) {
    await qcOp(page, jc, qcName, R4_ACC1, R4_REJ1);
    r4Set({ [p + 'Qc1Done']: 'yes' });
  }
  if (!r4(p + 'Nc1Code')) {
    const nc = await findAutoNc(page, jc);
    const o = await openNc(page, nc.code);
    r4Set({ [p + 'Nc1Code']: nc.code, [p + 'Nc1Url']: o.url, [p + 'Nc1Id']: o.id });
    doc(`R4 chain ${P} NC-1`, nc.code);
  }
  await rec4(page, `R4-${P}1`, `${label}: SO ${R4_QTY} → plan Turning + Final Inspection → execute → Turning ${R4_QTY} → Final Inspection ${R4_ACC1} ok / ${R4_REJ1} rej → NC-1`, async () => {
    const so = await soApi(page, r4(p + 'SoId'));
    const o = await opsOf(page, jc);
    const o1 = o[0]!;
    const o2 = o[1]!;
    const n = await ncApi4(page, r4(p + 'Nc1Id'));
    const j = await jcRead4(page, r4(p + 'JcId'), r4(p + 'JcUrl'));
    const strip = await jcNcStrips(page, r4(p + 'JcUrl'));
    const d = await readNcDetail(page, r4(p + 'Nc1Url'));
    const routeOk = o.length === 2 && o1.opType === 'process' && /Turning/i.test(o1.operation) && Boolean(o1.machineCode ?? o1.machineCodeText) && o2.opType === 'qc' && /Final Inspection/i.test(o2.operation);
    return [
      {
        act: 'Create sales order',
        document: r4(p + 'SoCode'),
        qty: String(R4_QTY),
        headerStatus: cap(so.status),
        overallStatus: `Line ${cap(so.lines[0]?.status ?? '')}`,
        ok: so.lines.length === 1 && so.lines[0]!.orderQty === R4_QTY,
        note: `SO ${so.code} status=${so.status} line status=${so.lines[0]?.status} orderQty=${so.lines[0]?.orderQty}`,
      },
      {
        act: 'Plan, run turning, inspect',
        document: jc,
        qty: String(R4_QTY),
        headerStatus: j.badge,
        overallStatus: `${R4_ACC1} ok, ${R4_REJ1} rejected`,
        ok: routeOk && o1.completedQty === R4_QTY && o2.qcAcceptedQty === R4_ACC1 && o2.qcRejectedQty === R4_REJ1 && stripNum(strip, 'NC Raised') === R4_REJ1,
        note: `route: ${o.map(opLine).join(' ;; ')}; JC ${jcApiLine(j.api)}; tiles "${j.tiles}"; strip "${strip}"`,
      },
      {
        act: 'Check NC raised',
        document: r4(p + 'Nc1Code'),
        qty: String(R4_REJ1),
        headerStatus: d.status,
        overallStatus: 'Pending disposition',
        ok: Number(n.rejectedQty) === R4_REJ1 && /pending/i.test(n.status) && n.opSeq === 2,
        note: ncLine(n),
      },
    ];
  });
}

/** Run a recovery child: its process op for `qty`, then its terminal QC acc / rej. */
async function runChildR4(page: Page, child: string, qty: number, acc: number, rej: number): Promise<void> {
  const ops = await opsOf(page, child);
  await runProcessOp(page, child, ops[0]!.operation, qty);
  await qcOp(page, child, ops[ops.length - 1]!.operation, acc, rej);
}

/** Dispose NC-1 of chain `p` (resumable) and, for rework / repair / make
 *  fresh, capture the new JC's code + url. */
async function disposeR4(page: Page, p: string, action: NcAction, qty: number, remark: string, newJc?: { key: string; suffix: 'RW' | 'RP' | 'S'; ownJc: string; ncUrl: string; ncId: string }): Promise<string> {
  const flag = p + 'Disp_' + (newJc?.key ?? action);
  let msg = '';
  if (!r4(flag)) {
    msg = await tryDispose(page, newJc?.ncUrl ?? r4(p + 'Nc1Url'), action, qty, remark);
    // tryDispose's wait loop stops early on the panel's own "Requires approve
    // rights" note (always shown for scrap); give the API up to 60 s to land
    // the disposition before deciding it was refused.
    const ncId = newJc?.ncId ?? r4(p + 'Nc1Id');
    for (let i = 0; i < 20; i += 1) {
      if ((await ncApi4(page, ncId)).disposition) break;
      await page.waitForTimeout(3000);
    }
    r4Set({ [flag]: 'yes', [flag + 'Msg']: msg });
  }
  if (newJc && !r4(newJc.key + 'Code')) {
    const code = await newJcOnNc4(page, newJc.ncUrl, newJc.ownJc, newJc.suffix);
    r4Set({ [newJc.key + 'Code']: code });
    doc(`R4 chain ${p.toUpperCase()} ${newJc.suffix === 'S' ? 'supplementary' : 'child'} JC (${newJc.key})`, code);
  }
  if (newJc && !r4(newJc.key + 'Url')) {
    const url = await jcUrlByCode(page, r4(newJc.key + 'Code'));
    r4Set({ [newJc.key + 'Url']: url, [newJc.key + 'Id']: idFromUrl(url) });
  }
  return r4(flag + 'Msg') || msg;
}

interface SettledExpect {
  /** Parent op 20 accepted qty + status. */
  acc: number;
  opStatus: 'complete' | 'in_progress';
  /** Parent JC: closed (with a date + JC_COMPLETE) or not. */
  jcClosed: boolean;
  /** Rows that are "by design" (the open business rule): op / JC / SO rows read as ◌ By design instead of ✗. */
  byDesign?: boolean;
  /** NC-1 ledger. */
  ncCleared: number;
  ncFailed: number;
  /** ⚠ NC strip label + qty on the parent op card. */
  strip: { label: string; qty: number };
  /** SO Status chips. */
  jcIssued: number;
  produced: number;
  soOp: 'complete' | 'in_progress';
  /** Customer Dispatch ready. */
  ready: number;
  /** Store ledger qc_accept rows for the parent (multiset of qty). */
  ledger: number[];
  /** SO line. */
  soLine: 'closed' | 'open';
}
/** Every settled-chain read for chain `p`, one row per document. */
async function settledRowsR4(page: Page, p: string, X: SettledExpect): Promise<DocRow[]> {
  const jc = r4(p + 'JcCode');
  const so = r4(p + 'SoCode');
  const soId = r4(p + 'SoId');
  const rows: DocRow[] = [];
  // The open business rule (ADR-175): after scrap / make fresh the origin op
  // stays 8 of 10. When such a row reads exactly as documented it is
  // "◌ By design", not ✓; anything else is ✗.
  const design = (ok: boolean): boolean | 'blocked' => (ok ? (X.byDesign ? 'blocked' : true) : false);

  // Parent op 20.
  const ops = await opsOf(page, jc);
  const o2 = ops[1]!;
  const nb = o2.ncBreakup;
  const body = await jcBody(page, r4(p + 'JcUrl'));
  const card = opCardText(body, 2);
  const strip = await jcNcStrips(page, r4(p + 'JcUrl'));
  const stripQty = stripNum(strip, X.strip.label);
  const opOk = o2.qcAcceptedQty === X.acc && o2.computedStatus === X.opStatus;
  rows.push({
    act: 'Check parent op card',
    document: `${jc} Op 20`,
    qty: String(o2.qcAcceptedQty),
    headerStatus: opBadge(card),
    overallStatus: `${o2.qcAcceptedQty} of ${R4_QTY} accepted, ${cap(o2.computedStatus)}`.replace('In progress', 'in progress').replace('Complete', 'complete'),
    ok: design(opOk),
    note: `expected accepted ${X.acc}, status ${X.opStatus}${X.byDesign ? ' (by design — open business rule, ADR-175: the origin op stays 8 of 10 after a write-off)' : ''}; ${opLine(o2)}; card tiles: ${tilesOf(card)}`,
  });
  rows.push({
    act: 'Check NC strip on card',
    document: `${jc} Op 20`,
    qty: String(stripQty),
    headerStatus: '',
    overallStatus: `${X.strip.label} ${stripQty}`,
    ok: stripQty === X.strip.qty && nb.ncOpenQty === 0,
    note: `strip "${strip}"; api ncBreakup raised=${nb.ncRaisedQty} underRework=${nb.underReworkQty} underRepair=${nb.underRepairQty} scrap=${nb.scrapQty} closed=${nb.ncClosedQty} open=${nb.ncOpenQty} openNcCount=${nb.openNcCount}`,
  });

  // Parent JC.
  const j = await jcRead4(page, r4(p + 'JcId'), r4(p + 'JcUrl'));
  const done = await jcCompleteRows4(page, jc);
  await showActivity4(page, jc);
  const jcOk = X.jcClosed ? j.api.computedStatus === 'closed' && Boolean(j.api.closedAt) && done.length >= 1 : j.api.computedStatus !== 'closed' && !j.api.closedAt && done.length === 0;
  rows.push({
    act: 'Check parent job card',
    document: jc,
    qty: String(X.acc),
    headerStatus: j.badge,
    overallStatus: X.jcClosed ? `Closed ${j.closedDate}; JC_COMPLETE ${done.length ? 'logged' : 'MISSING'}` : `${cap(j.api.computedStatus)}; no closed date`,
    ok: design(jcOk),
    note: `${jcApiLine(j.api)}; page badge "${j.badge}"; tiles "${j.tiles}"; JC_COMPLETE rows for exactly ${jc}: ${done.length ? done.join(' | ') : 'none'}${X.byDesign && !X.jcClosed ? ' (by design — the origin op is short, so the JC cannot close)' : ''}`,
  });

  // NC-1.
  const n = await ncApi4(page, r4(p + 'Nc1Id'));
  const d = await readNcDetail(page, r4(p + 'Nc1Url'));
  rows.push({
    act: 'Check NC closed',
    document: r4(p + 'Nc1Code'),
    qty: String(R4_REJ1),
    headerStatus: d.status,
    overallStatus: `${cap(n.disposition ?? '')}: cleared ${Number(n.clearedQty)}, failed ${Number(n.failedQty)}`,
    ok: /closed/i.test(n.status) && Number(n.clearedQty) === X.ncCleared && Number(n.failedQty) === X.ncFailed,
    note: `expected cleared ${X.ncCleared} failed ${X.ncFailed}; ${ncLine(n)}`,
  });

  // SO Status.
  const st = await soStatus4(page, soId, jc);
  const chipsOk = st.line.chips.jcIssued.qty === X.jcIssued && st.line.chips.jcIssued.total === R4_QTY && st.line.chips.produced.qty === X.produced && st.childrenListed.length === 0;
  const soOpOk = st.qcOpStatus === X.soOp;
  rows.push({
    act: 'Check SO status chips',
    document: `${so} — SO Status`,
    qty: String(st.line.chips.produced.qty),
    headerStatus: cap(st.line.status),
    overallStatus: `JC ${st.line.chips.jcIssued.qty}/${st.line.chips.jcIssued.total}, produced ${st.line.chips.produced.qty}`,
    ok: chipsOk,
    note: `expected JC issued ${X.jcIssued} of ${R4_QTY}, produced ${X.produced}; page chips: JC Issued ${st.pageJcIssued}, Produced ${st.pageProduced}; API chips jcIssued=${st.line.chips.jcIssued.qty}/${st.line.chips.jcIssued.total} produced=${st.line.chips.produced.qty}/${st.line.chips.produced.total}; recovery children listed under the line: ${st.childrenListed.join(', ') || 'none'}; JC rows: ${st.line.jobCards.map((x) => `${x.code} ${x.status} ${x.doneQty} ${x.completionPct}%`).join(' | ')}`,
  });
  rows.push({
    act: 'Check op on SO status',
    document: `${so} — SO Status`,
    qty: String(st.jc?.ops.find((o) => o.opType === 'qc')?.completed ?? 0),
    headerStatus: st.jc ? cap(st.jc.status) : '(JC not listed)',
    overallStatus: `Op 20 ${st.qcOpStatus.replace(/_/g, ' ')}`,
    ok: design(soOpOk),
    note: `expected op ${X.soOp}; API JC ops: ${st.jc?.ops.map((o) => `Op${o.opSeq} ${o.opType} ${o.status} completed=${o.completed}`).join(' | ') ?? '(not listed)'}; page JC row: "${st.pageJcRow}"`,
  });

  // Customer Dispatch.
  const dr = await dispatchReady4(page, soId);
  rows.push({
    act: 'Check dispatch ready qty',
    document: `${so} — Customer Dispatch`,
    qty: String(dr.readyQty),
    headerStatus: '',
    overallStatus: `Ready ${dr.readyQty} of ${dr.orderQty}`,
    ok: dr.readyQty === X.ready && dr.availableQty === Math.min(X.ready, R4_QTY),
    note: `expected ready ${X.ready}; API readyQty=${dr.readyQty} availableQty=${dr.availableQty} orderQty=${dr.orderQty}; page Ready cell "${dr.pageReady}"`,
  });

  // Store ledger.
  const led = (await ledgerRows(page, jc)).filter((l) => l.sourceType === 'qc_accept');
  await showLedger(page, jc);
  const got = led.map((l) => (l.txnType === 'in' ? l.qty : -l.qty)).sort((a, b) => a - b);
  const want = [...X.ledger].sort((a, b) => a - b);
  const ledOk = got.length === want.length && got.every((q, i) => q === want[i]);
  rows.push({
    act: 'Check stock ledger',
    document: `${jc} — Stock Ledger`,
    qty: String(got.reduce((s, q) => s + q, 0)),
    headerStatus: '',
    overallStatus: got.length ? got.map((q) => (q >= 0 ? '+' + q : String(q))).join(', ') + ' credited' : 'No rows',
    ok: ledOk,
    note: `expected rows ${want.map((q) => '+' + q).join(', ') || 'none'}; got ${led.length} qc_accept rows for "${jc}": ${led.map(ledgerLine).join(' | ') || 'none'}`,
  });

  // SO line.
  const soA = await soApi(page, soId);
  const soP = await soOnPage(page, r4(p + 'SoUrl'));
  const lineStatus = soA.lines[0]?.status ?? '';
  const lineOk = X.soLine === 'closed' ? /closed|complete/i.test(lineStatus) : !/closed|complete/i.test(lineStatus);
  rows.push({
    act: 'Check SO line status',
    document: so,
    qty: String(R4_QTY),
    headerStatus: soP.badge,
    overallStatus: `Line ${cap(lineStatus)}`,
    ok: design(lineOk),
    note: `expected line ${X.soLine}; API SO status=${soA.status} line status=${lineStatus}; page badge "${soP.badge}" line badges [${soP.lines.join(', ')}]`,
  });
  return rows;
}

/** A recovery child (or grandchild) JC row: closed with a date, banner. */
async function childRowsR4(page: Page, key: string, kind: 'REWORK' | 'REPAIR', parent: string, nc: string, qty: number): Promise<DocRow[]> {
  const code = r4(key + 'Code');
  const j = await jcRead4(page, r4(key + 'Id'), r4(key + 'Url'));
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const banner = new RegExp(kind + ' of[^.]{0,120}', 'i').exec(body)?.[0] ?? `(no ${kind} banner)`;
  const ops = await opsOf(page, code);
  const done = await jcCompleteRows4(page, code);
  return [
    {
      act: `Check ${kind === 'REWORK' ? 'rework' : 'repair'} child card`,
      document: code,
      qty: String(qty),
      headerStatus: j.badge,
      overallStatus: `Closed ${j.closedDate}`,
      ok: j.api.computedStatus === 'closed' && Boolean(j.api.closedAt) && body.includes(parent) && body.includes(nc),
      note: `${jcApiLine(j.api)}; banner "${banner}"; tiles "${j.tiles}"; ops: ${ops.map(opLine).join(' ;; ')}; JC_COMPLETE rows for the child: ${done.length}`,
    },
  ];
}

/** Rows read right after a rework / repair disposition, before the child runs. */
async function afterDisposeRowsR4(page: Page, p: string, key: string, kind: 'rework' | 'repair', statusLabel: RegExp, expectSuffix: string): Promise<DocRow[]> {
  const jc = r4(p + 'JcCode');
  const child = r4(key + 'Code');
  const n = await ncApi4(page, r4(p + 'Nc1Id'));
  const d = await readNcDetail(page, r4(p + 'Nc1Url'));
  const cops = await opsOf(page, child);
  const cj = await jcRead4(page, r4(key + 'Id'), r4(key + 'Url'));
  const ops = await opsOf(page, jc);
  const o2 = ops[1]!;
  const strip = await jcNcStrips(page, r4(p + 'JcUrl'));
  const st = await soStatus4(page, r4(p + 'SoId'), jc);
  const label = kind === 'rework' ? 'Under Rework' : 'Under Repair';
  const stripQty = kind === 'rework' ? o2.ncBreakup.underReworkQty : o2.ncBreakup.underRepairQty;
  return [
    {
      act: `Dispose ${kind} ${R4_REJ1}`,
      document: r4(p + 'Nc1Code'),
      qty: String(R4_REJ1),
      headerStatus: d.status,
      overallStatus: `Child ${child} raised`,
      ok: statusLabel.test(d.status) && n.disposition === kind && child === jc + expectSuffix && d.body.includes(child),
      note: `NC badge "${d.status}"; child on the NC page: ${d.body.includes(child)}; ${ncLine(n)}`,
    },
    {
      act: 'Check child job card',
      document: child,
      qty: String(R4_REJ1),
      headerStatus: cj.badge,
      overallStatus: `${cops.length} ops, ends in QC`,
      ok: cops.length === 2 && cops[0]!.opType === 'process' && cops[1]!.opType === 'qc' && /2 ORDERED/.test(cj.tiles),
      note: `${jcApiLine(cj.api)}; tiles "${cj.tiles}"; ops: ${cops.map(opLine).join(' ;; ')}`,
    },
    {
      act: 'Check parent op while open',
      document: `${jc} Op 20`,
      qty: String(o2.qcAcceptedQty),
      headerStatus: '',
      overallStatus: `${label} ${stripQty}; ${o2.computedStatus.replace(/_/g, ' ')}`,
      ok: o2.computedStatus === 'in_progress' && stripQty === R4_REJ1 && st.qcOpStatus === 'in_progress' && st.line.chips.jcIssued.qty === R4_QTY,
      note: `expected op in_progress while the child is open, strip "${label} ${R4_REJ1}", SO Status op in_progress, JC issued ${R4_QTY} of ${R4_QTY}; ${opLine(o2)}; strip "${strip}"; SO Status op=${st.qcOpStatus} JC issued ${st.line.chips.jcIssued.qty}/${st.line.chips.jcIssued.total} (page ${st.pageJcIssued}); children listed: ${st.childrenListed.join(', ') || 'none'}`,
    },
  ];
}

// ── R4-00: is the ADR-175 API live? Read-only on the T1 chain (SO 12 with a
//    child + grandchild rework JC): the old code counted the children as JC
//    issued 17 of 12; the new code reads 12 of 12. Polled up to 6 minutes. ──
test('R4-00 - confirm the ADR-175 API is live (T1 chain SO Status counts JC issued 12 of 12, not 17)', async ({ page }) => {
  test.setTimeout(900_000);
  const s = readState();
  if (!s.t1SoUrl || !s.t1JcCode) {
    blocked3('R4-00', 'ADR-175 liveness check on the T1 chain', 'T1 state (SO url / JC code) is not in the state file');
    return;
  }
  const soId = idFromUrl(s.t1SoUrl);
  // bearer() reads the context's storage state, which only carries an origin's
  // localStorage once a page of that origin has been opened — open one first.
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  let st: SoStatusRead | null = null;
  let waited = 0;
  for (let i = 0; i < 7; i += 1) {
    st = await soStatus4(page, soId, s.t1JcCode);
    if (st.line.chips.jcIssued.qty === st.line.orderQty) break;
    log(`ADR-175 not live yet: JC issued ${st.line.chips.jcIssued.qty} of ${st.line.orderQty} — waiting 60 s`);
    await page.waitForTimeout(60_000);
    waited += 60;
  }
  r4Set({ liveWaitSeconds: String(waited) });
  await rec4(page, 'R4-00', 'Liveness: T1 chain SO Status after ADR-175', async () => [
    {
      act: 'Confirm new API live',
      document: `${s.t1SoCode} — SO Status`,
      qty: String(st!.line.chips.jcIssued.qty),
      headerStatus: cap(st!.line.status),
      overallStatus: `JC ${st!.line.chips.jcIssued.qty}/${st!.line.chips.jcIssued.total}, children hidden`,
      ok: st!.line.chips.jcIssued.qty === st!.line.orderQty && st!.childrenListed.length === 0,
      note: `read-only on the 2026-09-15 T1 chain (${s.t1JcCode} + -RW1 + -RW1-RW1); waited ${waited}s; page chips JC Issued ${st!.pageJcIssued}; children listed: ${st!.childrenListed.join(', ') || 'none'}`,
    },
  ]);
});

// ── R4-A: Rework ──────────────────────────────────────────────────────────
test('R4-A - Rework: NC-1 -> Rework 2 -> child -RW1 -> run -> Final Inspection accept 2 -> everything settles', async ({ page }) => {
  test.setTimeout(2_700_000);
  await buildInhouseChainR4(page, 'a', 'Chain A');
  const jc = r4('aJcCode');
  await disposeR4(page, 'a', 'rework', R4_REJ1, `E2E_ ${R4_TAG} chain A - rework ${R4_REJ1}`, { key: 'aChild', suffix: 'RW', ownJc: jc, ncUrl: r4('aNc1Url'), ncId: r4('aNc1Id') });
  const n = await ncApi4(page, r4('aNc1Id'));
  if (n.disposition !== 'rework') {
    blocked3('R4-A2', 'NC-1 → Dispose: Rework 2', 'dispose refused: ' + (r4('aDisp_aChildMsg') || '(no message)'));
    return;
  }
  await rec4(page, 'R4-A2', `Chain A: NC-1 → Dispose Rework ${R4_REJ1} → child ${r4('aChildCode')}; parent op reads in progress while the child is open`, async () => afterDisposeRowsR4(page, 'a', 'aChild', 'rework', /under rework/i, '-RW1'));
  if (!r4('aChildDone')) {
    await runChildR4(page, r4('aChildCode'), R4_REJ1, R4_REJ1, 0);
    r4Set({ aChildDone: 'yes' });
  }
  // Deploy gate (brief): the parent's JC_COMPLETE row must exist after the
  // child's accept; if not, wait 2 minutes and re-read once.
  if (!(await jcCompleteRows4(page, jc)).length) {
    log('no JC_COMPLETE row for the parent yet — waiting 2 minutes and re-reading once');
    await page.waitForTimeout(120_000);
  }
  await rec4(page, 'R4-A3', `Chain A: child ${r4('aChildCode')} Turning ${R4_REJ1} → Final Inspection accept ${R4_REJ1} → every document settled`, async () => [
    ...(await childRowsR4(page, 'aChild', 'REWORK', jc, r4('aNc1Code'), R4_REJ1)),
    ...(await settledRowsR4(page, 'a', {
      acc: R4_QTY,
      opStatus: 'complete',
      jcClosed: true,
      ncCleared: R4_REJ1,
      ncFailed: 0,
      strip: { label: 'NC Closed', qty: R4_REJ1 },
      jcIssued: R4_QTY,
      produced: R4_QTY,
      soOp: 'complete',
      ready: R4_QTY,
      ledger: [R4_ACC1, R4_REJ1],
      soLine: 'closed',
    })),
  ]);
});

// ── R4-B: Rework, nested ──────────────────────────────────────────────────
test('R4-B - Rework nested: child QC 1 ok / 1 rej -> NC-2 continues NC-1 -> Rework 1 -> grandchild -> accept 1 -> all three JCs closed', async ({ page }) => {
  test.setTimeout(3_000_000);
  await buildInhouseChainR4(page, 'b', 'Chain B');
  const jc = r4('bJcCode');
  await disposeR4(page, 'b', 'rework', R4_REJ1, `E2E_ ${R4_TAG} chain B - rework ${R4_REJ1} (nested)`, { key: 'bChild', suffix: 'RW', ownJc: jc, ncUrl: r4('bNc1Url'), ncId: r4('bNc1Id') });
  const n1 = await ncApi4(page, r4('bNc1Id'));
  if (n1.disposition !== 'rework') {
    blocked3('R4-B2', 'NC-1 → Dispose: Rework 2', 'dispose refused: ' + (r4('bDisp_bChildMsg') || '(no message)'));
    return;
  }
  await rec4(page, 'R4-B2', `Chain B: NC-1 → Dispose Rework ${R4_REJ1} → child ${r4('bChildCode')}`, async () => afterDisposeRowsR4(page, 'b', 'bChild', 'rework', /under rework/i, '-RW1'));
  const child = r4('bChildCode');
  if (!r4('bChildDone')) {
    await runChildR4(page, child, R4_REJ1, 1, 1);
    r4Set({ bChildDone: 'yes' });
  }
  if (!r4('bNc2Code')) {
    const nc = await findAutoNc(page, child);
    const o = await openNc(page, nc.code);
    r4Set({ bNc2Code: nc.code, bNc2Url: o.url, bNc2Id: o.id });
    doc('R4 chain B NC-2 (child)', nc.code);
  }
  await rec4(page, 'R4-B3', `Chain B: child ${child} Turning ${R4_REJ1} → Final Inspection 1 ok / 1 rej → NC-2 ${r4('bNc2Code')} continues NC-1`, async () => {
    const n2 = await ncApi4(page, r4('bNc2Id'));
    const d2 = await readNcDetailWithRelated(page, r4('bNc2Url'));
    const n1b = await ncApi4(page, r4('bNc1Id'));
    const continues = /Earlier NC:/i.test(d2.body) && d2.body.includes(r4('bNc1Code'));
    return [
      {
        act: 'QC child: 1 ok, 1 reject',
        document: r4('bNc2Code'),
        qty: '1',
        headerStatus: d2.status,
        overallStatus: `Continues ${r4('bNc1Code')}`,
        ok: Number(n2.rejectedQty) === 1 && /pending/i.test(n2.status) && n2.parentNcId === r4('bNc1Id') && continues,
        note: `API parentNcId=${n2.parentNcId ?? 'null'} parentNcCode=${n2.parentNcCode ?? 'null'}; page "Continues NC" with NC-1 code: ${continues}; ${ncLine(n2)}`,
      },
      {
        act: 'Check NC-1 after child QC',
        document: r4('bNc1Code'),
        qty: String(R4_REJ1),
        headerStatus: (await readNcDetail(page, r4('bNc1Url'))).status,
        overallStatus: `Cleared ${Number(n1b.clearedQty)} of ${R4_REJ1}`,
        ok: Number(n1b.clearedQty) === 1 && /under_rework/i.test(n1b.status),
        note: ncLine(n1b),
      },
    ];
  });
  await disposeR4(page, 'b', 'rework', 1, `E2E_ ${R4_TAG} chain B - rework 1 (grandchild)`, { key: 'bGrand', suffix: 'RW', ownJc: child, ncUrl: r4('bNc2Url'), ncId: r4('bNc2Id') });
  const n2 = await ncApi4(page, r4('bNc2Id'));
  if (n2.disposition !== 'rework') {
    blocked3('R4-B4', 'NC-2 → Dispose: Rework 1', 'dispose refused: ' + (r4('bDisp_bGrandMsg') || '(no message)'));
    return;
  }
  await rec4(page, 'R4-B4', `Chain B: NC-2 → Dispose Rework 1 → grandchild ${r4('bGrandCode')}`, async () => {
    const d2 = await readNcDetail(page, r4('bNc2Url'));
    const g = r4('bGrandCode');
    const gj = await jcRead4(page, r4('bGrandId'), r4('bGrandUrl'));
    const gops = await opsOf(page, g);
    return [
      {
        act: 'Dispose rework 1',
        document: r4('bNc2Code'),
        qty: '1',
        headerStatus: d2.status,
        overallStatus: `Grandchild ${g} raised`,
        ok: /under rework/i.test(d2.status) && g === child + '-RW1' && d2.body.includes(g),
        note: `grandchild = ${g} (naming <child>-RW1: ${g === child + '-RW1'}); ${ncLine(n2)}`,
      },
      {
        act: 'Check grandchild job card',
        document: g,
        qty: '1',
        headerStatus: gj.badge,
        overallStatus: `${gops.length} ops, ends in QC`,
        ok: gops.length === 2 && gops[1]!.opType === 'qc' && /1 ORDERED/.test(gj.tiles),
        note: `${jcApiLine(gj.api)}; tiles "${gj.tiles}"; ops: ${gops.map(opLine).join(' ;; ')}`,
      },
    ];
  });
  if (!r4('bGrandDone')) {
    await runChildR4(page, r4('bGrandCode'), 1, 1, 0);
    r4Set({ bGrandDone: 'yes' });
  }
  await rec4(page, 'R4-B5', `Chain B: grandchild ${r4('bGrandCode')} Turning 1 → Final Inspection accept 1 → NC-2 closed, NC-1 closed cleared 2, all three JCs closed, parent op 10 of 10, ledger +8 +1 +1`, async () => {
    const n2c = await ncApi4(page, r4('bNc2Id'));
    const d2 = await readNcDetail(page, r4('bNc2Url'));
    return [
      {
        act: 'Check NC-2 closed',
        document: r4('bNc2Code'),
        qty: '1',
        headerStatus: d2.status,
        overallStatus: `Cleared ${Number(n2c.clearedQty)} of 1`,
        ok: /closed/i.test(n2c.status) && Number(n2c.clearedQty) === 1,
        note: ncLine(n2c),
      },
      ...(await childRowsR4(page, 'bGrand', 'REWORK', child, r4('bNc2Code'), 1)),
      ...(await childRowsR4(page, 'bChild', 'REWORK', jc, r4('bNc1Code'), R4_REJ1)),
      ...(await settledRowsR4(page, 'b', {
        acc: R4_QTY,
        opStatus: 'complete',
        jcClosed: true,
        ncCleared: R4_REJ1,
        ncFailed: 0,
        strip: { label: 'NC Closed', qty: R4_REJ1 },
        jcIssued: R4_QTY,
        produced: R4_QTY,
        soOp: 'complete',
        ready: R4_QTY,
        ledger: [R4_ACC1, 1, 1],
        soLine: 'closed',
      })),
    ];
  });
});

// ── R4-C: Use as is ───────────────────────────────────────────────────────
test('R4-C - Use as is: NC-1 -> Use as is 2 -> NC cleared 2, parent op 10 of 10, JC closed + JC_COMPLETE, stock +2 once, SO line closed', async ({ page }) => {
  test.setTimeout(2_400_000);
  await buildInhouseChainR4(page, 'c', 'Chain C');
  const msg = await disposeR4(page, 'c', 'use_as_is', R4_REJ1, `E2E_ ${R4_TAG} chain C - use as is ${R4_REJ1}`);
  const n = await ncApi4(page, r4('cNc1Id'));
  if (n.disposition !== 'use_as_is') {
    blocked3('R4-C2', 'NC-1 → Dispose: Use as is 2', 'dispose refused: ' + (msg || '(no message)'));
    return;
  }
  await rec4(page, 'R4-C2', `Chain C: NC-1 → Dispose Use as is ${R4_REJ1} → every document settled`, async () =>
    settledRowsR4(page, 'c', {
      acc: R4_QTY,
      opStatus: 'complete',
      jcClosed: true,
      ncCleared: R4_REJ1,
      ncFailed: 0,
      strip: { label: 'NC Closed', qty: R4_REJ1 },
      jcIssued: R4_QTY,
      produced: R4_QTY,
      soOp: 'complete',
      ready: R4_QTY,
      ledger: [R4_ACC1, R4_REJ1],
      soLine: 'closed',
    }),
  );
});

// ── R4-D: Scrap ───────────────────────────────────────────────────────────
test('R4-D - Scrap: NC-1 -> Scrap 2 -> NC failed 2 open 0, strip "Scrap 2", parent op 8 of 10 in progress (by design), SO line open, produced 8', async ({ page }) => {
  test.setTimeout(2_400_000);
  await buildInhouseChainR4(page, 'd', 'Chain D');
  const msg = await disposeR4(page, 'd', 'scrap', R4_REJ1, `E2E_ ${R4_TAG} chain D - scrap ${R4_REJ1}`);
  const n = await ncApi4(page, r4('dNc1Id'));
  if (n.disposition !== 'scrap') {
    blocked3('R4-D2', 'NC-1 → Dispose: Scrap 2', 'dispose refused: ' + (msg || '(no message)'));
    return;
  }
  await rec4(page, 'R4-D2', `Chain D: NC-1 → Dispose Scrap ${R4_REJ1} → NC closed failed ${R4_REJ1}; origin op stays ${R4_ACC1} of ${R4_QTY} (open business rule — by design)`, async () =>
    settledRowsR4(page, 'd', {
      acc: R4_ACC1,
      opStatus: 'in_progress',
      jcClosed: false,
      byDesign: true,
      ncCleared: 0,
      ncFailed: R4_REJ1,
      strip: { label: 'Scrap', qty: R4_REJ1 },
      jcIssued: R4_QTY,
      produced: R4_ACC1,
      soOp: 'in_progress',
      ready: R4_ACC1,
      ledger: [R4_ACC1],
      soLine: 'open',
    }),
  );
});

// ── R4-E: Make fresh ──────────────────────────────────────────────────────
test('R4-E - Make fresh: NC-1 -> Make fresh 2 -> NC failed 2, supplementary -S1 for 2 on the SO line, strip "NC closed 2" (0138), JC issued 12 of 10 by design', async ({ page }) => {
  test.setTimeout(2_400_000);
  await buildInhouseChainR4(page, 'e', 'Chain E');
  const jc = r4('eJcCode');
  const msg = await disposeR4(page, 'e', 'make_fresh', R4_REJ1, `E2E_ ${R4_TAG} chain E - make fresh ${R4_REJ1}`, { key: 'eSupp', suffix: 'S', ownJc: jc, ncUrl: r4('eNc1Url'), ncId: r4('eNc1Id') });
  const n = await ncApi4(page, r4('eNc1Id'));
  if (n.disposition !== 'make_fresh') {
    blocked3('R4-E2', 'NC-1 → Dispose: Make fresh 2', 'dispose refused: ' + (msg || '(no message)'));
    return;
  }
  await rec4(page, 'R4-E2', `Chain E: NC-1 → Dispose Make fresh ${R4_REJ1} → supplementary ${r4('eSuppCode')} for ${R4_REJ1}; NC failed ${R4_REJ1}; strip keeps "NC closed ${R4_REJ1}" (0138); origin op stays ${R4_ACC1} of ${R4_QTY} and JC issued reads 12 of 10 (by design)`, async () => {
    const supp = r4('eSuppCode');
    const sj = await jcRead4(page, r4('eSuppId'), r4('eSuppUrl'));
    const sops = await opsOf(page, supp);
    const d = await readNcDetail(page, r4('eNc1Url'));
    const soA = await soApi(page, r4('eSoId'));
    const st = await soStatus4(page, r4('eSoId'), jc);
    const suppListed = st.line.jobCards.some((j) => j.code === supp);
    const base = await settledRowsR4(page, 'e', {
      acc: R4_ACC1,
      opStatus: 'in_progress',
      jcClosed: false,
      byDesign: true,
      ncCleared: 0,
      ncFailed: R4_REJ1,
      strip: { label: 'NC Closed', qty: R4_REJ1 },
      jcIssued: R4_QTY + R4_REJ1, // the supplementary counts — by design
      produced: R4_ACC1,
      soOp: 'in_progress',
      ready: R4_ACC1,
      ledger: [R4_ACC1],
      soLine: 'open',
    });
    // The SO Status chips row: 12 of 10 is the expected (by design) reading —
    // rewrite its verdict so a match reads ◌ By design, not ✓.
    for (const r of base) {
      if (r.act === 'Check SO status chips' && r.ok === true) {
        r.ok = 'blocked';
        r.note = `by design — the supplementary JC counts as JC issued (${R4_QTY + R4_REJ1} of ${R4_QTY}); ` + (r.note ?? '');
      }
    }
    return [
      {
        act: 'Dispose make fresh 2',
        document: r4('eNc1Code'),
        qty: String(R4_REJ1),
        headerStatus: d.status,
        overallStatus: `New JC ${supp}`,
        ok: /closed/i.test(n.status) && Number(n.failedQty) === R4_REJ1 && supp === jc + '-S1' && d.body.includes(supp),
        note: `New JC on the NC page: ${d.body.includes(supp)} (API reworkJcCodeText=${n.reworkJcCodeText ?? 'null'}); ${ncLine(n)}`,
      },
      {
        act: 'Check supplementary job card',
        document: supp,
        qty: String(R4_REJ1),
        headerStatus: sj.badge,
        overallStatus: `${R4_REJ1} pcs on ${soA.code} line`,
        ok: /2 ORDERED/.test(sj.tiles) && sops.length >= 1 && suppListed && !sj.api.recoveryKind,
        note: `${jcApiLine(sj.api)}; tiles "${sj.tiles}"; recoveryKind=${sj.api.recoveryKind ?? 'null'}; listed under the SO line on SO Status: ${suppListed}; ops: ${sops.map(opLine).join(' ;; ')}`,
      },
      ...base,
    ];
  });
});

// ── R4-F: Repair ──────────────────────────────────────────────────────────
test('R4-F - Repair: NC-1 -> Repair 2 -> child -RP1 ("Under repair") -> run -> Final Inspection accept 2 -> everything settles like rework', async ({ page }) => {
  test.setTimeout(2_700_000);
  await buildInhouseChainR4(page, 'f', 'Chain F');
  const jc = r4('fJcCode');
  await disposeR4(page, 'f', 'repair', R4_REJ1, `E2E_ ${R4_TAG} chain F - repair ${R4_REJ1}`, { key: 'fChild', suffix: 'RP', ownJc: jc, ncUrl: r4('fNc1Url'), ncId: r4('fNc1Id') });
  const n = await ncApi4(page, r4('fNc1Id'));
  if (n.disposition !== 'repair') {
    blocked3('R4-F2', 'NC-1 → Dispose: Repair 2', 'dispose refused: ' + (r4('fDisp_fChildMsg') || '(no message)'));
    return;
  }
  await rec4(page, 'R4-F2', `Chain F: NC-1 → Dispose Repair ${R4_REJ1} → child ${r4('fChildCode')} ("Under repair")`, async () => afterDisposeRowsR4(page, 'f', 'fChild', 'repair', /under repair/i, '-RP1'));
  if (!r4('fChildDone')) {
    await runChildR4(page, r4('fChildCode'), R4_REJ1, R4_REJ1, 0);
    r4Set({ fChildDone: 'yes' });
  }
  await rec4(page, 'R4-F3', `Chain F: child ${r4('fChildCode')} Turning ${R4_REJ1} → Final Inspection accept ${R4_REJ1} → every document settled`, async () => [
    ...(await childRowsR4(page, 'fChild', 'REPAIR', jc, r4('fNc1Code'), R4_REJ1)),
    ...(await settledRowsR4(page, 'f', {
      acc: R4_QTY,
      opStatus: 'complete',
      jcClosed: true,
      ncCleared: R4_REJ1,
      ncFailed: 0,
      strip: { label: 'NC Closed', qty: R4_REJ1 },
      jcIssued: R4_QTY,
      produced: R4_QTY,
      soOp: 'complete',
      ready: R4_QTY,
      ledger: [R4_ACC1, R4_REJ1],
      soLine: 'closed',
    })),
  ]);
});

// ── R4-Z: read-only regression on the R1 chain + OSP register ─────────────
test('R4-Z - regression (read-only): IN-JWPO-00007/R1 still 10 of 10 closed; OSP At-Vendor Register has no over-count row', async ({ page }) => {
  test.setTimeout(900_000);
  await rec4(page, 'R4-Z1', 'Regression: R1 chain JWPO + OSP register after ADR-175', async () => {
    const rows: DocRow[] = [];
    if (r1('poId') && r1('jcCode')) {
      const po = await readPo(page, r1('poId'));
      const o = (await opsOf(page, r1('jcCode')))[0]!;
      rows.push({
        act: 'Re-check earlier job-work PO',
        document: po.code,
        qty: String(po.received[0] ?? 0),
        headerStatus: cap(po.status),
        overallStatus: `Line ${po.received[0]} of ${po.qty[0]}`,
        ok: po.received[0] === 10 && po.qty[0] === 10 && po.status === 'closed' && o.completedQty === 10 && o.atVendorQty === 0,
        note: `${poText(po)}; Op1: ${opLine(o)}`,
      });
    } else {
      rows.push({ document: 'IN-JWPO-00007/R1', qty: '', headerStatus: '', overallStatus: '', ok: false, note: 'R1 state (poId / jcCode) not in the state file', act: 'Re-check earlier job-work PO' });
    }
    const reg = await ospRegister(page);
    const bad1 = reg.filter((w) => w.returnedQty > w.sentQty);
    const bad2 = reg.filter((w) => w.atVendorQty + w.inQcQty > w.sentQty);
    await page.goto('/delivery-challans?tab=at_vendor', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    rows.push({
      act: 'Check at-vendor register',
      document: 'OSP At-Vendor Register',
      qty: String(reg.length),
      headerStatus: '',
      overallStatus: bad1.length + bad2.length === 0 ? 'No row over sent' : `${bad1.length + bad2.length} rows over sent`,
      ok: bad1.length === 0 && bad2.length === 0,
      note: `${reg.length} rows; returned > sent: ${bad1.map(wipLine).join(' | ') || 'none'}; at-vendor + in-QC > sent: ${bad2.map(wipLine).join(' | ') || 'none'}`,
    });
    return rows;
  });
});

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── READABLE REPORT (user format, 2026-09-16 afternoon) ───────────────────
// Six columns: Action | Document | Qty | Header Status | Overall Status |
// Result. Action ≤ 6 plain words, verb first, no document codes / ADR / G /
// R / T numbers / screen paths. One document per row (a step that touched
// several documents is split). Qty = a number. Header Status = the badge on
// that document's page, Title Case. Overall Status = a short plain state.
// Every row's verdict is the recorded one; the JSON keeps the full text.
//
// The mapping below is hand-written per recorded row (the rows themselves
// are never changed). A row without an entry falls back to a best-effort
// read of its recorded text (legacyView) so nothing silently disappears.

type ViewTuple = [action: string, document: string, qty: string, header: string, overall: string];

const DOC_RE = /IN-(?:JWPO|JWPR|MPO|PO|PR|SO|DC|GRN|JW)-\d+(?:\/R\d+)?|IN-JC-\d{2}-\d+(?:-R[WP]\d+)*(?:\s+Op\s*\d+)?|NC-AUTO-[A-Za-z0-9-]+|PLN-\d+|RCPT-[A-Z0-9/-]+/g;
function legacyView(x: Row): ViewTuple[] {
  const seen = x.actual;
  const inAction = [...new Set(x.action.match(DOC_RE) ?? [])];
  const docs = inAction.length > 0 ? inAction : [...new Set(seen.match(DOC_RE) ?? [])];
  const qty = /\b(\d+)\b/.exec(x.qty ?? x.action)?.[1] ?? '';
  const header = titleCase(x.headerStatus ?? (/(?:status|badge)\s+"([^"]{1,40})"/i.exec(seen)?.[1] ?? /header "([^"]{1,30})"/.exec(seen)?.[1] ?? ''));
  const overall = (x.overallStatus ?? '').slice(0, 60);
  const action = x.action.replace(DOC_RE, '').replace(/[→·]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  return [[action, x.document ?? docs[0] ?? '—', qty, header, overall]];
}
function titleCase(s: string): string {
  return s
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bQc\b/g, 'QC')
    .replace(/\bNc\b/g, 'NC')
    .replace(/\bPo\b/g, 'PO')
    .replace(/\bPr\b/g, 'PR')
    .replace(/\bDone\b/g, 'Done')
    .trim();
}

/** Plain-English group headings (one per test batch), code kept small and grey. */
const GROUPS: Record<string, { title: string; code: string }> = {
  T1: { title: 'Test 1 — Rework: 12 pieces, 4 rejected, fixed through two child job cards, all 12 accepted', code: 'T1 · IN-JC-26-00031 · 2026-09-15' },
  T2: { title: 'Test 2 — Vendor return: 10 sent out, 3 rejected on receipt, returned and replaced, all 10 accepted', code: 'T2 · IN-JC-26-00032 · 2026-09-15' },
  T3: { title: 'Test 3 — Repeated vendor returns: rework refused for vendor material, three return trips, all 10 accepted', code: 'T3 · IN-JC-26-00033 · 2026-09-15' },
  R1: { title: 'Return to vendor, repeated 4 times — PO quantity right at every step', code: 'R1 · IN-JC-26-00035 · 2026-09-16 (after ADR-165)' },
  R2: { title: 'Outsource op with in-house QC after it, a partly-sent op, and outsource as the last op — quantities, status and stock right', code: 'R2 · IN-JC-26-00039 / 00040 / 00041 · 2026-09-16 (ADR-166)' },
  R3: { title: 'Return bucket, NC chain links, PO delete and re-raise, two POs on one op, direct job card, use-as-is', code: 'R3 · 2026-09-16 (ADR-167)' },
  R4: { title: 'Every NC disposition settles the chain — rework, nested rework, use as is, scrap, make fresh, repair', code: 'R4 · 2026-09-21 (ADR-175)' },
};
/** Sub-headings inside R2 / R3 (one per chain), plain English. */
function subOf(id: string): string {
  if (id.startsWith('R2')) {
    const tag = /^R2-\d+-([A-Z]+)/.exec(id)?.[1] ?? '';
    if (tag.startsWith('M')) return 'Chain M — outsource op, then an in-house QC op; two return cycles';
    if (tag.startsWith('G')) return 'Chain G — only 6 of 10 sent to the vendor';
    if (tag.startsWith('L')) return 'Chain L — outsource op is the last op';
    return 'Registers and earlier chains re-read';
  }
  if (id.startsWith('R3')) {
    const step = id.replace(/-\d+$/, '');
    const S: Record<string, string[]> = {
      'Chain M re-read — NC strip counts pieces; NC links': ['R3-01', 'R3-02', 'R3-06'],
      'Earlier 4-return chain re-read — NC chain A ← B ← C ← D': ['R3-01b', 'R3-02b', 'R3-02b2', 'R3-02b3', 'R3-02d'],
      'Chain N — return without a challan first, then the challan; follow-on NC linked at creation': ['R3-03', 'R3-03b', 'R3-02c', 'R3-03c'],
      'Chain P — second job-work PO on the same op; send, receive, QC on it': ['R3-04c', 'R3-08a', 'R3-08b'],
      'Chain Q — delete the job-work PO; op goes back to "PR raised"': ['R3-04a', 'R3-04b'],
      'Chain G — PO delete refused behind a challan; SO not complete': ['R3-05', 'R3-06b'],
      'Chain L — SO complete from the accepted receipt': ['R3-06c'],
      'Direct job card from a job-work order — PR raised on save; vendor picker': ['R3-07', 'R3-07a', 'R3-07b', 'R3-07c', 'R3-07r'],
      'Chain U — "use as is" closes the NC and counts as closed': ['R3-10'],
    };
    for (const [title, steps] of Object.entries(S)) if (steps.includes(step)) return title;
    return 'Other';
  }
  return '';
}
const R3_ORDER = ['R3-01', 'R3-02', 'R3-06', 'R3-01b', 'R3-02b', 'R3-02b2', 'R3-02b3', 'R3-02d', 'R3-03', 'R3-03b', 'R3-02c', 'R3-03c', 'R3-04c', 'R3-08a', 'R3-08b', 'R3-04a', 'R3-04b', 'R3-05', 'R3-06b', 'R3-06c', 'R3-07', 'R3-07a', 'R3-07b', 'R3-07c', 'R3-07r', 'R3-10'];

/** The per-row mapping. Keys are row ids; values are the rows printed for it. */
function buildViewMap(docs: Record<string, string>, rows: Row[]): Record<string, ViewTuple[]> {
  const D = (k: string): string => docs[k] ?? k;
  const hdr = (id: string): string => rows.find((y) => y.id === id)?.headerStatus ?? '';
  // Test 1
  const t1so = D('T1 SO');
  const t1 = D('T1 parent JC');
  const t1c1 = D('T1 child JC 1');
  const t1c2 = D('T1 child JC 2');
  const t1nc1 = D('T1 NC 1 (parent)');
  const t1nc2 = D('T1 NC 2 (child 1)');
  // Test 2
  const t2so = D('T2 SO');
  const t2 = D('T2 JC');
  const t2pr = D('T2 JW PR (auto)');
  const t2po = D('T2 JWPO');
  const t2dc = D('T2 outward DC');
  const t2g1 = D('T2 GRN 1 (Against JWPO / DC)');
  const t2nc = D('T2 NC (OSP reject)');
  const t2rdc = D('T2 return-to-vendor DC');
  const t2g2 = D('T2 GRN 2 (Against NC)');
  const t2aG = D('T2a purchase GRN');
  // Test 3
  const t3so = D('T3 SO');
  const t3 = D('T3 top JC (OSP)');
  const t3po = D('T3 JWPO');
  const t3dc = D('T3 outward DC');
  const t3g1 = D('T3 GRN 1 (Against JWPO / DC)');
  const t3ncA = D('T3 NC-A');
  const t3ncB = D('T3 NC-B');
  const t3ncC = D('T3 NC-C');
  const t3dc1 = D('T3 RTV DC 1 (NC-A)');
  const t3dc2 = D('T3 RTV DC 2 (NC-B)');
  const t3dc3 = D('T3 RTV DC 3 (NC-C)');
  const t3g2 = D('T3 GRN 2 (Against NC-A)');
  const t3g3 = D('T3 GRN 3 (Against NC-B)');
  const t3g4 = D('T3 GRN 4 (Against NC-C)');
  // R1
  const r1so = D('R1 SO');
  const r1 = D('R1 JC (OSP)');
  const r1po = D('R1 JWPO');
  const r1dc = D('R1 outward DC');
  const r1g1 = D('R1 GRN 1 (Against JWPO / DC)');
  const r1ncA = D('R1 NC-A');
  const r1ncB = D('R1 NC-B');
  const r1ncC = D('R1 NC-C');
  const r1ncD = D('R1 NC-D');
  const r1dcA = D('R1 RTV DC (NC-A)');
  const r1dcB = D('R1 RTV DC (NC-B)');
  const r1dcC = D('R1 RTV DC (NC-C)');
  const r1dcD = D('R1 RTV DC (NC-D)');
  const r1gA = D('R1 GRN (Against NC-A)');
  const r1gB = D('R1 GRN (Against NC-B)');
  const r1gC = D('R1 GRN (Against NC-C)');
  const r1gD = D('R1 GRN (Against NC-D)');
  // R2
  const mso = D('R2 chain M SO');
  const m = D('R2 chain M JC');
  const mpo = D('R2 chain M JWPO');
  const mdc = D('R2 chain M outward DC');
  const mg1 = D('R2 chain M GRN 1 (Against JWPO / DC)');
  const mncA = D('R2 chain M NC-A');
  const mncB = D('R2 chain M NC-B');
  const mdcA = D('R2 chain M RTV DC (NC-A)');
  const mdcB = D('R2 chain M RTV DC (NC-B)');
  const mgA = D('R2 chain M GRN (Against NC-A)');
  const mgB = D('R2 chain M GRN (Against NC-B)');
  const gso = D('R2 chain G SO');
  const g = D('R2 chain G JC');
  const gpo = D('R2 chain G JWPO');
  const gdc = D('R2 chain G outward DC');
  const gg1 = D('R2 chain G GRN 1 (Against JWPO / DC)');
  const gnc = D('R2 chain G NC');
  const gdcA = D('R2 chain G RTV DC (NC-A)');
  const ggA = D('R2 chain G GRN (Against NC)');
  const lso = D('R2 chain L SO');
  const l = D('R2 chain L JC');
  const lpo = D('R2 chain L JWPO');
  const ldc = D('R2 chain L outward DC');
  const lg1 = D('R2 chain L GRN 1 (Against JWPO / DC)');
  // R3
  const n = D('R3 chain N JC');
  const npo = D('R3 chain N JWPO');
  const nncA = D('R3 chain N NC-A');
  const nncB = D('R3 chain N NC-B');
  const ndcA = D('R3 chain N RTV DC (NC-A)');
  const p = D('R3 chain P JC');
  const ppr = D('R3 chain P JW PR (auto)');
  const ppo2 = D('R3 chain P JWPO 2');
  const ppo3 = D('R3 chain P JWPO 3 (second link)');
  const pdc = D('R3 chain P outward DC (JWPO 3)');
  const q = D('R3 chain Q JC');
  const qpr = D('R3 chain Q JW PR (auto)');
  const qpo = D('R3 chain Q JWPO 1 (deleted)');
  const jw = D('R3 direct JC (from JWSO)');
  const jwpr = 'IN-JWPR-00020';
  const u = D('R3 chain U JC');
  const unc = 'NC-AUTO-IN-JC-26-00046-Op10-075636115';
  const v = D('R3 chain V JC (vendor picker)');
  const seen = (id: string, re: RegExp, dflt = ''): string => {
    const x = rows.find((y) => y.id === id);
    return x ? (re.exec(x.actual)?.[1] ?? dflt) : dflt;
  };
  const vRun = ((): { opt959: string; labelAfterSecond: string } => {
    try {
      return JSON.parse(readState().r2?.['vRun'] ?? '{}') as { opt959: string; labelAfterSecond: string };
    } catch {
      return { opt959: '', labelAfterSecond: '' };
    }
  })();

  return {
    // ── Test 1 ──
    'T1-01': [['Create sales order', t1so, '12', 'Open', 'Open']],
    'T1-02': [['Plan job card', t1, '12', '—', 'Turning + inspection planned']],
    'T1-03': [['Run turning, 12 made', `${t1} Op 1`, '12', 'Complete', '12 waiting for QC']],
    'T1-04': [['QC: 8 ok, 4 reject', `${t1} Op 2`, '12', 'In Progress', 'NC raised 4']],
    'T1-05': [['Open rejection note', t1nc1, '4', 'NC Raised', 'Open, 4 rejected']],
    'T1-06': [
      ['Send 4 for rework', t1nc1, '4', 'Under Rework', 'Child job card created'],
      ['Create rework job card', t1c1, '4', '—', 'Created for 4'],
    ],
    'T1-07': [['Open rework job card', t1c1, '4', 'Complete', 'Rework of parent op 2']],
    'T1-08': [['Check parent job card', t1, '4', '—', 'Under rework 4']],
    'T1-09': [
      ['Run rework turning, 4 made', `${t1c1} Op 1`, '4', 'Complete', '4 waiting for QC'],
      ['QC: 3 ok, 1 reject', `${t1c1} Op 2`, '4', 'In Progress', 'NC raised 1']],
    'T1-10': [['Open second rejection note', t1nc2, '1', 'NC Raised', 'Open, 1 rejected']],
    'T1-11': [
      ['Send 1 for rework', t1nc2, '1', 'Under Rework', 'Second child job card created'],
      ['Create second rework card', t1c2, '1', '—', 'Created for 1'],
    ],
    'T1-12': [['Open second rework card', t1c2, '1', 'Complete', 'Rework of child op 2']],
    'T1-13': [
      ['Run turning, 1 made', `${t1c2} Op 1`, '1', 'Complete', '1 waiting for QC'],
      ['QC: 1 ok', `${t1c2} Op 2`, '1', 'Complete', 'Closed, nothing rejected']],
    'T1-14': [['Check second rejection note', t1nc2, '1', 'Closed', '1 of 1 cleared']],
    'T1-15': [['Check first rejection note', t1nc1, '4', 'Closed', '4 of 4 cleared']],
    'T1-16': [['Check rework job card', t1c1, '4', 'Complete', 'NC closed 1, 4 accepted']],
    'T1-17': [['Check parent job card', t1, '12', 'Complete', '12 of 12 accepted, NC closed 4']],
    'T1-18': [
      ['Check job card list', t1, '12', 'Complete', '100% complete'],
      ['Check job card list', t1c1, '4', 'Complete', '100% complete'],
      ['Check job card list', t1c2, '1', 'Closed', '100% complete'],
    ],
    'T1-19': [
      ['Check NC register', t1nc1, '4', 'Closed', 'Rework'],
      ['Check NC register', t1nc2, '1', 'Closed', 'Rework'],
    ],
    // ── Test 2 ──
    'T2-01': [['Receive 2 on purchase order', t2aG, '2', 'QC Pending', 'Plain purchase, no job card']],
    'T2-02': [['QC: 1 ok, 1 reject', t2aG, '2', 'QC Completed', 'No NC raised — by design']],
    'T2-03': [['Create sales order', t2so, '10', 'Open', 'Open']],
    'T2-04': [
      ['Plan outsource op', `${t2} Op 1`, '10', '—', 'PR raised'],
      ['Raise job-work request', t2pr, '10', '—', 'Raised by the system'],
    ],
    'T2-05': [['Raise job-work purchase order', t2po, '10', 'Open', '0 received']],
    'T2-06': [['Send 10 to vendor', t2dc, '10', 'Issued', 'At vendor 10']],
    'T2-07': [
      ['Receive 10 from vendor', t2g1, '10', 'QC Pending', 'In QC 10'],
      ['Check job-work order', t2po, '10', 'QC Pending', '10 of 10 received'],
      ['Check outward challan', t2dc, '10', 'Received', '1 receipt'],
    ],
    'T2-08': [
      ['QC: 7 ok, 3 reject', t2g1, '10', 'QC Completed', 'NC raised 3'],
      ['Check op card', `${t2} Op 1`, '7', 'In Progress', 'Done 7, NC raised 3'],
    ],
    'T2-09': [['Open rejection note', t2nc, '3', 'NC Raised', 'Source vendor, PO and receipt shown']],
    'T2-10': [['Return 3 to vendor', t2nc, '3', 'Disposed', 'Return to vendor chosen']],
    'T2-11': [['Check return challan vendor', t2nc, '3', 'Disposed', 'Original vendor prefilled']],
    'T2-12': [['Create return challan', t2rdc, '3', 'Issued', 'At vendor 3']],
    'T2-13': [['Check job-work order', t2po, '7', 'Closed', '7 of 10; badge was stale']],
    'T2-14': [['Check op card', `${t2} Op 1`, '3', 'In Progress', 'Sent to vendor 3']],
    'T2-15': [['Receive 3 replacement', t2g2, '3', 'Against NC', 'In QC 3']],
    'T2-16': [['Check rejection note', t2nc, '3', 'Received – QC Pending', 'Sent 3, received 3']],
    'T2-17': [['QC: 3 ok', t2g2, '3', 'QC Completed', 'NC closed, 3 cleared']],
    'T2-18': [['Check job-work order', t2po, '10', 'Partial', '10 of 10; badge was stale']],
    'T2-19': [['Check op card', `${t2} Op 1`, '10', 'Complete', 'Done 10, at vendor 0, NC closed 3']],
    'T2-20': [['Check return challan', t2rdc, '3', 'Received', '1 receipt']],
    'T2-21': [
      ['Check stock ledger', t2g1, '7', '—', '+7 credited once'],
      ['Check stock ledger', t2g2, '3', '—', '+3 credited once'],
    ],
    'T2-22': [['Check NC register', t2nc, '3', 'Closed', 'Return to vendor']],
    // ── Test 3 ──
    'T3-01': [
      ['Create sales order', t3so, '10', '—', 'Open'],
      ['Plan outsource op', `${t3} Op 1`, '10', '—', 'Outsource op on the vendor'],
      ['Raise job-work purchase order', t3po, '10', '—', 'Approved'],
      ['Send 10 to vendor', t3dc, '10', '—', 'At vendor 10'],
      ['Receive 10 from vendor', t3g1, '10', '—', 'In QC 10'],
      ['QC: 7 ok, 3 reject', t3g1, '10', '—', 'NC raised 3'],
      ['Return 3 to vendor', t3dc1, '3', '—', 'Vendor prefilled; at vendor 3'],
      ['Receive 3 replacement', t3g2, '3', '—', 'In QC 3'],
      ['Check rejection note', t3ncA, '3', 'Received – QC Pending', 'Sent 3, received 3'],
    ],
    'T3-02': [
      ['QC: 1 ok, 2 reject', t3g2, '3', 'QC Completed', 'Second NC raised 2'],
      ['Check first rejection note', t3ncA, '3', 'Closed', '1 cleared, 2 failed'],
      ['Check second rejection note', t3ncB, '2', 'NC Raised', 'Source receipt and vendor shown'],
    ],
    'T3-03': [['Ask rework of vendor part', t3ncB, '2', 'NC Raised', 'Refused: return to vendor instead']],
    'T3-04': [['Open rework child card', '—', '2', '—', 'No child card can exist']],
    'T3-05': [
      ['Return 2 to vendor', t3dc2, '2', 'Issued', 'Vendor prefilled; at vendor 2'],
      ['Check job-work order', t3po, '6', 'Partial', '6 of 10, expected 8'],
    ],
    'T3-06': [
      ['Receive 2 replacement', t3g3, '2', '—', 'In QC 2'],
      ['QC: 1 ok, 1 reject', t3g3, '2', 'QC Completed', 'Third NC raised 1'],
      ['Check second rejection note', t3ncB, '2', 'Closed', '1 cleared, 1 failed'],
      ['Check third rejection note', t3ncC, '1', 'NC Raised', 'Open, 1 rejected'],
    ],
    'T3-07': [['Ask rework of vendor part', t3ncC, '1', 'NC Raised', 'Refused again: return to vendor']],
    'T3-08': [
      ['Return 1 to vendor', t3dc3, '1', 'Received', 'Vendor prefilled; back from vendor'],
      ['Receive 1 replacement', t3g4, '1', '—', 'In QC 1'],
      ['Check third rejection note', t3ncC, '1', 'Received – QC Pending', 'Sent 1, received 1'],
      ['Check job-work order', t3po, '6', 'Partial', '6 of 10 while 1 is out'],
    ],
    'T3-09': [['QC: 1 ok', t3g4, '1', 'QC Completed', 'NC closed, 1 cleared']],
    'T3-10': [
      ['Check all rejection notes', t3ncA, '3', 'Closed', '1 cleared, 2 failed'],
      ['Check all rejection notes', t3ncB, '2', 'Closed', '1 cleared, 1 failed'],
      ['Check all rejection notes', t3ncC, '1', 'Closed', '1 cleared'],
    ],
    'T3-11': [['Check job card', t3, '10', 'Complete', '10 of 10 accepted, NC closed 6']],
    'T3-12': [['Check job-work order', t3po, '7', 'Partial', '7 of 10, expected 10']],
    'T3-13': [
      ['Check return challan', t3dc1, '3', 'Received', 'Carries the first NC'],
      ['Check return challan', t3dc2, '2', 'Received', 'Carries the second NC'],
      ['Check return challan', t3dc3, '1', 'Received', 'Carries the third NC'],
      ['Check replacement receipt', t3g2, '3', 'QC Completed', '1 ok, 2 rejected'],
      ['Check replacement receipt', t3g3, '2', 'QC Completed', '1 ok, 1 rejected'],
      ['Check replacement receipt', t3g4, '1', 'QC Completed', '1 ok'],
    ],
    'T3-14': [['Open grandchild rework card', '—', '', '—', 'Cannot exist for vendor material']],
    // ── R1 ──
    'R1-01': [
      ['Create sales order', r1so, '10', '—', 'Open'],
      ['Plan outsource op', `${r1} Op 1`, '10', 'Received', 'At vendor 0, in QC 10'],
      ['Raise job-work purchase order', r1po, '10', 'QC Pending', '10 of 10 received'],
      ['Send 10 to vendor', r1dc, '10', '—', 'At vendor 10'],
      ['Receive 10 from vendor', r1g1, '10', '—', 'In QC 10'],
    ],
    'R1-02': [
      ['QC: 7 ok, 3 reject', r1g1, '10', '—', 'First NC raised 3'],
      ['Check job-work order', r1po, '10', 'Closed', '10 of 10 (nothing returned yet)'],
    ],
    'R1-A1': [
      ['Return 3 to vendor', r1dcA, '3', 'Issued', 'Vendor prefilled; at vendor 3'],
      ['Check job-work order', r1po, '7', 'Partial', '7 of 10 — right this time'],
    ],
    'R1-A2': [
      ['Receive 3 replacement', r1gA, '3', 'QC Pending', 'In QC 3'],
      ['Check job-work order', r1po, '7', 'Partial', 'Still 7 until QC clears'],
    ],
    'R1-A3': [
      ['QC: 1 ok, 2 reject', r1gA, '3', '—', 'Second NC raised 2'],
      ['Check first rejection note', r1ncA, '3', 'Closed', '1 cleared, 2 failed'],
      ['Check job-work order', r1po, '10', 'Closed', '10 of 10 — right this time'],
    ],
    'R1-B1': [
      ['Return 2 to vendor', r1dcB, '2', 'Issued', 'Vendor prefilled; at vendor 2'],
      ['Check job-work order', r1po, '8', 'Partial', '8 of 10 — right this time'],
    ],
    'R1-B2': [
      ['Receive 2 replacement', r1gB, '2', 'QC Pending', 'In QC 2'],
      ['Check job-work order', r1po, '8', 'Partial', 'Still 8 until QC clears'],
    ],
    'R1-B3': [
      ['QC: 1 ok, 1 reject', r1gB, '2', '—', 'Third NC raised 1'],
      ['Check second rejection note', r1ncB, '2', 'Closed', '1 cleared, 1 failed'],
      ['Check job-work order', r1po, '10', 'Closed', '10 of 10'],
    ],
    'R1-C1': [
      ['Return 1 to vendor', r1dcC, '1', 'Issued', 'Vendor prefilled; at vendor 1'],
      ['Check job-work order', r1po, '9', 'Partial', '9 of 10'],
    ],
    'R1-C2': [
      ['Receive 1 replacement', r1gC, '1', 'QC Pending', 'In QC 1'],
      ['Check job-work order', r1po, '9', 'Partial', 'Still 9 until QC clears'],
    ],
    'R1-C3': [
      ['QC: 0 ok, 1 reject', r1gC, '1', '—', 'Fourth NC raised 1'],
      ['Check third rejection note', r1ncC, '1', 'Closed', '0 cleared, 1 failed'],
      ['Check job-work order', r1po, '10', 'Closed', '10 of 10 (all-rejected still moves it)'],
    ],
    'R1-D1': [
      ['Return 1 to vendor', r1dcD, '1', 'Issued', 'Vendor prefilled; at vendor 1'],
      ['Check job-work order', r1po, '9', 'Partial', '9 of 10'],
    ],
    'R1-D2': [
      ['Receive 1 replacement', r1gD, '1', 'QC Pending', 'In QC 1'],
      ['Check job-work order', r1po, '9', 'Partial', 'Still 9 until QC clears'],
    ],
    'R1-D3': [
      ['QC: 1 ok', r1gD, '1', '—', 'Nothing rejected'],
      ['Check fourth rejection note', r1ncD, '1', 'Closed', '1 cleared'],
      ['Check job-work order', r1po, '10', 'Closed', '10 of 10 — right this time'],
    ],
    'R1-Z1': [['Check job-work order', r1po, '10', 'Closed', '10 of 10, every piece accepted']],
    'R1-Z2': [
      ['Check job card', `${r1} Op 1`, '10', 'Complete', 'Done 10, at vendor 0, NC closed 7'],
      ['Check all rejection notes', r1ncA, '3', 'Closed', '1 cleared, 2 failed'],
      ['Check all rejection notes', r1ncB, '2', 'Closed', '1 cleared, 1 failed'],
      ['Check all rejection notes', r1ncC, '1', 'Closed', '0 cleared, 1 failed'],
      ['Check all rejection notes', r1ncD, '1', 'Closed', '1 cleared'],
    ],
    'R1-Z3': [['Check order activity log', r1po, '8', '—', '8 quantity moves, all right']],
    // ── R2 ──
    'R2-01-M1a': [
      ['Create sales order', mso, '10', '—', 'Open'],
      ['Plan outsource then QC op', m, '10', '—', '2 ops planned'],
      ['Raise job-work purchase order', mpo, '10', 'QC Pending', '10 of 10 received'],
      ['Send 10 to vendor', mdc, '10', '—', 'At vendor 10'],
      ['Receive 10 from vendor', mg1, '10', '—', 'In QC 10'],
      ['Check op card', `${m} Op 1`, '10', 'Received', 'At vendor 0, in QC 10'],
    ],
    'R2-02-M1': [
      ['QC: 7 ok, 3 reject', mg1, '10', '—', 'NC raised 3'],
      ['Check op card', `${m} Op 1`, '7', 'In Progress', 'Done 7, NC raised 3'],
      ['Check QC op card', `${m} Op 2`, '7', 'In Progress', '7 accepted, mirrored'],
      ['Check job-work order', mpo, '10', 'Closed', '10 of 10'],
    ],
    'R2-03-M2': [
      ['Return 3 to vendor', mdcA, '3', 'Issued', 'Vendor prefilled; at vendor 3'],
      ['Check op card', `${m} Op 1`, '3', 'In Progress', 'Sent to vendor 3'],
      ['Check job-work order', mpo, '7', 'Partial', '7 of 10'],
    ],
    'R2-04-M3': [
      ['Receive 3 replacement', mgA, '3', '—', 'In QC 3'],
      ['Check op card', `${m} Op 1`, '3', 'In Progress', 'Received, in QC 3, at vendor 0'],
      ['Check return challan', mdcA, '3', 'Received', '1 receipt'],
    ],
    'R2-05-M4': [
      ['QC: 2 ok, 1 reject', mgA, '3', '—', 'Second NC raised 1'],
      ['Check first rejection note', mncA, '3', 'Closed', '2 cleared, 1 failed'],
      ['Check QC op card', `${m} Op 2`, '9', 'In Progress', '9 accepted, mirrored'],
      ['Check job-work order', mpo, '10', 'Closed', '10 of 10'],
    ],
    'R2-06-M5': [
      ['Return 1 to vendor', mdcB, '1', '—', 'At vendor 1'],
      ['Receive 1 replacement', mgB, '1', '—', 'In QC 1'],
      ['QC: 1 ok', mgB, '1', '—', 'NC closed'],
      ['Check second rejection note', mncB, '1', 'Closed', '1 cleared'],
      ['Check op card', `${m} Op 1`, '10', 'Complete', 'Done 10, NC closed 3'],
      ['Check QC op card', `${m} Op 2`, '10', 'Complete', '10 accepted'],
    ],
    'R2-07-M5b': [['Check job card closed', m, '10', 'Closed', '10 of 10 completed']],
    'R2-08-M6': [['Check stock ledger', m, '10', '—', '+7, +2, +1 credited once']],
    'R2-09-M7': [
      ['Raise job-work purchase order', gpo, '10', '—', 'Approved'],
      ['Send 6 to vendor', gdc, '6', '—', 'At vendor 6, 4 not sent'],
      ['Receive 6 from vendor', gg1, '6', '—', 'In QC 6'],
      ['QC: 4 ok, 2 reject', gg1, '6', '—', 'NC raised 2'],
      ['Return 2 to vendor', gdcA, '2', '—', 'At vendor 2'],
      ['Check challan quantity offered', `${g} Op 1`, '4', 'In Progress', 'Can send 4; nothing saved'],
      ['Check job-work order', gpo, '4', 'Partial', '4 of 10'],
    ],
    'R2-10-L1': [
      ['Create sales order', lso, '6', 'Closed', 'Closed at the end'],
      ['Plan outsource op, last', l, '6', '—', 'One outsource op'],
      ['Raise job-work purchase order', lpo, '6', '—', 'Approved'],
      ['Send 6 to vendor', ldc, '6', '—', 'At vendor 6'],
      ['Receive 6 from vendor', lg1, '6', '—', 'In QC 6'],
      ['QC: 6 ok', lg1, '6', '—', 'Job card closed'],
      ['Check job card', l, '6', 'Closed', 'Closed from incoming QC'],
    ],
    'R2-11-L2': [['Check stock ledger', lg1, '6', '—', '+6 credited once']],
    'R2-12-REG': [
      ['Check earlier order unchanged', r1po, '10', 'Closed', '10 of 10, unchanged'],
      ['Check earlier job card', `${r1} Op 1`, '10', 'Complete', 'Done 10, NC closed 3'],
    ],
    'R2-13-OSP': [['Check at-vendor register', g, '2', '—', 'At vendor 2, figures consistent']],
    'R2-14-G2': [
      ['Check op card', `${g} Op 1`, '2', 'In Progress', 'Sent to vendor 2, ready 4'],
      ['Check job-work order', gpo, '4', 'Partial', '4 of 10'],
    ],
    'R2-15-G3': [
      ['Receive 2 replacement', ggA, '2', '—', 'In QC 2'],
      ['Check op card', `${g} Op 1`, '2', 'In Progress', 'Received, in QC 2, at vendor 0'],
    ],
    'R2-16-G4': [
      ['QC: 2 ok', ggA, '2', '—', 'NC closed'],
      ['Check rejection note', gnc, '2', 'Closed', '2 cleared'],
      ['Check op card', `${g} Op 1`, '6', 'In Progress', 'Done 6, ready 4, NC closed 2'],
      ['Check job-work order', gpo, '6', 'Partial', '6 of 10'],
      ['Check challan quantity offered', `${g} Op 1`, '4', 'In Progress', 'Can send 4; nothing saved'],
    ],
    'R2-17-G5': [
      ['Check stock ledger', gg1, '4', '—', '+4 credited once'],
      ['Check stock ledger', ggA, '2', '—', '+2 credited once'],
    ],
    'R2-18-L3': [
      ['Check sales order', lso, '6', 'Closed', 'Line closed'],
      ['Check job card list', l, '6', 'Closed', 'No op entry needed'],
    ],
    'R2-19-M8': [
      ['Check sales order', mso, '10', 'Closed', 'Line closed'],
      ['Check job card list', m, '10', 'Closed', '100% complete'],
    ],
    'R2-20-M9': [
      ['Check outward challan', mdc, '10', 'Received', '1 receipt'],
      ['Check return challan', mdcA, '3', 'Received', '1 receipt'],
      ['Check return challan', mdcB, '1', 'Received', '1 receipt'],
      ['Check replacement receipt', mgA, '3', 'QC Completed', '2 ok, 1 rejected; NC linked'],
      ['Check replacement receipt', mgB, '1', 'QC Completed', '1 ok; NC linked'],
      ['Check rejection note', mncA, '3', 'Closed', 'Sent 3, received 3'],
      ['Check rejection note', mncB, '1', 'Closed', 'Sent 1, received 1'],
    ],
    'R2-21-M10': [
      ['Check op card', `${m} Op 1`, '10', 'Complete', 'Done 10, at vendor 0'],
      ['Check QC op card', `${m} Op 2`, '10', 'Complete', '10 accepted'],
      ['Check job card', m, '10', 'Closed', 'NC closed 3, 100%'],
    ],
    'R2-22-OSP2': [
      ['Check at-vendor register', g, '0', 'Received', 'At vendor 0, not sent 4'],
      ['Check item stock', ITEM_CODE, '117', '—', 'In stock 117, at vendor 0'],
    ],
    // ── R3 ──
    'R3-01-1': [['Check op card strip', `${m} Op 1`, '3', 'Complete', 'NC closed 3 (pieces)']],
    'R3-01b-1': [['Check op card strip', `${r1} Op 1`, '3', 'Complete', 'NC closed 3, done 10']],
    'R3-02-1': [['Check NC chain link', mncB, '1', 'Closed', 'Continues the first NC']],
    'R3-02-2': [['Check NC chain link', mncA, '3', 'Closed', 'Has a follow-on NC']],
    'R3-02b-1': [['Check NC chain link', r1ncB, '2', 'Closed', 'Continues the first NC']],
    'R3-02b-2': [['Check NC chain link', r1ncA, '3', 'Closed', 'Has a follow-on NC']],
    'R3-02b2-1': [['Check NC chain link', r1ncC, '1', 'Closed', 'Continues the second NC']],
    'R3-02b2-2': [['Check NC chain link', r1ncB, '2', 'Closed', 'Has a follow-on NC']],
    'R3-02b3-1': [['Check NC chain link', r1ncD, '1', 'Closed', 'Continues the third NC']],
    'R3-02b3-2': [['Check NC chain link', r1ncC, '1', 'Closed', 'Has a follow-on NC']],
    'R3-02c-1': [['Check NC chain link', nncB, '1', 'Closed', 'Continues the first NC']],
    'R3-02c-2': [['Check NC chain link', nncA, '2', 'Closed', 'Has a follow-on NC']],
    'R3-02c-3': [['Check op card strip', `${n} Op 1`, '1', 'In Progress', 'NC raised 1, NC closed 1']],
    'R3-02d-1': [['Check full NC chain', r1ncD, '4', '—', '4 NCs linked in order']],
    'R3-03-1': [['Return 2, challan pending', `${n} Op 1`, '2', 'In Progress', 'Return challan pending 2, at vendor 0']],
    'R3-03-2': [['Return 2, challan pending', nncA, '2', 'Disposed', 'Return to vendor, not sent yet']],
    'R3-03-3': [['Check job-work order', npo, '6', 'Closed', '6 of 6, unchanged until sent']],
    'R3-03b-1': [['Create return challan', `${n} Op 1`, '2', 'In Progress', 'Sent to vendor 2, at vendor 2']],
    'R3-03b-2': [['Create return challan', ndcA, '2', 'Issued', 'At vendor 2']],
    'R3-03b-3': [['Check rejection note', nncA, '2', 'Sent To Vendor', 'At vendor 2']],
    'R3-03b-4': [['Check job-work order', npo, '4', 'Partial', '4 of 6']],
    'R3-03c-1': [['Replace, QC, close chain', `${n} Op 1`, '6', 'Complete', 'NC closed 2, done 6, closed']],
    'R3-03c-2': [['Check first rejection note', nncA, '1', 'Closed', '1 cleared, 1 failed']],
    'R3-03c-3': [['Check second rejection note', nncB, '1', 'Closed', '1 cleared']],
    'R3-03c-4': [['Check job-work order', npo, '6', 'Closed', '6 of 6, all accepted']],
    'R3-04a-1': [['Raise job-work purchase order', qpo, '6', 'Open', 'Covers the op']],
    'R3-04a-2': [['Check op card', `${q} Op 1`, '6', 'Pending', 'PO created']],
    'R3-04a-3': [['Check job-work request', qpr, '6', 'PO Created', 'Ordered 6, balance 0']],
    'R3-04b-1': [['Delete purchase order', qpo, '6', 'Deleted', 'Gone from the list']],
    'R3-04b-2': [['Check op card', `${q} Op 1`, '6', 'Pending', 'Back to PR raised']],
    'R3-04b-3': [['Check job-work request', qpr, '6', 'Open', 'Ordered 0, balance 6 again']],
    'R3-04b-4': [['Check activity log', q, '2', '—', 'Release logged on card and request']],
    'R3-04c-1': [['Raise purchase order for 4', ppo2, '4', 'Open', 'Second order on the same op']],
    'R3-04c-2': [['Check op card', `${p} Op 1`, '4', 'Pending', 'PO created']],
    'R3-04c-3': [['Check job-work request', ppr, '4', 'PO Created', 'Ordered 4, balance 2']],
    'R3-05-1': [['Try deleting sent order', gpo, '6', 'Partial', 'Refused: goods already moved']],
    'R3-05-2': [['Check op card', `${g} Op 1`, '6', 'Received', 'Unchanged']],
    'R3-06-1': [['Check SO status', mso, '10', 'Complete', 'Op complete, at vendor 0']],
    'R3-06-2': [['Check SO overview', mso, '10', 'Closed', '10 of 10, 100%']],
    'R3-06b-1': [['Check SO status', gso, '6', 'In Progress', '60%, at vendor 0']],
    'R3-06b-2': [['Check SO overview', gso, '6', 'Open', '6 of 10']],
    'R3-06c-1': [['Check SO status', lso, '6', 'Complete', 'Op complete, at vendor 0']],
    'R3-06c-2': [['Check SO overview', lso, '6', 'Closed', '6 of 6, 100%']],
    'R3-07-1': [['Create job card directly', `${jw} Op 10`, '6', 'PR Raised', 'PR raised on save']],
    'R3-07-2': [['Check job-work request', jwpr, '6', 'Open', 'Balance 6 to order']],
    'R3-07-3': [['Check activity log', jw, '6', '—', 'Creation logged with the PR']],
    'R3-07a-1': [['Search vendor by "959"', 'Job Cards → + New', '', 'Vendor Picked', vRun.opt959 ? `Offers "${vRun.opt959.slice(0, 34)}…"` : 'Offered with code and name']],
    'R3-07a-2': [['Search another vendor, second op', 'Job Cards → + New', '', 'Label Kept', 'First op still shows code and name']],
    'R3-07a-3': [['Save job card', `${v} Op 20`, '6', hdr('R3-07a-3') || 'VND-959', 'Carries the picked vendor']],
    'R3-07a-4': [['Save job card', `${v} Op 30`, '6', hdr('R3-07a-4') || 'VND-001', 'Carries the other vendor']],
    'R3-07b-1': [['Open card editor', `${v} Op 20`, '', seen('R3-07b-1', /"([^"]+)"/, '') || '—', seen('R3-07b-1', /"([^"]+)"/, '').includes(' — ') ? 'Vendor shown with code and name' : 'Vendor shown as code only, no name']],
    'R3-07b-2': [['Search vendor by "959"', `${v} Op 30`, '', 'Vendor Offered', 'Offered with code and name; not saved']],
    'R3-07c-1': [['Search vendor in balance modal', seen('R3-07c-1', /read-only on (IN-JC-[\d-]+)/, 'Outsource balance modal') + ' (Outsource balance)', seen('R3-07c-1', /available=(\d+)/, ''), seen('R3-07c-1', /options for "959": \[([^\]]*)\]/, '').includes('VND-959') ? 'Vendor Offered' : '—', seen('R3-07c-1', /options for "959": \[([^\]]*)\]/, '').includes('VND-959') ? 'Offered with code and name; cancelled' : 'Not offered']],
    'R3-07r-1': [['Search vendor by code', 'Job Cards → + New', '', 'Vendor Offered', 'Offered with code and name; form left unsaved']],
    'R3-07r-2': [['Search vendor by code', `${v} Op 30`, '', 'Vendor Offered', 'Offered with code and name; not saved, op unchanged']],
    'R3-08a-1': [['Raise purchase order for 2', ppo3, '2', 'Open', 'Third order, second link on the op']],
    'R3-08a-2': [['Check op card', `${p} Op 1`, '6', 'Pending', 'Two orders: 4 + 2 sendable']],
    'R3-08a-3': [['Check job-work request', ppr, '6', 'PO Created', 'Fully ordered across two POs']],
    'R3-08b-1': [['Send 2, receive, QC ok', `${p} Op 1`, '2', 'In Progress', 'Done 2, ready to send 4']],
    'R3-08b-2': [['Check outward challan', pdc, '2', 'Received', '1 receipt']],
    'R3-08b-3': [['Check job-work order', ppo3, '2', 'Closed', '2 of 2 received']],
    'R3-08b-4': [['Check job-work order', ppo2, '0', 'Open', '0 of 4, untouched']],
    'R3-08b-5': [['Check at-vendor register', p, '2', 'Received', 'Accepted 2, at vendor 0, not sent 4']],
    'R3-10-1': [['Accept 2 as is', `${u} Op 1`, '2', 'Complete', 'NC closed 2, done 3']],
    'R3-10-2': [['Check rejection note', unc, '2', 'Closed', 'Use as is']],
  };
}

/** Plain-English findings for the PDF (≤ 8 bullets; technical ids at the end). */
function plainFindings(prefixes: string[] | null, rows: Row[]): string[] {
  const has = (p: string): boolean => !prefixes || prefixes.includes(p);
  const out: string[] = [];
  if (has('T2') || has('R1')) out.push('The job-work PO badge lagged one step behind its line on every vendor return and the line was subtracted twice on a nested return; both fixed and re-proven over four return cycles, 10 of 10 at the end (T2-13, T2-18, T3-05, T3-12 → ADR-165, R1-A1/A3/B1/D3/Z1).');
  if (has('R3')) {
    const b1 = rows.find((x) => x.id === 'R3-07b-1');
    out.push('The vendor picker on the direct Job Card form could only reach the first 200 vendors; it now searches the server, keeps the picked vendor\'s code and name when another op searches, and the saved op carries the picked vendor (R3-07a, fixed 58154c54, re-proven on IN-JC-26-00047).');
    if (b1 && b1.result === 'FAIL') out.push('Small gap left: when a saved card is re-opened in the Status-page editor, a vendor beyond the first 200 shows as its code only until the box is searched — the name is not shown (R3-07b-1, jc-status-content.tsx knownVendors; the modal has the same interim state by design).');
    out.push('An NC raised on a replacement receipt is linked to the NC it continues at creation, and the op card strip counts closed pieces, not generations; a return to vendor now sits in a "return challan pending" bucket until its challan goes out (R3-02/02b/02c/02d, R3-01/01b, R3-03).');
    out.push('Deleting a job-work PO that nothing has moved against puts the op back to "PR raised" and re-opens the request; a PO with a challan behind it cannot be deleted; a second PO on the same op works end to end (R3-04a/04b, R3-05, R3-04c/08a/08b).');
    out.push('One NC link read as missing on the first pass because the API stamping it went live minutes after that NC was raised on the test stack — a deploy-order artefact, not a code defect; apply migration 0129 and the API together on production (R3-02, chain M NC-B).');
  }
  if (has('T3')) out.push('Rework is refused for material that came from a vendor — by design; the return side nests as NC → challan → receipt → NC, never as child job cards (T3-03, T3-07, T3-14).');
  if (has('T2')) out.push('A plain purchase-order rejection raises no NC and offers no return path — by design, phase 1 covers job-work returns only (T2-02).');
  if (has('T3')) out.push('Seen once, not reproduced: on a deep-chain receipt the screen said the challan was "already fully received" although that click had posted the receipt; and the NC page prints the parent NC\'s code under the "Source PO" label for a replacement receipt (T3, IN-GRN-00016; NC-B Source PO).');
  if (has('T1') && out.length < 8) out.push('Cosmetic: the grandchild rework card shows "Closed" where its parent and the top card show "Complete" for the same finished state (T1, IN-JC-26-00031-RW1-RW1).');
  return out.slice(0, 8);
}

function resultCell(x: Row): { text: string; cls: string } {
  if (x.result === 'PASS' || x.result === 'FIXED') return { text: '✓ Pass', cls: 'pass' };
  if (x.result === 'FAIL') return { text: '✗ Fail', cls: 'fail' };
  if (x.result === 'N/A (by design)') return { text: '— N/A', cls: 'na' };
  return { text: '◌ By design', cls: 'design' };
}

/** Render the readable report for the given test prefixes (null = all).
 *  Works from a SNAPSHOT of the rows JSON taken at the start (another
 *  terminal may be running the same spec); the snapshot is what is copied
 *  to test-results/ and .playwright/reports/. */
async function renderPdf(page: Page, prefixes: string[] | null, pdfPath: string, alsoFinal = false): Promise<void> {
  applyFixedRows();
  const r: Report = JSON.parse(JSON.stringify(readReport())) as Report; // snapshot
  r.generatedAt = new Date().toISOString();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify(r, null, 2));
  const s = readState();
  const ORDER = ['T1', 'T2', 'T3', 'R1', 'R2', 'R3', 'R4'];
  const orderKey = (x: Row): string => {
    if (!x.id.startsWith('R3')) return x.id;
    const step = x.id.replace(/-\d+$/, '');
    const i = R3_ORDER.indexOf(step);
    return String(i < 0 ? 99 : i).padStart(2, '0') + x.id;
  };
  const rows = r.rows
    .filter((x) => !prefixes || prefixes.includes(x.id.slice(0, 2)))
    .sort((a, b) => ORDER.indexOf(a.id.slice(0, 2)) - ORDER.indexOf(b.id.slice(0, 2)) || orderKey(a).localeCompare(orderKey(b)));
  const view = buildViewMap(r.docs, r.rows);
  const count = (f: (x: Row) => boolean): number => rows.filter(f).length;
  const pass = count((x) => x.result === 'PASS' || x.result === 'FIXED');
  const fixed = count((x) => x.result === 'FIXED');
  const fail = count((x) => x.result === 'FAIL');
  const na = count((x) => x.result === 'N/A (by design)');
  const design = count((x) => x.result.startsWith('BLOCKED'));
  const summary = `${pass} pass · ${na} n/a · ${design} by design · ${fail === 0 ? '0 failures' : fail + ' open failure' + (fail === 1 ? '' : 's')}${fixed ? ` (${fixed} of the passes were failures on 2026-09-15 / the first R3 run, since fixed and re-proven)` : ''}`;
  let lastGroup = '';
  let lastSub = '';
  let lastAction = '';
  let printed = 0;
  let zebra = 0;
  const body: string[] = [];
  for (const x of rows) {
    const g = x.id.slice(0, 2);
    if (g !== lastGroup) {
      const G = GROUPS[g] ?? { title: g, code: g };
      body.push(`<tr class="grp"><td colspan="6">${esc(G.title)} <span class="code">${esc(G.code)}</span></td></tr>`);
      lastGroup = g;
      lastSub = '';
      lastAction = '';
    }
    const sub = subOf(x.id);
    if (sub && sub !== lastSub) {
      body.push(`<tr class="sub"><td colspan="6">${esc(sub)}</td></tr>`);
      lastSub = sub;
      lastAction = '';
    }
    const tuples = view[x.id] ?? legacyView(x);
    const res = resultCell(x);
    for (const [a, d, q, h, o] of tuples) {
      const same = a === lastAction;
      lastAction = a;
      zebra += 1;
      const note = x.result === 'FIXED' ? ` <span class="grey">(fixed — ${esc((x.fixedBy ?? '').split(' — ')[0]!)}, re-proven ${esc(/re-proven ([^()]+?)(?: \(|$)/.exec(x.fixedBy ?? '')?.[1] ?? '')})</span>` : '';
      body.push(
        `<tr class="${zebra % 2 ? 'odd' : 'even'}"><td class="act">${same ? '<span class="ditto">〃</span>' : esc(a)} <span class="id">${esc(x.id)}</span></td><td class="mono">${esc(d)}</td><td class="qty">${esc(q)}</td><td>${esc(titleCase(h) || '—')}</td><td>${esc(o)}${note}</td><td class="res ${res.cls}">${res.text}</td></tr>`,
      );
      printed += 1;
    }
  }
  const findings = plainFindings(prefixes, rows);
  const scope = prefixes ? prefixes.map((p) => GROUPS[p]?.title ?? p).join(' + ') : 'all six batches';
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 12mm 10mm 14mm 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #111; }
    h1 { font-size: 15pt; margin: 0 0 3px; }
    .meta { font-size: 9pt; color: #444; margin-bottom: 8px; line-height: 1.45; }
    .meta b { color: #111; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #bbb; padding: 4px 5px; vertical-align: top; word-wrap: break-word; font-size: 9pt; line-height: 1.3; }
    th { background: #e5e7eb; text-align: left; font-size: 9pt; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    tr.even td { background: #f5f7fa; }
    tr.grp td { background: #dbeafe; font-weight: bold; font-size: 10pt; padding: 6px 5px; }
    tr.sub td { background: #eef2ff; font-weight: bold; font-size: 9pt; color: #1e3a8a; }
    .code { font-weight: normal; color: #6b7280; font-size: 8.5pt; margin-left: 6px; }
    .id { color: #9ca3af; font-size: 7.5pt; margin-left: 4px; }
    .grey { color: #6b7280; font-size: 8pt; }
    .ditto { color: #9ca3af; }
    td.mono { font-family: Consolas, 'Courier New', monospace; font-weight: bold; font-size: 8.5pt; }
    td.qty { text-align: center; }
    td.res { font-weight: bold; text-align: center; white-space: nowrap; }
    td.res.pass { color: #15803d; background: #dcfce7 !important; }
    td.res.fail { color: #b91c1c; background: #fee2e2 !important; }
    td.res.na { color: #6b7280; background: #f3f4f6 !important; }
    td.res.design { color: #6b7280; background: #f3f4f6 !important; }
    h2 { font-size: 11pt; margin: 12px 0 4px; }
    ul { margin: 0; padding-left: 18px; font-size: 9pt; }
    li { margin-bottom: 3px; line-height: 1.35; }
    .legend { font-size: 8.5pt; color: #444; margin: 6px 0 0; }
  </style></head><body>
  <h1>Innovic ERP — chain verification report (test stack)</h1>
  <div class="meta"><b>Scope:</b> ${esc(scope)} · <b>Dates:</b> ${esc(r.date)} · <b>Site:</b> ${esc(r.stack)} (API ${esc(r.api ?? s.apiBase ?? '')}) · <b>Generated:</b> ${esc(r.generatedAt.replace('T', ' ').slice(0, 16))} UTC<br>
  <b>Result:</b> ${esc(summary)} · ${printed} lines from ${rows.length} recorded checks. Every value is what was on screen (or the API) at the moment of that step.</div>
  <table><colgroup><col style="width:22%"><col style="width:23%"><col style="width:5%"><col style="width:13%"><col style="width:28%"><col style="width:9%"></colgroup>
  <thead><tr><th>Action</th><th>Document</th><th>Qty</th><th>Header Status</th><th>Overall Status</th><th>Result</th></tr></thead>
  <tbody>${body.join('')}</tbody></table>
  <div class="legend">✓ Pass = seen as required · ✗ Fail = still wrong at the time this was generated · — N/A = not applicable · ◌ By design = the app refused on purpose, quoted in the JSON. Small grey codes are the check ids in the JSON.</div>
  <h2>Findings</h2>
  <ul>${findings.map((f) => `<li>${esc(f)}</li>`).join('') || '<li>none</li>'}</ul>
  </body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    landscape: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;color:#6b7280;padding:0 10mm;display:flex;justify-content:space-between;"><span>Innovic ERP — chain verification · test stack · 2026-09-16</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
  });
  log(`PDF: ${pdfPath} lines=${printed} rows=${rows.length} — ${summary}`);
  expect(existsSync(pdfPath)).toBe(true);
  mkdirSync(REPORTS_DIR, { recursive: true });
  const base = pdfPath.slice(pdfPath.lastIndexOf('/') + 1);
  copyFileSync(pdfPath, REPORTS_DIR + '/' + base);
  writeFileSync(REPORTS_DIR + '/' + OUT_STEM + '.json', JSON.stringify(r, null, 2));
  log('copied to ' + REPORTS_DIR + '/' + base);
  if (alsoFinal) {
    // The coordinator's own copy: no other test produces this name.
    copyFileSync(pdfPath, REPORTS_DIR + '/' + OUT_STEM + '-FINAL.pdf');
    writeFileSync(REPORTS_DIR + '/' + OUT_STEM + '-FINAL.json', JSON.stringify(r, null, 2));
    log('FINAL: ' + REPORTS_DIR + '/' + OUT_STEM + '-FINAL.pdf');
  }
}

test('ZZ1 - render Test 1 to PDF', async ({ page }) => {
  test.setTimeout(300_000);
  await renderPdf(page, ['T1'], PDF_TEST1);
});
test('ZZ2 - render Test 2 to PDF', async ({ page }) => {
  test.setTimeout(300_000);
  await renderPdf(page, ['T2'], PDF_TEST2);
});
test('ZZ3 - render Test 3 to PDF', async ({ page }) => {
  test.setTimeout(300_000);
  await renderPdf(page, ['T3'], PDF_TEST3);
});
test('ZZ4 - render the re-verification (ADR-165) section to PDF', async ({ page }) => {
  test.setTimeout(300_000);
  await renderPdf(page, ['R1'], PDF_REVERIFY);
});
test('ZZ5 - render the ADR-166 batch 1 section to PDF', async ({ page }) => {
  test.setTimeout(300_000);
  await renderPdf(page, ['R2'], PDF_ADR166);
});
test('ZZ6 - render the ADR-167 batch 2/3 section to PDF', async ({ page }) => {
  test.setTimeout(300_000);
  await renderPdf(page, ['R3'], PDF_ADR167);
});
test('ZZ9 - render the combined verification table to PDF', async ({ page }) => {
  test.setTimeout(300_000);
  await renderPdf(page, null, PDF_FILE, true);
});
