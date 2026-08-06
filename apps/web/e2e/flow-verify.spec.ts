import { test, type Page } from '@playwright/test';

// Behavioral verification of the pending-task fixes against the deployed app.
// Each check logs PASS/FAIL so one failure doesn't abort the rest.

const results: string[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  const line = `${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`;
  results.push(line);
  // eslint-disable-next-line no-console
  console.log(`${pass ? '✅' : '❌'} ${line}`);
}
async function safe(fn: () => Promise<void>, name: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    check(name, false, `threw: ${String(e).slice(0, 120)}`);
  }
}

test('verify batch 1 (read-only + interaction)', async ({ page }: { page: Page }) => {
  test.setTimeout(300_000);

  // ── T25/26 — DC list: Action column + "+ Receive", no "Lines" column ──
  await safe(async () => {
    await page.goto('/delivery-challans', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const h = await page.locator('th').allInnerTexts();
    check('T25/26 DC Action column', h.some((x) => /action/i.test(x)), JSON.stringify(h));
    check('T25/26 DC Lines column removed', !h.some((x) => /^lines$/i.test(x.trim())));
    check('T25/26 +Receive button rendered', (await page.getByText('+ Receive').first().count()) > 0);
  }, 'T25/26');

  // ── T29 + T28 — Planning Dashboard placeholder + sortable columns ──
  await safe(async () => {
    await page.goto('/planning-dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    check('T29 planning search placeholder', (await page.getByPlaceholder(/Search Plan/i).count()) > 0);
    const hdr = page.getByRole('columnheader', { name: /Plan No\./i }).first();
    const before = await page.locator('table tbody tr').first().innerText().catch(() => '');
    await hdr.click().catch(() => {});
    await page.waitForTimeout(700);
    const hdrTxt = await hdr.innerText().catch(() => '');
    const after = await page.locator('table tbody tr').first().innerText().catch(() => '');
    check('T28 table sortable (indicator/reorder)', /▲|▼/.test(hdrTxt) || before !== after, `hdr="${hdrTxt.trim()}"`);
  }, 'T29/T28');

  // ── T27 — Op Entry shows the source SO ──
  await safe(async () => {
    await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByPlaceholder(/IN-JC-/i).fill('IN-JC-26-00059');
    await page.getByRole('button', { name: /^Load$/ }).click();
    await page.waitForTimeout(3500);
    check('T27 Op Entry shows "SO:"', (await page.getByText(/^SO:\s*IN-SO-/).first().count()) > 0);
  }, 'T27');

  // ── T15 — Planning right-pane header shows the item ──
  await safe(async () => {
    await page.goto('/planning', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByPlaceholder(/Search SO/i).fill('IN-SO-00551');
    await page.waitForTimeout(1500);
    await page.getByText('IN-SO-00551', { exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(2000);
    const headerArea = await page.locator('.section-hdr').first().innerText().catch(() => '');
    check('T15 Planning right header shows item', /SPACER|559918151000/i.test(headerArea), `hdr="${headerArea.replace(/\n/g, ' ')}"`);
  }, 'T15');

  // eslint-disable-next-line no-console
  console.log('\n==== VERIFY BATCH 1 ====\n' + results.join('\n'));
});
