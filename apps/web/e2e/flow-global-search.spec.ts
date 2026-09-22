// Global Search v3 — POPUP (1c26de51) — READ-ONLY verification against the TEST stack.
//
// The header box (components/shared/global-search.tsx) opens the results in a
// full-window popup under the top bar (modules/search/components/
// search-popup.tsx → search-results.tsx → results-table.tsx): `.overlay
// .gs-overlay` > `.modal[role=dialog]` with a "Search — “term”" header, the
// summary line, a StatStrip of per-kind counts and the 7-column table
// Date | Type | Doc No. | Party | Particulars | Qty | Status (Particulars one
// block line per linked doc / item). The URL never changes on typing; Enter
// opens at once; ✕ / backdrop close and keep the text; Escape closes and
// clears; a row click opens the document (detail page or host register) and
// closes. `/search?q=` still works as a deep link (page layout).
//
// Uses the standing E2E_ fixture (apps/web/e2e/FIXTURES.md): PR IN-PR-00001,
// PO IN-PO-00003, OSP DC IN-DC-00002, vendor VND-959; existing DSP-0001 /
// CAPA-0001 are only opened. Nothing is created, edited or deleted.
//
// Run from apps/web:
//   npx playwright test -c playwright.pages.config.ts e2e/flow-global-search.spec.ts
import { type Locator, type Page, expect, test } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE ?? 'https://api-test-production-19ca.up.railway.app';
const PR_CODE = 'IN-PR-00001';
const PO_CODE = 'IN-PO-00003';
const DC_CODE = 'IN-DC-00002';
const VENDOR_CODE = 'VND-959';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^—$/;
const HEADERS = ['Date', 'Type', 'Doc No.', 'Party', 'Particulars', 'Qty', 'Status'];
/** A list page to open the popup over (any authenticated page works). */
const HOST_PAGE = '/purchase-requests';

// Kinds without a detail page (lib/global-search.ts LANDINGS) and where each lands.
const REGISTER_KINDS: Record<string, { to: string; params: (docNo: string, id: string) => Record<string, string> }> = {
  'customer-dispatch': { to: '/customer-dispatches', params: (d) => ({ tab: 'so', search: d }) },
  'jw-return': { to: '/customer-dispatches', params: (d) => ({ tab: 'jw', search: d }) },
  'jw-invoice': { to: '/invoices', params: (d) => ({ tab: 'jw', search: d }) },
  capa: { to: '/nc-register', params: (d) => ({ tab: 'capa', capa: d }) },
  'store-issue': { to: '/issue-register', params: (d) => ({ tab: 'items', search: d }) },
  'tool-issue': { to: '/issue-register', params: (d) => ({ tab: 'tools', search: d }) },
  'party-grn': { to: '/party-grn', params: (d) => ({ tab: 'receive', search: d }) },
  'party-material-issue': { to: '/party-grn', params: (d) => ({ tab: 'issue', search: d }) },
  'jw-dc-inward': { to: '/jw-dc', params: (d) => ({ tab: 'inward', search: d }) },
  task: { to: '/task-board', params: (_d, id) => ({ task: id }) },
  'design-tracker': { to: '/design-tracker', params: (d) => ({ search: d }) },
};

interface Row {
  kind: string;
  id: string;
  docNo: string;
  date: string | null;
  party: string | null;
  lines: string[];
  qty: string | null;
  status: string | null;
  hit: string | null;
}
interface Resp {
  items: Row[];
  truncated: boolean;
  counts: Record<string, number>;
}

// ── Locators ────────────────────────────────────────────────────────────────
type Scope = Page | Locator;
const box = (page: Page): Locator => page.locator('input.innovic-input.gs-input[aria-label="Search anything"]');
const overlay = (page: Page): Locator => page.locator('.overlay.gs-overlay');
const modal = (page: Page): Locator => overlay(page).locator('.modal[role="dialog"]');
const table = (s: Scope): Locator => s.locator('.gs-results table.innovic-table');
/** Result rows only — state rows (Searching… / No results) carry no title. */
const rows = (s: Scope): Locator => table(s).locator('tbody tr[title]');
const docNoOf = (row: Locator): Locator => row.locator('td').nth(2).locator('span.mono.fw-700');
/** `filter({ has })` inner locators must be page-rooted — one built from the
 *  modal locator is evaluated as a chain (modal >> x) relative to the row and
 *  never matches. */
const pageOf = (s: Scope): Page => (typeof (s as Locator).page === 'function' ? (s as Locator).page() : (s as Page));
const rowByDocNo = (s: Scope, docNo: string): Locator =>
  rows(s).filter({ has: pageOf(s).locator('span.mono.fw-700', { hasText: new RegExp('^' + docNo.replace(/[/.]/g, '\\$&') + '$') }) });
const stripButton = (s: Scope, label: string): Locator =>
  s.locator('div.panel button').filter({ has: pageOf(s).locator('div', { hasText: new RegExp('^' + label + '$') }) });
const stripCount = async (s: Scope, label: string): Promise<number> =>
  Number((await stripButton(s, label).locator('div.mono.fw-700').textContent())?.trim());

async function gotoPage(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(box(page)).toBeVisible({ timeout: 30_000 });
}
/** Type a term in the header box and wait for the popup with its header. */
async function openPopup(page: Page, term: string): Promise<number> {
  const input = box(page);
  await input.click();
  const t0 = Date.now();
  await input.fill(term);
  await expect(overlay(page)).toBeVisible({ timeout: 3_000 });
  const ms = Date.now() - t0;
  await expect(modal(page).locator('.modal-hdr')).toContainText(`Search — “${term}”`);
  return ms;
}
async function waitRows(s: Scope): Promise<void> {
  await expect(rows(s).first()).toBeVisible({ timeout: 20_000 });
}
async function isBoxActive(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.classList.contains('gs-input') === true);
}

/** The Supabase access token from the storage state auth.setup.ts saved. */
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
async function api(page: Page, q: string, kind?: string): Promise<{ status: number; json: Resp | null }> {
  const res = await page.request.get(
    API_BASE + '/global-search?' + new URLSearchParams({ q, ...(kind ? { kind } : {}) }).toString(),
    { headers: { authorization: 'Bearer ' + (await bearer(page)) } },
  );
  const status = res.status();
  return { status, json: status === 200 ? ((await res.json()) as Resp) : null };
}

async function assertHeaderLayout(page: Page, path: string): Promise<void> {
  const input = box(page);
  await expect(input).toHaveAttribute('placeholder', 'Search anything… (Ctrl+K)');
  const title = page.locator('#topbar #pageTitle');
  const sync = page.locator('#topbar .tb-sync', { hasText: 'SYNCED' });
  await expect(title).toBeVisible();
  await expect(sync).toBeVisible();
  const [t, b, s, bar] = await Promise.all([title.boundingBox(), input.boundingBox(), sync.boundingBox(), page.locator('#topbar').boundingBox()]);
  expect(t && b && s && bar, 'header boxes measurable').toBeTruthy();
  expect(b!.x, `${path}: box right of title`).toBeGreaterThanOrEqual(t!.x + t!.width - 1);
  expect(b!.x + b!.width, `${path}: box left of SYNCED`).toBeLessThanOrEqual(s!.x + 1);
  const offset = b!.x + b!.width / 2 - (bar!.x + bar!.width / 2);
  console.log(`${path}: topbar centre x=${(bar!.x + bar!.width / 2).toFixed(1)}, box centre x=${(b!.x + b!.width / 2).toFixed(1)}, offset=${offset.toFixed(1)} px`);
  expect(Math.abs(offset), `${path}: box centred (±40 px)`).toBeLessThanOrEqual(40);
}

async function noHorizontalScroll(page: Page, label: string): Promise<void> {
  const o = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(o.scrollWidth, `${label}: no horizontal page scrollbar`).toBeLessThanOrEqual(o.clientWidth);
}

test.describe.configure({ mode: 'default' });

test.describe('Global Search v3 — popup under the top bar', () => {
  test.setTimeout(240_000);
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  // ── 0. API contract ──────────────────────────────────────────────────────
  test('0. API returns counts; kind filter narrows items but keeps the same counts', async ({ page }) => {
    test.setTimeout(400_000);
    await gotoPage(page, '/');
    const deadline = Date.now() + 5 * 60_000;
    let r = await api(page, 'IN-PR');
    while (!(r.status === 200 && r.json && typeof r.json.counts === 'object' && r.json.counts !== null) && Date.now() < deadline) {
      console.log('API has no counts yet (status ' + r.status + ') — waiting 20 s');
      await page.waitForTimeout(20_000);
      r = await api(page, 'IN-PR');
    }
    expect(r.status).toBe(200);
    expect(r.json && typeof r.json.counts === 'object' && r.json.counts !== null, 'response has counts').toBe(true);
    const all = r.json!;
    console.log('IN-PR counts: ' + JSON.stringify(all.counts) + ' items=' + all.items.length + ' truncated=' + all.truncated);
    expect(all.counts['purchase-request']).toBeGreaterThanOrEqual(1);
    for (const it of all.items) {
      for (const k of ['kind', 'id', 'docNo', 'date', 'party', 'lines', 'qty', 'status', 'hit']) {
        expect(Object.prototype.hasOwnProperty.call(it, k), `item has "${k}"`).toBe(true);
      }
      expect(Array.isArray(it.lines)).toBe(true);
    }
    const po = await api(page, 'IN-PR', 'purchase-order');
    expect(po.status).toBe(200);
    expect(po.json!.items.length).toBeGreaterThanOrEqual(1);
    expect(po.json!.items.every((i) => i.kind === 'purchase-order')).toBe(true);
    expect(po.json!.counts).toEqual(all.counts);
  });

  // ── 1. Header box opens the popup; URL unchanged; Enter at once; Ctrl+K ──
  test('1. typing opens the popup under the top bar without changing the URL; Enter opens at once; box keeps focus; Ctrl+K', async ({ page }, testInfo) => {
    await gotoPage(page, HOST_PAGE);
    await assertHeaderLayout(page, HOST_PAGE);
    const urlBefore = page.url();

    const ms = await openPopup(page, 'IN-PR');
    console.log('typed "IN-PR" → popup in ' + ms + ' ms');
    expect(ms).toBeLessThan(1_500);
    expect(page.url(), 'URL unchanged').toBe(urlBefore);
    await expect(page).not.toHaveURL(/\/search/);
    await expect(box(page)).toHaveValue('IN-PR');
    expect(await isBoxActive(page), 'box keeps focus').toBe(true);
    await expect(page.locator('.gs-panel')).toHaveCount(0);
    await waitRows(modal(page));
    expect(page.url(), 'URL still unchanged after rows').toBe(urlBefore);

    // Popup sits below the top bar; the box stays visible and focused above it.
    const [bar, m] = await Promise.all([page.locator('#topbar').boundingBox(), modal(page).boundingBox()]);
    console.log('topbar bottom=' + (bar!.y + bar!.height).toFixed(1) + ' popup top=' + m!.y.toFixed(1) + ' popup size=' + m!.width.toFixed(0) + '×' + m!.height.toFixed(0));
    expect(m!.y, 'popup top at/below the topbar bottom').toBeGreaterThanOrEqual(bar!.y + bar!.height - 0.5);
    await expect(box(page)).toBeVisible();
    expect(await isBoxActive(page)).toBe(true);
    await assertHeaderLayout(page, HOST_PAGE + ' (popup open)');

    const shot = testInfo.outputPath('popup-over-list-page.png');
    await page.screenshot({ path: shot });
    console.log('SCREENSHOT popup over ' + HOST_PAGE + ': ' + shot);

    // Escape in the box: closes AND clears.
    await box(page).press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue('');

    // Enter opens at once.
    await box(page).pressSequentially('VND-959');
    const t1 = Date.now();
    await box(page).press('Enter');
    await expect(overlay(page)).toBeVisible({ timeout: 3_000 });
    console.log('Enter → popup in ' + (Date.now() - t1) + ' ms');
    await expect(modal(page).locator('.modal-hdr')).toContainText('Search — “VND-959”');
    expect(page.url()).toBe(urlBefore);
    await box(page).press('Escape');
    await expect(overlay(page)).toHaveCount(0);

    // Ctrl+K focuses from the page.
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await expect(box(page)).not.toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(box(page)).toBeFocused({ timeout: 5_000 });

    // Narrow viewport screenshot (700 px wide).
    await page.setViewportSize({ width: 700, height: 800 });
    await openPopup(page, 'IN-PR');
    await waitRows(modal(page));
    const narrow = testInfo.outputPath('popup-700px.png');
    await page.screenshot({ path: narrow });
    console.log('SCREENSHOT popup at 700px: ' + narrow);
    await box(page).press('Escape');
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  // ── 2. Popup content ─────────────────────────────────────────────────────
  test('2. popup: header, summary, count strip, 7 columns, prefix rank, dates, party/qty/status; table is the only scroller', async ({ page }) => {
    const { json } = await api(page, 'IN-PR');
    const total = Object.values(json!.counts).reduce((s, n) => s + n, 0);
    await gotoPage(page, HOST_PAGE);
    await openPopup(page, 'IN-PR');
    const m = modal(page);
    await waitRows(m);

    await expect(m.locator('.modal-hdr .modal-title')).toHaveText('Search — “IN-PR”');
    await expect(m.getByText(new RegExp(`Results for “IN-PR” — ${total} match`))).toBeVisible();
    await expect(stripButton(m, 'All')).toBeVisible();
    expect(await stripCount(m, 'All')).toBe(total);
    expect(await stripCount(m, 'Purchase Request')).toBe(json!.counts['purchase-request']);
    expect(await stripCount(m, 'Purchase Order')).toBe(json!.counts['purchase-order']);
    const stripLabels = await m.locator('div.panel button > div:first-child').allTextContents();
    console.log('strip: ' + stripLabels.join(' | '));
    expect(stripLabels.length).toBe(1 + Object.values(json!.counts).filter((n) => n > 0).length);

    await expect(table(m).locator('thead th')).toHaveText(HEADERS);
    const n = await rows(m).count();
    expect(n).toBe(json!.items.length);
    const docNos = await rows(m).locator('td:nth-child(3) span.mono.fw-700').allTextContents();
    expect(docNos[0], 'first row is a prefix hit').toMatch(/^IN-PR/);
    const dates = await rows(m).locator('td:nth-child(1)').allTextContents();
    for (const d of dates) expect(d.trim()).toMatch(DATE_RE);
    // Doc No. bold.
    const fw = await docNoOf(rows(m).first()).evaluate((el) => getComputedStyle(el).fontWeight);
    expect(Number(fw), 'Doc No. bold').toBeGreaterThanOrEqual(700);

    const pr = rowByDocNo(m, PR_CODE);
    await expect(pr).toHaveCount(1);
    await expect(pr.locator('td').nth(1)).toHaveText('Purchase Request');
    await expect(pr.locator('td').nth(3)).toContainText('Shreeji');
    expect((await pr.locator('td').nth(5).textContent())?.trim()).toMatch(/^\d+(\.\d+)?$/);
    await expect(pr.locator('td').nth(6).locator('.badge')).toHaveText('po created');

    // One scroller: the .modal itself must not scroll; .tbl-wrap does.
    const sc = await m.evaluate((el) => {
      const wrap = el.querySelector('.tbl-wrap') as HTMLElement;
      return {
        modalScroll: el.scrollHeight,
        modalClient: el.clientHeight,
        wrapScroll: wrap.scrollHeight,
        wrapClient: wrap.clientHeight,
        wrapOverflowY: getComputedStyle(wrap).overflowY,
      };
    });
    console.log('scroller: ' + JSON.stringify(sc));
    expect(sc.modalScroll, '.modal does not scroll').toBeLessThanOrEqual(sc.modalClient + 1);
    console.log('IN-PR rows: ' + n + ' → ' + docNos.join(', '));
  });

  // ── 3. Particulars on separate lines ─────────────────────────────────────
  test('3. Particulars: one block line per linked doc / item (IN-PR-00001, IN-DC-00002)', async ({ page }) => {
    await gotoPage(page, HOST_PAGE);
    await openPopup(page, 'IN-PR');
    const m = modal(page);
    await waitRows(m);
    const prLines = rowByDocNo(m, PR_CODE).locator('td.gs-lines > div');
    const prTexts = (await prLines.allTextContents()).map((s) => s.trim());
    console.log(PR_CODE + ' lines: ' + JSON.stringify(prTexts));
    expect(prTexts.length).toBeGreaterThanOrEqual(2);
    expect(prTexts.some((l) => l.startsWith('PO ') && l.includes(PO_CODE))).toBe(true);
    expect(prTexts.some((l) => l.startsWith('E2E-PRT-001'))).toBe(true);
    await expect(prLines.filter({ hasText: new RegExp('^PO ' + PO_CODE + '$') })).toHaveCount(1);
    await expect(prLines.filter({ hasText: /^E2E-PRT-001 / })).toHaveCount(1);

    await box(page).press('Escape');
    await openPopup(page, DC_CODE);
    await waitRows(m);
    const dc = rowByDocNo(m, DC_CODE);
    await expect(dc).toHaveCount(1);
    await expect(dc.locator('td').nth(1)).toHaveText('OSP DC');
    const dcTexts = (await dc.locator('td.gs-lines > div').allTextContents()).map((s) => s.trim());
    console.log(DC_CODE + ' lines: ' + JSON.stringify(dcTexts));
    expect(dcTexts[0]).toBe('PO ' + PO_CODE);
    expect(dcTexts[1]).toMatch(/^E2E-PRT-001 /);
    expect(dcTexts[2]).toMatch(/^E2E-PRT-002 /);
    expect(dcTexts[3]).toMatch(/^E2E-PRT-003 /);
    expect(dcTexts[4]).toBe('+42 more');
  });

  // ── 4. Search anything ───────────────────────────────────────────────────
  test('4. search anything: an item on line 3, a vendor city (matched: line), a status word', async ({ page }) => {
    const prt = await api(page, 'E2E-PRT-003');
    await gotoPage(page, HOST_PAGE);
    await openPopup(page, 'E2E-PRT-003');
    const m = modal(page);
    await waitRows(m);
    for (const code of [PO_CODE, DC_CODE]) {
      const row = rowByDocNo(m, code);
      await expect(row, code + ' row present').toHaveCount(1);
      await expect(row.locator('td.gs-lines')).toContainText('E2E-PRT-003');
      const apiRow = prt.json!.items.find((i) => i.docNo === code);
      const matched = row.locator('td.gs-lines div', { hasText: /^matched: / });
      if (apiRow?.hit) await expect(matched).toContainText('E2E-PRT-003');
      else {
        await expect(matched).toHaveCount(0);
        expect(await row.locator('td.gs-lines > div', { hasText: /^E2E-PRT-003 / }).count()).toBe(1);
        console.log(code + ': hit=null from the API (item is a visible line) → no "matched:" line, by contract');
      }
    }

    await box(page).press('Escape');
    await openPopup(page, 'Anand');
    await waitRows(m);
    const v = rowByDocNo(m, VENDOR_CODE);
    await expect(v).toHaveCount(1);
    await expect(v.locator('td').nth(1)).toHaveText('Vendor');
    await expect(v.locator('td.gs-lines div.text3', { hasText: /^matched: / })).toContainText('Anand');

    await box(page).press('Escape');
    await openPopup(page, 'closed');
    await waitRows(m);
    const closedRows = rows(m).filter({ has: page.locator('td:nth-child(7) .badge', { hasText: /^closed$/ }) });
    const c = await closedRows.count();
    console.log('"closed": ' + (await rows(m).count()) + ' rows, ' + c + ' with Status badge "closed"');
    expect(c).toBeGreaterThanOrEqual(1);
  });

  // ── 5. Count strip filter (inside the popup, URL untouched) ──────────────
  test('5. strip item filters by kind inside the popup and keeps the strip; click again clears; URL untouched', async ({ page }) => {
    const { json } = await api(page, 'IN-PR');
    await gotoPage(page, HOST_PAGE);
    const urlBefore = page.url();
    await openPopup(page, 'IN-PR');
    const m = modal(page);
    await waitRows(m);
    const prCount = await stripCount(m, 'Purchase Request');

    await stripButton(m, 'Purchase Order').click();
    await expect(m.getByText(/Purchase Order.*only/)).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => (await rows(m).locator('td:nth-child(2)').allTextContents()).map((s) => s.trim()), { timeout: 15_000 })
      .toEqual(new Array(json!.counts['purchase-order']).fill('Purchase Order'));
    await expect(stripButton(m, 'Purchase Request')).toBeVisible();
    expect(await stripCount(m, 'Purchase Request')).toBe(prCount);
    expect(page.url(), 'URL untouched by the filter').toBe(urlBefore);

    await stripButton(m, 'Purchase Order').click();
    await expect(m.getByText(/Purchase Order.*only/)).toHaveCount(0);
    await expect.poll(async () => rows(m).count(), { timeout: 15_000 }).toBe(json!.items.length);
    expect(page.url()).toBe(urlBefore);
  });

  // ── 6. Row click → detail; popup gone; box empty ─────────────────────────
  test('6. row click opens the detail page, closes the popup and empties the box', async ({ page }, testInfo) => {
    await gotoPage(page, HOST_PAGE);
    await openPopup(page, 'IN-PR');
    await waitRows(modal(page));
    await rowByDocNo(modal(page), PR_CODE).click();
    await expect(page).toHaveURL(/\/purchase-requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.getByText(PR_CODE).first()).toBeVisible({ timeout: 20_000 });
    await expect(box(page)).toHaveValue('');
    const shot = testInfo.outputPath('detail-from-popup.png');
    await page.screenshot({ path: shot });
    console.log('SCREENSHOT detail page: ' + shot + ' (' + page.url() + ')');

    await openPopup(page, VENDOR_CODE);
    await waitRows(modal(page));
    await rowByDocNo(modal(page), VENDOR_CODE).click();
    await expect(page).toHaveURL(/\/vendors\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.getByText(VENDOR_CODE).first()).toBeVisible({ timeout: 20_000 });
    await expect(box(page)).toHaveValue('');
  });

  // ── 7. Register landings ─────────────────────────────────────────────────
  test('7. register kinds open their host list filtered to the code; popup gone', async ({ page }, testInfo) => {
    const found: Record<string, Row> = {};
    const missing: string[] = [];
    for (const kind of Object.keys(REGISTER_KINDS)) {
      let hit: Row | undefined;
      for (const q of ['in', '00', 'e', 'a']) {
        const r = await api(page, q, kind);
        hit = r.json?.items[0];
        if (hit) break;
      }
      if (hit) found[kind] = hit;
      else missing.push(kind);
    }
    console.log('register kinds with data: ' + JSON.stringify(Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.docNo]))));
    console.log('register kinds with NO rows on the test DB: ' + missing.join(', '));
    expect(Object.keys(found).length, 'at least one register kind has data').toBeGreaterThan(0);

    let shotDone = false;
    for (const [kind, r] of Object.entries(found)) {
      const spec = REGISTER_KINDS[kind]!;
      await gotoPage(page, HOST_PAGE);
      await openPopup(page, r.docNo);
      const m = modal(page);
      await waitRows(m);
      const row = rowByDocNo(m, r.docNo).first();
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('title', 'Open in its register');
      await row.click();
      await expect(page).toHaveURL(new RegExp(spec.to.replace(/\//g, '\\/') + '\\?'), { timeout: 20_000 });
      await expect(overlay(page)).toHaveCount(0);
      const url = new URL(page.url());
      for (const [k, v] of Object.entries(spec.params(r.docNo, r.id))) expect(url.searchParams.get(k), `${kind}: ?${k}`).toBe(v);
      expect(url.searchParams.has('q'), `${kind}: no ?q leak`).toBe(false);
      await expect(box(page)).toHaveValue('');
      if (kind === 'task') {
        await expect(page.locator('[role=dialog]').first()).toBeVisible({ timeout: 20_000 });
      } else {
        await expect
          .poll(() => page.locator('input').evaluateAll((els, v) => els.some((e) => (e as HTMLInputElement).value === v), r.docNo), {
            timeout: 20_000,
            message: `${kind}: host page search box pre-filled with ${r.docNo}`,
          })
          .toBe(true);
      }
      console.log(`${kind}: ${r.docNo} → ${url.pathname}${url.search}`);
      if (!shotDone) {
        const shot = testInfo.outputPath(`landing-${kind}.png`);
        await page.screenshot({ path: shot });
        console.log('SCREENSHOT landing page: ' + shot);
        shotDone = true;
      }
    }
  });

  // ── 8. Close paths ───────────────────────────────────────────────────────
  test('8. close paths: ✕ and backdrop keep the text and refocus; Escape clears; ✕ within the debounce does not reopen; Enter reopens', async ({ page }) => {
    await gotoPage(page, HOST_PAGE);
    const urlBefore = page.url();

    // ✕
    await openPopup(page, 'IN-PR');
    await waitRows(modal(page));
    await modal(page).getByRole('button', { name: 'Close search results' }).click();
    await expect(overlay(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue('IN-PR');
    await expect.poll(() => isBoxActive(page), { message: 'box focused after ✕' }).toBe(true);

    // Enter reopens after ✕.
    await box(page).press('Enter');
    await expect(overlay(page)).toBeVisible({ timeout: 3_000 });
    await waitRows(modal(page));

    // Backdrop: top-left corner of the overlay, outside .modal.
    const ob = await overlay(page).boundingBox();
    const mb = await modal(page).boundingBox();
    expect(mb!.x).toBeGreaterThan(ob!.x + 2);
    await overlay(page).click({ position: { x: 2, y: 2 } });
    await expect(overlay(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue('IN-PR');
    await expect.poll(() => isBoxActive(page), { message: 'box focused after backdrop click' }).toBe(true);

    // Escape in the box: closed AND empty.
    await box(page).press('Enter');
    await expect(overlay(page)).toBeVisible({ timeout: 3_000 });
    await box(page).press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue('');

    // Enter, then ✕ within the 300 ms debounce: the debounce settling on the
    // same term must NOT reopen the popup.
    await box(page).fill('IN-PR');
    const t0 = Date.now();
    await box(page).press('Enter');
    await expect(overlay(page)).toBeVisible({ timeout: 3_000 });
    await modal(page).getByRole('button', { name: 'Close search results' }).click();
    const closedAt = Date.now() - t0;
    await expect(overlay(page)).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(overlay(page), 'popup stays closed 600 ms after ✕').toHaveCount(0);
    console.log('Enter → ✕ took ' + closedAt + ' ms after the term was set' + (closedAt <= 300 ? ' (inside the debounce)' : ' (after the debounce — reopen guard not exercised)'));
    await expect(box(page)).toHaveValue('IN-PR');
    await box(page).press('Enter');
    await expect(overlay(page)).toBeVisible({ timeout: 3_000 });
    await expect(modal(page).locator('.modal-hdr')).toContainText('Search — “IN-PR”');
    expect(page.url()).toBe(urlBefore);
  });

  // ── 9. Navigation with the popup open ────────────────────────────────────
  test('9. navigating with the popup open closes it (topbar link); what a sidebar click does while the popup is open', async ({ page }) => {
    await gotoPage(page, HOST_PAGE);
    await openPopup(page, 'IN-PR');
    await waitRows(modal(page));
    // The overlay starts under the top bar, so top-bar links stay clickable.
    await page.locator('#topbar').getByRole('link', { name: 'Password' }).click();
    await expect(page).toHaveURL(/\/change-password/, { timeout: 20_000 });
    await expect(overlay(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue('IN-PR');

    // Sidebar: the popup is full-window under the top bar, so the sidebar is
    // behind it. Measure what a click on the Dashboard link actually hits and
    // assert the consistent outcome: reachable → the popup closes on the
    // navigation; covered → the click is swallowed by the popup (no close, no
    // navigation) and the user must close the popup first. Reported either way.
    await gotoPage(page, HOST_PAGE);
    await openPopup(page, 'IN-PR');
    await waitRows(modal(page));
    const dash = page.locator('#sidebar a.sb-item', { hasText: 'Dashboard' }).first();
    const db = await dash.boundingBox();
    expect(db).toBeTruthy();
    const hit = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return { inOverlay: el?.closest('.gs-overlay') !== null, inModal: el?.closest('.gs-overlay .modal') !== null, tag: el?.tagName ?? null };
      },
      { x: db!.x + db!.width / 2, y: db!.y + db!.height / 2 },
    );
    console.log('sidebar Dashboard link at (' + Math.round(db!.x + db!.width / 2) + ',' + Math.round(db!.y + db!.height / 2) + ') is under: ' + JSON.stringify(hit));
    await page.mouse.click(db!.x + db!.width / 2, db!.y + db!.height / 2);
    await page.waitForTimeout(500);
    if (!hit.inOverlay) {
      await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
      await expect(overlay(page)).toHaveCount(0);
      console.log('sidebar link reachable with the popup open → navigation closed the popup');
    } else if (hit.inModal) {
      await expect(overlay(page), 'click swallowed by the popup body').toHaveCount(1);
      expect(page.url()).toContain(HOST_PAGE);
      console.log('SIDEBAR NOT REACHABLE: the popup body covers the sidebar; the click did nothing (popup open, URL unchanged). Close the popup first (✕ / Escape / backdrop).');
      await box(page).press('Escape');
      await expect(overlay(page)).toHaveCount(0);
      await dash.click();
      await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    } else {
      await expect(overlay(page), 'backdrop took the click → popup closed').toHaveCount(0);
      expect(page.url()).toContain(HOST_PAGE);
      console.log('sidebar covered by the BACKDROP: first click closes the popup, second follows the link');
      await dash.click();
      await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    }
  });

  // ── 10. Deep link /search still renders the page layout ──────────────────
  test('10. /search?q=IN-PR deep link keeps the page layout (sticky band + strip + table)', async ({ page }) => {
    await gotoPage(page, '/search?q=IN-PR');
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.locator('.section-hdr', { hasText: /^Search$/ })).toBeVisible();
    await expect(page.getByText(/Results for “IN-PR” — \d+ match/)).toBeVisible({ timeout: 20_000 });
    await expect(stripButton(page, 'Purchase Request')).toBeVisible();
    await expect(table(page).locator('thead th')).toHaveText(HEADERS);
    await waitRows(page);
    const sticky = await page.locator('.section-hdr', { hasText: /^Search$/ }).evaluate((el) => getComputedStyle(el.parentElement!.parentElement!).position);
    expect(sticky).toBe('sticky');
    await noHorizontalScroll(page, '/search?q=IN-PR');
  });

  // ── 11. Guards + stale guard ─────────────────────────────────────────────
  test('11. guards: one letter opens nothing, no results, truncation note follows the API flag; stale guard', async ({ page }) => {
    await gotoPage(page, HOST_PAGE);
    await box(page).click();
    await box(page).fill('I');
    await page.waitForTimeout(600);
    await expect(overlay(page), 'one character opens no popup').toHaveCount(0);

    await box(page).fill('zzqq');
    await expect(overlay(page)).toBeVisible({ timeout: 3_000 });
    await expect(modal(page).getByText('No results for “zzqq”')).toBeVisible({ timeout: 15_000 });
    await expect(rows(modal(page))).toHaveCount(0);

    const heat = await api(page, 'heat');
    await box(page).fill('heat');
    await expect(modal(page).locator('.modal-hdr')).toContainText('Search — “heat”');
    await waitRows(modal(page));
    await expect.poll(() => rows(modal(page)).count(), { timeout: 15_000 }).toBe(heat.json!.items.length);
    const note = modal(page).getByText(/^Showing the first \d+ — narrow it down/);
    console.log('"heat": API items=' + heat.json!.items.length + ' truncated=' + heat.json!.truncated);
    if (heat.json!.truncated) await expect(note).toContainText('Showing the first ' + heat.json!.items.length);
    else await expect(note).toHaveCount(0);

    // Stale guard: IN-PR rows → retype zzqq; once the popup header says zzqq,
    // never an IN-PR row; ends on "No results".
    await box(page).fill('IN-PR');
    await expect(modal(page).locator('.modal-hdr')).toContainText('Search — “IN-PR”');
    await waitRows(modal(page));
    await box(page).fill('zzqq');
    const deadline = Date.now() + 20_000;
    let polls = 0;
    let sawSearching = false;
    for (;;) {
      polls++;
      const st = await page.evaluate(() => {
        const hdr = document.querySelector('.gs-overlay .modal-hdr')?.textContent ?? '';
        const tbody = document.querySelector('.gs-overlay .gs-results tbody');
        const stale = tbody
          ? Array.from(tbody.querySelectorAll('tr[title] td:nth-child(3) span.mono.fw-700')).filter((s) => (s.textContent ?? '').startsWith('IN-PR')).length
          : 0;
        return { hdr, text: tbody?.textContent ?? '', stale };
      });
      if (st.hdr.includes('“zzqq”')) {
        expect(st.stale, `poll ${polls}: no IN-PR row once the term is zzqq`).toBe(0);
        const searching = st.text.includes('Searching…');
        const none = st.text.includes('No results for “zzqq”');
        expect(searching || none, `poll ${polls}: Searching… or No results (got: ${st.text.slice(0, 100)})`).toBe(true);
        if (searching) sawSearching = true;
        if (none) break;
      }
      if (Date.now() > deadline) throw new Error('never reached No results for "zzqq" (' + st.hdr + ' / ' + st.text.slice(0, 100) + ')');
      await page.waitForTimeout(25);
    }
    console.log('stale-guard polls: ' + polls + ', saw "Searching…": ' + sawSearching);
    await expect(rows(modal(page))).toHaveCount(0);
  });

  // ── 12. API gate ─────────────────────────────────────────────────────────
  test('12. API: q too short → 400, no token → 401', async ({ page }) => {
    await gotoPage(page, '/');
    const short = await page.request.get(API_BASE + '/global-search?q=a', { headers: { authorization: 'Bearer ' + (await bearer(page)) } });
    expect(short.status()).toBe(400);
    const anon = await page.request.get(API_BASE + '/global-search?q=ab');
    expect(anon.status()).toBe(401);
  });

  // ── 13. Layout at 1280×800 ───────────────────────────────────────────────
  test('13. no horizontal scrollbar on the page under the popup nor inside the popup; every Doc No. inside the viewport', async ({ page }) => {
    await gotoPage(page, HOST_PAGE);
    await openPopup(page, 'IN-PR');
    await waitRows(modal(page));
    await noHorizontalScroll(page, HOST_PAGE + ' under the popup');
    const m = await modal(page).evaluate((el) => {
      const wrap = el.querySelector('.tbl-wrap') as HTMLElement;
      const spans = Array.from(el.querySelectorAll('tbody tr[title] td:nth-child(3) span.mono.fw-700')) as HTMLElement[];
      return {
        modalScrollW: el.scrollWidth,
        modalClientW: el.clientWidth,
        wrapScrollW: wrap.scrollWidth,
        wrapClientW: wrap.clientWidth,
        vw: window.innerWidth,
        edges: spans.map((s) => ({ l: Math.round(s.getBoundingClientRect().left), r: Math.round(s.getBoundingClientRect().right) })),
      };
    });
    console.log('popup widths: ' + JSON.stringify({ ...m, edges: m.edges.slice(0, 3) }));
    expect(m.modalScrollW, 'popup .modal no sideways scroll').toBeLessThanOrEqual(m.modalClientW + 1);
    expect(m.wrapScrollW, 'popup .tbl-wrap no sideways scroll').toBeLessThanOrEqual(m.wrapClientW + 1);
    expect(m.edges.length).toBeGreaterThan(0);
    for (const e of m.edges) {
      expect(e.l).toBeGreaterThanOrEqual(0);
      expect(e.r).toBeLessThanOrEqual(m.vw);
    }
  });

  // ── 14. Escape on a guarded form ─────────────────────────────────────────
  test('14. Escape with the popup open on a guarded create form closes the popup without the exit-guard prompt', async ({ page }) => {
    await gotoPage(page, '/sales-orders/new');
    await openPopup(page, 'IN-PR');
    const m = modal(page);
    await waitRows(m);
    await stripButton(m, 'All').focus();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(box(page)).toHaveValue('');
    await page.waitForTimeout(400);
    await expect(page.locator('[role=alertdialog]'), 'no exit-guard dialog').toHaveCount(0);
    await expect(page.getByText('Are you sure you want to exit?')).toHaveCount(0);
    await expect(page.locator('.overlay'), 'no overlay of any kind').toHaveCount(0);
    expect(page.url()).toContain('/sales-orders/new');

    // Leave normally; accept the form's own guard if it asks (nothing was entered).
    await page.locator('#topbar').getByRole('link', { name: 'Password' }).click();
    const guard = page.locator('[role=alertdialog]');
    if (await guard.count()) {
      console.log('exit guard asked on leaving /sales-orders/new — accepting (nothing was created)');
      await guard.getByRole('button', { name: 'Exit' }).click();
    }
    await expect(page).toHaveURL(/\/change-password/, { timeout: 20_000 });
  });

  // ── 15. Restricted user ──────────────────────────────────────────────────
  test('15. restricted user does not see kinds outside their department', async ({ browser }) => {
    const email = process.env.E2E_VIEWER_EMAIL ?? process.env.E2E_PURCHASE_EMAIL ?? process.env.E2E_RESTRICTED_EMAIL;
    const password = process.env.E2E_VIEWER_PASSWORD ?? process.env.E2E_PURCHASE_PASSWORD ?? process.env.E2E_RESTRICTED_PASSWORD;
    test.skip(!email || !password, 'no second (non-admin) login in apps/web/.env.e2e — not covered');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Email').fill(email!, { timeout: 30_000 });
      await page.getByLabel('Password', { exact: true }).fill(password!);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
      await openPopup(page, 'IN-SO');
      await expect(modal(page).getByText('Searching…')).toHaveCount(0, { timeout: 15_000 });
      await expect(stripButton(modal(page), 'Sales Order')).toHaveCount(0);
      await expect(rows(modal(page)).filter({ has: page.locator('td', { hasText: /^Sales Order$/ }) })).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
