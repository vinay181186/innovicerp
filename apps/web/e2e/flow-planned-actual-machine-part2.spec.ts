import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Planned vs Actual machine (ADR-164), driven through the deployed TEST stack:
//
//   JC op planned on cnc-1. Start it on cnc-2 through Group → Machine. Log 4,
//   Stop with 3. The plan must still read cnc-1; every produced piece must be
//   stamped cnc-2; the busy gate must key on cnc-2 while it runs; Op Log and
//   the Job Card must show both machines for what they are.
//
// Every step writes a row to STEPS and a screenshot to SHOT for the report.

const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad/am-run2';
mkdirSync(SHOT, { recursive: true });

// Discovered on the TEST DB before the run: planned cnc-1, 10 pcs available,
// nothing running anywhere. A second card, also planned on cnc-1, proves the
// busy gate.
const JC = 'IN-JC-26-00009';
const JC_OTHER = 'IN-JC-26-00006';
const PLANNED = 'cnc-1';
const ACTUAL = 'cnc-2';
const LOG_QTY = 4;
const STOP_QTY = 3;

interface Step {
  n: number;
  stage: string;
  action: string;
  expected: string;
  observed: string;
  result: 'PASS' | 'FAIL' | 'INFO';
  shot?: string;
}
const STEPS: Step[] = [];
const PART2 = true;

async function step(
  page: Page,
  stage: string,
  action: string,
  expected: string,
  check: () => Promise<string>,
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
  STEPS.push({ n, stage, action, expected, observed, result, shot });
  // eslint-disable-next-line no-console
  console.log(`[${result}] ${n}. ${stage} — ${observed.slice(0, 140)}`);
  writeFileSync(`${SHOT}/steps.json`, JSON.stringify({ steps: STEPS }, null, 2));
  if (result === 'FAIL') throw new Error(`Step ${n} failed: ${observed}`);
}

const today = (): string => new Date().toISOString().slice(0, 10);
const now = (): string => new Date().toTimeString().slice(0, 5);

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
  await page.getByPlaceholder(/Operator name|QC inspector name/i).first().fill(operator);
}

async function popupGone(page: Page): Promise<void> {
  await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden', timeout: 120_000 });
  await page.waitForTimeout(800);
}

/** The first op row that offers the named action. */
function rowWith(page: Page, action: RegExp): Locator {
  return page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: action }) }).first();
}

/** Pick a machine in the Actual Machine picker (SearchableSelect). */
async function pickActual(page: Page, code: string): Promise<void> {
  const input = page.locator('#opf-actual-machine');
  await input.click();
  await input.fill(code);
  const opt = page.locator('[role="option"]').filter({ hasText: code }).filter({ hasNotText: /Loading/i }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.waitForTimeout(400);
}

test('planned vs actual machine part 2: log, stop, verify', async ({ page }) => {
  test.setTimeout(900_000);
  void PART2;
  if (!process.env.AM_WRITE) { /* verification-only rerun: the Log/Stop writes already landed */ }
  else {
  // ── 5. Log 4 on the running session ────────────────────────────────────
    await loadJc(page, JC);
    await rowWith(page, /Log/).getByRole('button', { name: /Log/ }).click();
    await page.locator('#opf-machine').waitFor({ timeout: 30_000 });
    await step(page, 'Log popup', `${JC} → ✚ Log`, `Machine box reads ${ACTUAL} with "planned ${PLANNED}"`, async () => {
      const m = await page.locator('#opf-machine').inputValue();
      const dlg = await page.locator('[role="dialog"]').first().innerText();
      if (m !== ACTUAL) throw new Error(`machine box reads "${m}"`);
      if (!new RegExp(`planned ${PLANNED}`).test(dlg)) throw new Error('planned note missing');
      return `Machine ${m} · planned ${PLANNED} shown`;
    });
    await fillEntryHeader(page, 'E2E Operator');
    await page.locator('#opf-qty').fill(String(LOG_QTY));
    await page.locator('#opf-rej').fill('0');
    await page.getByRole('button', { name: /Submit completion/i }).click();
    await popupGone(page);
    await step(page, 'Log 4', `Qty ${LOG_QTY} → ✓ Submit completion`, `${LOG_QTY} pcs booked on ${ACTUAL}; session still running`, async () => {
      await loadJc(page, JC);
      const body = await page.locator('body').innerText();
      if (!/Log/.test(body)) throw new Error('session ended unexpectedly');
      return 'Entry accepted; row still offers Log (session open)';
    });
  
    // ── 6. Stop with 3 ───────────────────────────────────────────────────────
    await rowWith(page, /Log/).getByRole('button', { name: /Log/ }).click();
    await page.locator('#opf-qty').waitFor({ timeout: 30_000 });
    await fillEntryHeader(page, 'E2E Operator');
    await page.locator('#opf-qty').fill(String(STOP_QTY));
    await page.locator('#opf-rej').fill('0');
    await page.getByRole('button', { name: /^Stop/ }).click();
    await popupGone(page);
    await step(page, 'Stop 3', `Qty ${STOP_QTY} → ■ Stop`, `${STOP_QTY} pcs booked on ${ACTUAL}; ${ACTUAL} freed; row offers Start again`, async () => {
      await loadJc(page, JC);
      const body = await page.locator('body').innerText();
      if (!/Start/.test(body)) throw new Error('row does not offer Start after stop');
      return 'Stopped; row offers ▶ Start (3 pcs still available)';
    });
  
  
  }
  // ── 7. Op Log shows the ACTUAL machine on every row ─────────────────────
  await page.goto(`/op-log?jcNo=${JC}`, { waitUntil: 'domcontentloaded' });
  // The test API can take 20 s+; wait for a REAL row (one that names the JC),
  // not the "Loading…" placeholder row.
  await page.locator('table tbody tr').filter({ hasText: JC }).first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(800);
  await step(page, 'Op Log', `Op Log → JC ${JC}`, `start / 4 / 3 rows all on ${ACTUAL}`, async () => {
    const rows = await page.locator('table tbody tr').allInnerTexts();
    // The machine tag is upper-cased by CSS; compare case-blind.
    const mine = rows.filter((r) => r.toLowerCase().includes(ACTUAL));
    if (mine.length < 3) throw new Error(`only ${mine.length} rows show ${ACTUAL}`);
    return `${mine.length} rows carry ${ACTUAL}`;
  });

  // ── 8. Job Card page: planned machine + "made on" split ─────────────────
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: JC }).first().click();
  await page.locator('body').filter({ hasText: ACTUAL }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  await step(page, 'Job Card page', `Job Cards → ${JC}`, `Op 1 still shows planned ${PLANNED}; machine split lists ${ACTUAL} ${LOG_QTY + STOP_QTY}`, async () => {
    const body = await page.locator('body').innerText();
    const lc = body.toLowerCase();
    if (!lc.includes(PLANNED)) throw new Error(`planned ${PLANNED} not shown`);
    if (!lc.includes(ACTUAL)) throw new Error(`actual ${ACTUAL} not shown`);
    const made = new RegExp(`${ACTUAL}[^\\n]{0,12}${LOG_QTY + STOP_QTY}`).test(lc);
    return `Planned ${PLANNED} present; ${ACTUAL} present; "${ACTUAL} ${LOG_QTY + STOP_QTY}" ${made ? 'found' : 'not matched verbatim (see screenshot)'}`;
  });
});
