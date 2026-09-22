// READ-ONLY re-check of the two vendor-box rows (R3-07b-1, R3-07c-1) after
// origin/test a45d3932: on Edit JC an outsource op's vendor past the first 200
// vendor rows (VND-959) must read "VND-959 — E2E_ Shreeji …" on load, before
// the picker is opened; and the "Outsource balance" modal's vendor box must be
// a searchable picker that shows "CODE — Name" once VND-959 is picked.
//
// Nothing is saved: the edit page is left through ESC → exit guard → Exit (or
// its Cancel link), the modal through its own Cancel. Existing cards only —
// no chain is built. Runs against the TEST stack (playwright.pages.config.ts).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

const WEB = 'C:/Innovic_projects/innovic-erp/wt-test/apps/web';
const STATE_FILE = WEB + '/.playwright/erp-chain-report-state.json';
const SHOT_DIR = WEB + '/.playwright/erp-chain-shots';
const OUT_FILE = WEB + '/.playwright/vendor-box-recheck.json';
const VENDOR_CODE = 'VND-959';
const WANT = /^VND-959 — E2E_ Shreeji Precision Heat Treaters Pvt Ltd$/;
// Cards that carry an OSP op on VND-959 (from the 2026-09-16 run), in preference order.
const CANDIDATE_JCS = ['IN-JC-26-00043', 'IN-JC-26-00042', 'IN-JC-26-00039', 'IN-JC-26-00047'];
// The started in-house op the earlier runner used for the modal (read-only there too).
const PREFERRED_MODAL_JC = 'IN-JC-26-00001';

interface Seen {
  [key: string]: unknown;
}
function record(key: string, value: Seen): void {
  mkdirSync(SHOT_DIR, { recursive: true });
  const cur = existsSync(OUT_FILE) ? (JSON.parse(readFileSync(OUT_FILE, 'utf8')) as Seen) : {};
  cur[key] = { ...value, at: new Date().toISOString() };
  writeFileSync(OUT_FILE, JSON.stringify(cur, null, 2));
}

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
function apiBase(): string {
  const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { apiBase?: string };
  if (!s.apiBase) throw new Error('no apiBase in ' + STATE_FILE);
  return s.apiBase;
}
async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(apiBase() + path, { headers: { authorization: 'Bearer ' + (await bearer(page)) } });
  if (res.status() !== 200) throw new Error('GET ' + path + ' -> HTTP ' + res.status() + ' ' + (await res.text()).slice(0, 200));
  return (await res.json()) as T;
}

interface JcListItem { id: string; code: string }
interface JcDetailOp { id: string; opSeq: number; operation: string; opType: string; outsourceVendorCode: string | null; hasStarted: boolean; available: number }

/** First candidate card that has an outsource op on VND-959. */
async function findJcWith959(page: Page): Promise<{ id: string; code: string; op: JcDetailOp }> {
  for (const code of CANDIDATE_JCS) {
    const list = await apiGet<{ items: JcListItem[] }>(page, '/job-cards?search=' + encodeURIComponent(code) + '&limit=20&offset=0');
    const hit = list.items.find((x) => x.code === code);
    if (!hit) continue;
    const detail = await apiGet<{ ops: JcDetailOp[] }>(page, '/job-cards/' + hit.id + '/edit');
    const op = detail.ops.filter((o) => o.opType === 'outsource' && o.outsourceVendorCode === VENDOR_CODE).sort((a, b) => a.opSeq - b.opSeq)[0];
    if (op) return { id: hit.id, code, op };
  }
  throw new Error('none of ' + CANDIDATE_JCS.join(', ') + ' has an outsource op on ' + VENDOR_CODE);
}

/** Read the box as soon as it is visible, then let the label settle (≤ 15 s). */
async function readOnLoad(page: Page, id: string): Promise<{ first: string; settled: string; ms: number }> {
  const box = page.locator('#' + id);
  await box.waitFor({ timeout: 60_000 });
  const t0 = Date.now();
  const first = await box.inputValue();
  let settled = first;
  while (!settled.includes(' — ') && Date.now() - t0 < 15_000) {
    await page.waitForTimeout(500);
    settled = await box.inputValue();
  }
  return { first, settled, ms: Date.now() - t0 };
}

/** Open the picker, type the term, return the option texts and the matching one. */
async function search(page: Page, id: string, term: string): Promise<{ texts: string[]; hit: string }> {
  const box = page.locator('#' + id);
  await box.click();
  await box.fill('');
  await box.fill(term);
  const hit = page.getByRole('option').filter({ hasText: WANT }).first();
  const found = await hit.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
  const texts = (await page.getByRole('option').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  return { texts, hit: found ? (await hit.innerText()).replace(/\s+/g, ' ').trim() : '(no option)' };
}

/** Leave the edit page without saving: ESC → exit guard "Exit"; else its Cancel link. Never hangs. */
async function leaveEdit(page: Page): Promise<string> {
  await page.keyboard.press('Escape');
  const guard = page.getByText('Are you sure you want to exit?');
  const asked = await guard.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true).catch(() => false);
  if (asked) {
    await page.getByRole('button', { name: /^Exit$/ }).click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    return 'ESC → exit guard → Exit';
  }
  const cancel = page.locator('a.btn-ghost').filter({ hasText: /^Cancel$/ }).last();
  if (await cancel.count()) {
    await cancel.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    return 'ESC (no guard) → Cancel link';
  }
  return 'ESC (no guard, no Cancel link)';
}

test('R3-07b-1 recheck — Edit JC: VND-959 op vendor box reads "CODE — Name" on load (Job Cards → Edit, and Status page → Edit Job Card)', async ({ page }) => {
  test.setTimeout(300_000);
  const jc = await findJcWith959(page);
  const boxId = 'jc-edit-vend-' + jc.op.id;
  // Is the a45d3932 bundle live? Its edit page looks the off-page code up by
  // itself (/vendors?search=VND-959). Record every such call and its answer.
  const lookups: string[] = [];
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/vendors?search=' + VENDOR_CODE)) lookups.push(`${res.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
  });

  // (1) Job Cards → Edit
  await page.goto('/job-cards/' + jc.id + '/edit', { waitUntil: 'domcontentloaded' });
  const a = await readOnLoad(page, boxId);
  await page.screenshot({ path: SHOT_DIR + '/R3-07b-recheck-edit.png', fullPage: true }).catch(() => {});
  const opts = await search(page, boxId, '959');
  await page.keyboard.press('Escape'); // closes the option list only
  await page.waitForTimeout(300);
  const afterSearch = await page.locator('#' + boxId).inputValue();
  const leftA = await leaveEdit(page);

  // (2) Job Card Status page → "Edit Job Card" → same op editor
  await page.goto('/job-cards/' + jc.id, { waitUntil: 'domcontentloaded' });
  const editBtn = page.getByRole('link', { name: /Edit Job Card/ }).or(page.getByRole('button', { name: /Edit Job Card/ })).first();
  await editBtn.waitFor({ timeout: 60_000 });
  await editBtn.click();
  const b = await readOnLoad(page, boxId);
  await page.screenshot({ path: SHOT_DIR + '/R3-07b-recheck-status.png', fullPage: true }).catch(() => {});
  const leftB = await leaveEdit(page);

  record('R3-07b-1', {
    jc: jc.code, jcId: jc.id, opSeq: jc.op.opSeq, operation: jc.op.operation, opId: jc.op.id,
    editPage: { onLoadFirstRead: a.first, settled: a.settled, settleMs: a.ms, leftVia: leftA },
    statusPageEdit: { onLoadFirstRead: b.first, settled: b.settled, settleMs: b.ms, leftVia: leftB },
    search959: opts, boxAfterSearchEsc: afterSearch, vendorLookupCalls: lookups,
    pass: WANT.test(a.settled) && WANT.test(b.settled) && WANT.test(opts.hit),
  });
  expect(a.settled, 'Edit page: vendor box on load').toMatch(WANT);
  expect(b.settled, 'Status → Edit Job Card: vendor box on load').toMatch(WANT);
  expect(opts.hit, 'typing "959" offers VND-959').toMatch(WANT);
});

test('R3-07c-1 recheck — started in-house op → "Outsource balance" → vendor picker searches to VND-959 and shows "CODE — Name"; Cancel', async ({ page }) => {
  test.setTimeout(300_000);
  interface BoardOp { jcId: string | null; jcCode: string; opSeq: number; opType: string; status: string; completed: number; available: number; operation: string }
  const board = await apiGet<{ items: BoardOp[] }>(page, '/jc-ops?limit=500&offset=0');
  const cands = board.items.filter((x) => x.opType === 'process' && x.status === 'in_progress' && x.available > 0 && x.jcId);
  const pick = cands.find((x) => x.jcCode === PREFERRED_MODAL_JC) ?? cands[0];
  expect(pick, 'a started in-house op with a balance exists on this stack').toBeTruthy();

  await page.goto('/job-cards/' + pick!.jcId + '/edit', { waitUntil: 'domcontentloaded' });
  const btn = page.getByRole('button', { name: /Outsource balance/ }).first();
  await btn.waitFor({ state: 'visible', timeout: 60_000 });
  await btn.click();
  const box = page.locator('#jcOutsourceBalanceVendor');
  await box.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  const header = (await page.locator('.section-hdr').filter({ hasText: /Outsource Balance —/ }).first().innerText()).replace(/\s+/g, ' ').trim();
  const preset = await box.inputValue();
  const placeholder = (await box.getAttribute('placeholder')) ?? '';
  const opts = await search(page, 'jcOutsourceBalanceVendor', '959');
  let picked = '';
  if (opts.hit !== '(no option)') {
    await page.getByRole('option').filter({ hasText: WANT }).first().click();
    await page.waitForTimeout(500);
    picked = await box.inputValue();
  }
  await page.screenshot({ path: SHOT_DIR + '/R3-07c-recheck.png', fullPage: true }).catch(() => {});

  // Cancel the modal (nothing submitted). NOTE: do NOT press Escape here — the
  // page's exit guard listens for Escape on the window and its "Are you sure
  // you want to exit?" prompt then covers the modal's Cancel (that is what left
  // the modal "still open" on the earlier run). Picking an option already
  // closed the list; if the list is still open, click the modal header instead.
  if (await page.getByRole('option').count()) {
    await page.locator('.section-hdr').filter({ hasText: /Outsource Balance —/ }).first().click();
    await page.waitForTimeout(300);
  }
  let cancelHow = 'modal Cancel (mouse)';
  const panel = page.locator('div:has(#jcOutsourceBalanceVendor):has(button)').last();
  await panel.getByRole('button', { name: /^Cancel$/ }).click({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
  if (await box.count()) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button.btn-ghost')].find((x) => x.textContent?.trim() === 'Cancel') as HTMLButtonElement | undefined;
      b?.click();
    });
    await page.waitForTimeout(800);
    cancelHow = 'mouse click left it open; DOM click on Cancel';
  }
  const modalGone = (await box.count()) === 0;
  const leftVia = await leaveEdit(page);

  record('R3-07c-1', {
    jc: pick!.jcCode, jcId: pick!.jcId, opSeq: pick!.opSeq, operation: pick!.operation, available: pick!.available,
    modalHeader: header, boxOnOpen: preset, placeholder, search959: opts, boxAfterPick: picked, modalGone, cancelHow, leftVia,
    pass: WANT.test(opts.hit) && WANT.test(picked) && modalGone,
  });
  expect(opts.hit, 'modal: typing "959" offers VND-959').toMatch(WANT);
  expect(picked, 'modal: box after pick shows CODE — Name').toMatch(WANT);
  expect(modalGone, 'modal closed by Cancel').toBe(true);
});
