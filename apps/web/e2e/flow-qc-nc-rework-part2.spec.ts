import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

// Second half of the §9 rework cycle, resumed from the state the first spec
// left on the TEST stack (its steps.json carries the document numbers):
//
//   child job card routed (recovery op + auto-appended DIR) → run the child →
//   its DIR accepts both pieces → the NC closes on its own → the parent shows
//   the 2 rejoined (NC closed 2) and nothing under rework.
//
// Appends to the same steps.json so the report reads as one cycle.

const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad/nc-run';
const REJECT_1 = 2;
const ORDER_QTY = 10;

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
const saved = JSON.parse(readFileSync(`${SHOT}/steps.json`, 'utf8')) as {
  docs: Record<string, string>;
  steps: Step[];
};
const docs = saved.docs;
const STEPS: Step[] = saved.steps.filter((s) => s.result === 'PASS');

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
  console.log(`[${result}] ${n}. ${stage} — ${observed.slice(0, 120)}`);
  writeFileSync(`${SHOT}/steps.json`, JSON.stringify({ docs, steps: STEPS }, null, 2));
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
function opRow(page: Page, opName: string): Locator {
  return page.locator('tr').filter({ hasText: opName }).first();
}

test('QC → NC → Rework → Re-QC → Closure — part 2 (child run to closure)', async ({ page }) => {
  test.setTimeout(900_000);
  const CHILD = docs['CHILD_JC']!;

  // ── 12. Child route: recovery op + auto-appended DIR ──────────────────────
  await loadJc(page, CHILD);
  await step(page, 'Child route (§4.3, interlock 3)', `Load ${CHILD} on Op Entry`, 'Rework polish (process) + DIR (qc, appended automatically)', async () => {
    const body = await page.locator('body').innerText();
    if (!/Rework polish/.test(body)) throw new Error('recovery op not listed');
    if (!/DIR/.test(body)) throw new Error('terminal DIR not appended on the child');
    return 'Rework polish + DIR listed on the child';
  });

  // ── 13. Run the child op: Start, Stop with 2 ──────────────────────────────
  await opRow(page, 'Rework polish').getByRole('button', { name: /Start/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Operator');
  await page.getByRole('button', { name: /Start Operation/i }).click();
  await popupGone(page);
  await loadJc(page, CHILD);
  await opRow(page, 'Rework polish').getByRole('button', { name: /Log/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Operator');
  await page.locator('#opf-qty').fill(String(REJECT_1));
  await page.locator('#opf-rej').fill('0');
  await page.getByRole('button', { name: /^Stop/ }).click();
  await popupGone(page);
  await step(page, 'Child rework run (§7)', `Start + Stop the child op with ${REJECT_1} made`, `${REJECT_1} pcs waiting at the child's DIR (QC pending)`, async () => {
    await loadJc(page, CHILD);
    const row = await opRow(page, 'DIR').innerText();
    if (!/QC/.test(row)) throw new Error('child DIR does not offer QC');
    return `child op logged; DIR row: ${row.replace(/\s+/g, ' ').trim()}`;
  });

  // ── 14. Re-QC after rework: accept both ───────────────────────────────────
  await opRow(page, 'DIR').getByRole('button', { name: /QC/ }).click();
  await page.waitForTimeout(1200);
  await fillEntryHeader(page, 'E2E Inspector');
  await page.locator('#opf-qty').fill(String(REJECT_1));
  await page.locator('#opf-rej').fill('0');
  await page.getByRole('button', { name: /Submit QC inspection/i }).click();
  await popupGone(page);
  await step(page, 'Re-QC after rework (§8)', `Child DIR: accept ${REJECT_1}, reject 0`, 'NC closes on its own (cleared = rejected)', async () => {
    await page.goto(docs['NC_URL']!, { waitUntil: 'domcontentloaded' });
    await page.getByText(/Rejected|Cleared/).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1000);
    const body = await page.locator('body').innerText();
    if (!/Closed/i.test(body)) throw new Error('NC not closed after full clearance');
    return 'NC status Closed';
  });

  // ── 15. Parent: pieces rejoined ───────────────────────────────────────────
  await page.goto(docs['JC_URL']!, { waitUntil: 'domcontentloaded' });
  await page.getByText(/NC closed/i).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  await step(page, 'Parent rejoined (§9)', 'Re-open the parent job card', `DIR shows ✓${ORDER_QTY}; strip "NC closed ${REJECT_1}"; nothing under rework`, async () => {
    const body = await page.locator('body').innerText();
    if (!new RegExp(`NC closed\\s*${REJECT_1}`).test(body)) throw new Error('"NC closed 2" not shown on the parent');
    if (/Under rework\s*[1-9]/.test(body)) throw new Error('parent still shows pieces under rework');
    const acc = body.match(/✓\s*\d+/g)?.join(' ') ?? '';
    return `"NC closed ${REJECT_1}" shown; accepted markers: ${acc}`;
  });

  expect(STEPS.every((s) => s.result !== 'FAIL')).toBe(true);
});
