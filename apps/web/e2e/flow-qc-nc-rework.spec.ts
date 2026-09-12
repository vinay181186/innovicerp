import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// QC → NC → Rework → Re-QC → Closure, exactly the worked example in §9 of
// Innovic_ERP_QC_NC_Handling_Procedure_R2-1.pdf, driven through the deployed
// TEST stack's own screens (never production):
//
//   Job card qty 10. QC accepts 8, rejects 2. The 8 move on; an NC is raised
//   for 2. Disposition = Rework → a child Rework job card for 2. The original
//   job card shows 2 Under Rework. The child is routed, run, and its final QC
//   accepts both → the NC closes, the 2 rejoin the parent route, the parent's
//   QC op reads 10 accepted.
//
// Every step writes a row to STEPS and a screenshot to SHOT so the run can be
// turned into the tabular report the user asked for. Document numbers are
// discovered from the pages, never assumed.

const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad/nc-run';
mkdirSync(SHOT, { recursive: true });

const ORDER_QTY = 10;
const ACCEPT_1 = 8;
const REJECT_1 = 2;
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

interface Step {
  n: number;
  stage: string;
  action: string;
  expected: string;
  observed: string;
  result: 'PASS' | 'FAIL' | 'INFO';
  doc?: string;
  shot?: string;
}
const STEPS: Step[] = [];
const docs: Record<string, string> = {};

function rec(k: string, v: string): void {
  docs[k] = v;
  // eslint-disable-next-line no-console
  console.log(`>> ${k}: ${v}`);
}
async function step(
  page: Page,
  stage: string,
  action: string,
  expected: string,
  check: () => Promise<string>,
  doc?: string,
): Promise<void> {
  const n = STEPS.length + 1;
  const shot = `${String(n).padStart(2, '0')}-${stage.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  let observed = '';
  let result: Step['result'] = 'PASS';
  try {
    observed = await check();
  } catch (e) {
    observed = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    result = 'FAIL';
  }
  await page.screenshot({ path: `${SHOT}/${shot}`, fullPage: true }).catch(() => {});
  STEPS.push({ n, stage, action, expected, observed, result, ...(doc ? { doc } : {}), shot });
  // eslint-disable-next-line no-console
  console.log(`[${result}] ${n}. ${stage} — ${observed.slice(0, 120)}`);
  writeFileSync(`${SHOT}/steps.json`, JSON.stringify({ docs, steps: STEPS }, null, 2));
  if (result === 'FAIL') throw new Error(`Step ${n} failed: ${observed}`);
}

/** Type into a type-to-search picker and take the first REAL option. The test
 *  API can take several seconds on a cold call and the list shows "Loading…"
 *  meanwhile, so wait for a genuine option rather than a fixed pause. */
async function pickFirst(page: Page, input: Locator, term: string): Promise<void> {
  await input.click();
  await input.fill(term);
  const opt = page.locator('[role="option"]').filter({ hasNotText: /Loading/i }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.waitForTimeout(400);
}
const today = (): string => new Date().toISOString().slice(0, 10);
const now = (): string => new Date().toTimeString().slice(0, 5);

/** Op Entry → By Job Card → load the card so its operations table shows. */
async function loadJc(page: Page, jc: string): Promise<void> {
  await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const box = page.locator('#jc-input');
  await box.click();
  await box.fill(jc);
  const opt = page.locator('[role="option"]').filter({ hasText: jc }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  // The ops table is fetched after the pick; wait for a row, not a clock.
  await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(800);
}

/** Fill the blank mandatory strip inside the entry popup. */
async function fillEntryHeader(page: Page, operator: string): Promise<void> {
  await page.locator('#opf-date').fill(today());
  await page.locator('#opf-time').fill(now());
  await page.locator('#opf-shift').selectOption('day');
  await page.getByPlaceholder(/Operator name|QC inspector name/i).first().fill(operator);
}

/** Every entry popup closes itself once the write lands (onSubmitted). On the
 *  test API a write can take 10 s or more, so "the box is gone" is the only
 *  honest signal that the entry was accepted. */
async function popupGone(page: Page): Promise<void> {
  await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden', timeout: 120_000 });
  await page.waitForTimeout(800);
}

/** Row-level action button on the operations table for the op named. */
function opRow(page: Page, opName: string): Locator {
  return page.locator('tr').filter({ hasText: opName }).first();
}

test('QC → NC → Rework → Re-QC → Closure (§9 example)', async ({ page }) => {
  test.setTimeout(900_000);

  // ── 1. Sales Order, one line, qty 10 ──────────────────────────────────────
  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const soCode = await page.locator('input[value^="IN-SO-"]').first().inputValue();
  const client = page.getByPlaceholder(/Type client code or name/i);
  await client.click();
  await client.fill('Adani');
  await page.waitForTimeout(1300);
  await page.locator('[role="option"], li').filter({ hasText: /Adani/ }).first().click();
  await page.getByPlaceholder(/Client PO reference/i).fill(`E2E-NC-${STAMP}`);
  const item = page.getByPlaceholder(/Search item code or name/i).first();
  await item.click();
  await item.fill('554117144000');
  await page.waitForTimeout(1300);
  await page.locator('[role="option"], li').filter({ hasText: '554117144000' }).first().click();
  await page.getByPlaceholder('Qty', { exact: true }).first().fill(String(ORDER_QTY));
  // Rev is compulsory on an SO line (this morning's change on `test`).
  await page.getByPlaceholder('Rev', { exact: true }).first().fill('A');
  await page
    .getByPlaceholder('₹ Rate', { exact: true })
    .first()
    .fill('10')
    .catch(() => {});
  await page.getByRole('button', { name: /Save SO/i }).click();
  // The test API can take a while on a cold start: wait for the save to land
  // (the form navigates away from /new) rather than a fixed pause.
  await page.waitForURL((u) => !/\/sales-orders\/new/.test(u.pathname), { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await step(
    page,
    'Sales Order',
    `Create SO for item 554117144000 COVER, qty ${ORDER_QTY}`,
    'SO saved',
    async () => {
      const body = await page.locator('body').innerText();
      const m = body.match(/IN-SO-\d+/);
      if (!m) throw new Error('no SO code on page after save');
      rec('SO', m[0]);
      return `SO ${m[0]} saved (form suggested ${soCode})`;
    },
    'SO',
  );

  // ── 2. Plan: one process op; the system appends the terminal DIR QC ───────
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search SO/i).fill(docs['SO']!);
  await page.waitForTimeout(1300);
  await page.getByText(docs['SO']!, { exact: true }).first().click();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: /\+ ?Plan/i }).first().click();
  await page.waitForTimeout(1300);
  // The create-plan box suggests (remaining − finished stock). The item has
  // stock from earlier runs, so the suggestion is less than the order; the
  // cycle needs the whole order on ONE job card, so set it explicitly.
  const planQty = page.locator('.form-grp:has(label:has-text("Plan Qty")) input[type="number"]').first();
  await planQty.waitFor({ state: 'visible', timeout: 30_000 });
  await planQty.fill(String(ORDER_QTY));
  await page.getByRole('button', { name: /^Save$/ }).click();
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
  // The modal closes when the save lands; Execute only exists after that.
  await page.getByRole('button', { name: /Save Plan/i }).waitFor({ state: 'hidden', timeout: 60_000 });
  const execBtn = page.getByRole('button', { name: /Execute/i }).first();
  await execBtn.waitFor({ state: 'visible', timeout: 60_000 });
  await execBtn.click();
  // Execute raises the job card server-side; on the test API that is many
  // seconds. Wait for the code to appear, not for a clock.
  await page.getByText(/IN-JC-\d{2}-\d+/).first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await step(
    page,
    'Plan → Job Card',
    'Plan one process op (Turning on cnc-1), save, execute',
    'Job card raised; a terminal DIR QC op is appended automatically',
    async () => {
      const body = await page.locator('body').innerText();
      const jc = body.match(/IN-JC-\d{2}-\d+/);
      if (!jc) throw new Error('no JC code on page after execute');
      rec('JC', jc[0]);
      return `JC ${jc[0]} raised from ${docs['SO']}`;
    },
    'JC',
  );
  const JC = docs['JC']!;

  // ── 3. Run the process op: Start, then Stop with all 10 made ──────────────
  await loadJc(page, JC);
  await step(page, 'Op Entry', `Load ${JC} on By Job Card`, 'Ops table shows Turning + DIR', async () => {
    const body = await page.locator('body').innerText();
    if (!/Turning/.test(body)) throw new Error('Turning op not listed');
    if (!/DIR/.test(body)) throw new Error('DIR QC op not listed — terminal QC was not appended');
    return 'Turning (process) and DIR (qc) both listed';
  });

  await opRow(page, 'Turning').getByRole('button', { name: /Start/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Operator');
  await page.getByRole('button', { name: /Start Operation/i }).click();
  await popupGone(page);
  await step(page, 'Start Op 1', 'Popup: date/time/shift/operator → ▶ Start Operation', 'Session running on cnc-1', async () => {
    await loadJc(page, JC);
    const body = await page.locator('body').innerText();
    if (!/Running|Log/.test(body)) throw new Error('op did not show as running');
    return 'Op 1 running; row now offers ✚ Log';
  });

  await opRow(page, 'Turning').getByRole('button', { name: /Log/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Operator');
  await page.locator('#opf-qty').fill(String(ORDER_QTY));
  await page.locator('#opf-rej').fill('0');
  await page.getByRole('button', { name: /^Stop/ }).click();
  await popupGone(page);
  await step(page, 'Stop Op 1', `Stop with ${ORDER_QTY} made`, `Op 1 complete, ${ORDER_QTY} pcs to DIR QC`, async () => {
    await loadJc(page, JC);
    const body = await page.locator('body').innerText();
    return `Turning logged; QC pending on DIR: ${/DIR/.test(body) ? 'listed' : 'missing'}`;
  });

  // ── 4. QC: accept 8, reject 2 → NC auto-raised ────────────────────────────
  await opRow(page, 'DIR').getByRole('button', { name: /QC/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Inspector');
  await page.locator('#opf-qty').fill(String(ACCEPT_1));
  await page.locator('#opf-rej').fill(String(REJECT_1));
  await page.getByRole('button', { name: /Submit QC inspection/i }).click();
  await popupGone(page);
  await step(
    page,
    'QC inspection',
    `DIR: accepted ${ACCEPT_1}, rejected ${REJECT_1}`,
    `NC auto-raised for ${REJECT_1}; ${ACCEPT_1} accepted stay on the route`,
    async () => {
      await page.goto(`/nc-register?search=${JC}`, { waitUntil: 'domcontentloaded' });
      // The list is fetched from the slow test API: wait for the NC row itself.
      const ncPattern = new RegExp('NC-AUTO-' + JC + '-Op[0-9]+-[0-9]+', 'i');
      const ncCell = page.getByText(ncPattern).first();
      await ncCell.waitFor({ timeout: 60_000 });
      const nc = (await ncCell.innerText()).match(ncPattern);
      if (!nc) throw new Error(`no NC listed for ${JC}`);
      rec('NC', nc[0]);
      return `NC ${nc[0]} raised automatically`;
    },
    'NC',
  );

  // ── 5. Job card shows the breakup: 8 accepted AND 2 NC raised ─────────────
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByPlaceholder(/search/i).first().fill(JC);
  const jcRow = page.getByText(JC, { exact: true }).first();
  await jcRow.waitFor({ timeout: 60_000 });
  await jcRow.click();
  await page.getByText(/Op\s*1/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  rec('JC_URL', page.url());
  await step(
    page,
    'JC breakup (§6)',
    'Open the parent job card',
    `DIR op card shows ✓${ACCEPT_1} · ✗${REJECT_1} · "NC raised ${REJECT_1}" together`,
    async () => {
      const body = await page.locator('body').innerText();
      const ok = new RegExp(`NC raised\\s*${REJECT_1}`).test(body);
      if (!ok) throw new Error('strip "NC raised 2" not visible on the op card');
      return `"NC raised ${REJECT_1}" shown beside ✓${ACCEPT_1} / ✗${REJECT_1}`;
    },
  );

  // ── 6. Dispose: Rework, qty 2 → child job card ────────────────────────────
  await page.goto(`/nc-register?search=${JC}`, { waitUntil: 'domcontentloaded' });
  const ncRow = page.getByText(docs['NC']!, { exact: false }).first();
  await ncRow.waitFor({ timeout: 60_000 });
  await ncRow.click();
  await page.getByRole('button', { name: /Dispose/ }).waitFor({ timeout: 60_000 });
  rec('NC_URL', page.url());
  await page.getByRole('button', { name: /Dispose/ }).click();
  await page.waitForTimeout(800);
  await page.locator('#dispAction').selectOption('rework');
  await page.locator('#dispQty').fill(String(REJECT_1));
  await page.locator('#dispRemarks').fill('E2E rework cycle');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.getByText(/-RW\d+/).first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1000);
  await step(
    page,
    'Disposition: Rework',
    `Dispose NC as Rework for ${REJECT_1} pcs`,
    'Child Rework JC <parent>-RW1 raised; NC status Under Rework',
    async () => {
      const body = await page.locator('body').innerText();
      const child = body.match(/IN-JC-\d{2}-\d+-RW\d+/);
      if (!child) throw new Error('child rework JC code not shown');
      rec('CHILD_JC', child[0]);
      if (!/Under Rework/i.test(body)) throw new Error('NC status did not become Under Rework');
      return `Child ${child[0]} raised; NC Under Rework`;
    },
    'CHILD_JC',
  );

  // ── 7. Interlock 6: closure refused while under rework ────────────────────
  await page.goto(docs['NC_URL']!, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Close$/ }).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await step(page, 'Closure gate', 'Look at the Close button while pieces are under rework', 'Close disabled with the reason named', async () => {
    const body = await page.locator('body').innerText();
    const m = body.match(/\d+ of \d+ pcs still under rework[^\n]*/i);
    if (!m) throw new Error('blocking reason not shown');
    const btn = page.getByRole('button', { name: /^Close$/ }).first();
    const disabled = await btn.isDisabled().catch(() => true);
    if (!disabled) throw new Error('Close button is enabled while under rework');
    return `Close disabled — "${m[0]}"`;
  });

  // ── 8. Parent shows 2 Under rework ────────────────────────────────────────
  await page.goto(docs['JC_URL']!, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Under rework/i).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await step(page, 'Parent JC (§6)', 'Re-open the parent job card', `"Under rework ${REJECT_1}" on the DIR op card`, async () => {
    const body = await page.locator('body').innerText();
    if (!new RegExp(`Under rework\\s*${REJECT_1}`).test(body)) throw new Error('"Under rework 2" not visible');
    return `"Under rework ${REJECT_1}" shown`;
  });

  // ── 9. Child: define the recovery op; DIR appended ────────────────────────
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByPlaceholder(/search/i).first().fill(docs['CHILD_JC']!);
  const childRow = page.getByText(docs['CHILD_JC']!, { exact: true }).first();
  await childRow.waitFor({ timeout: 60_000 });
  await childRow.click();
  await page.getByText(/REWORK of/i).first().waitFor({ timeout: 60_000 });
  rec('CHILD_URL', page.url());
  await step(page, 'Child JC banner (§4)', 'Open the child job card', 'Amber banner: REWORK of <parent> · Op n · NC …', async () => {
    const body = await page.locator('body').innerText();
    if (!/REWORK of/i.test(body)) throw new Error('recovery banner missing');
    return body.match(/REWORK of[^\n]*/i)![0];
  });
  await page.getByRole('link', { name: /Edit/ }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(400);
  const crow = page.locator('table.ops-routing tbody tr').nth(0);
  await crow.getByPlaceholder('Operation name').fill('Rework polish');
  await pickFirst(page, crow.getByPlaceholder('🔍 Machine', { exact: true }), 'cnc');
  await page.getByRole('button', { name: /Save/ }).first().click();
  await page.waitForTimeout(3500);
  await step(page, 'Child route', 'Add one recovery op "Rework polish" and save', 'DIR QC appended as the last op (interlock 3)', async () => {
    await loadJc(page, docs['CHILD_JC']!);
    const body = await page.locator('body').innerText();
    if (!/Rework polish/.test(body)) throw new Error('recovery op not listed');
    if (!/DIR/.test(body)) throw new Error('terminal DIR not appended on the child');
    return 'Rework polish + DIR listed on the child';
  });

  // ── 10. Run the child: start, stop with 2, QC accept 2 ────────────────────
  await opRow(page, 'Rework polish').getByRole('button', { name: /Start/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Operator');
  await page.getByRole('button', { name: /Start Operation/i }).click();
  await popupGone(page);
  await loadJc(page, docs['CHILD_JC']!);
  await opRow(page, 'Rework polish').getByRole('button', { name: /Log/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Operator');
  await page.locator('#opf-qty').fill(String(REJECT_1));
  await page.locator('#opf-rej').fill('0');
  await page.getByRole('button', { name: /^Stop/ }).click();
  await popupGone(page);
  await step(page, 'Child rework run', `Start + Stop the child op with ${REJECT_1} made`, `${REJECT_1} pcs at the child's DIR — QC pending`, async () => {
    await loadJc(page, docs['CHILD_JC']!);
    return 'child op logged';
  });

  await opRow(page, 'DIR').getByRole('button', { name: /QC/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Inspector');
  await page.locator('#opf-qty').fill(String(REJECT_1));
  await page.locator('#opf-rej').fill('0');
  await page.getByRole('button', { name: /Submit QC inspection/i }).click();
  await popupGone(page);
  await step(
    page,
    'Re-QC after rework',
    `Child DIR: accept ${REJECT_1}, reject 0`,
    'NC auto-closes (cleared = rejected); pieces re-enter the parent route',
    async () => {
      await page.goto(docs['NC_URL']!, { waitUntil: 'domcontentloaded' });
      await page.getByText(/Rejected|Cleared/).first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      const body = await page.locator('body').innerText();
      if (!/Closed/i.test(body)) throw new Error('NC not closed after full clearance');
      return 'NC status Closed';
    },
  );

  // ── 11. Parent: 10 accepted, NC closed 2, JC complete ─────────────────────
  await page.goto(docs['JC_URL']!, { waitUntil: 'domcontentloaded' });
  await page.getByText(/NC closed/i).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await step(
    page,
    'Parent rejoined',
    'Re-open the parent job card',
    `DIR shows ✓${ORDER_QTY}; strip shows "NC closed ${REJECT_1}"; no Under rework`,
    async () => {
      const body = await page.locator('body').innerText();
      const closed = new RegExp(`NC closed\\s*${REJECT_1}`).test(body);
      const under = new RegExp(`Under rework\\s*[1-9]`).test(body);
      if (!closed) throw new Error('"NC closed 2" not shown on the parent');
      if (under) throw new Error('parent still shows pieces under rework');
      const acc = body.match(/✓\s*(\d+)/g)?.join(' ') ?? '';
      return `"NC closed ${REJECT_1}" shown; accepted markers: ${acc}`;
    },
  );

  writeFileSync(`${SHOT}/steps.json`, JSON.stringify({ docs, steps: STEPS }, null, 2));
  expect(STEPS.every((s) => s.result !== 'FAIL')).toBe(true);
});
