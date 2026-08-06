import { test, type Page } from '@playwright/test';

function log(pass: boolean, name: string, detail = ''): void {
  // eslint-disable-next-line no-console
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
}
const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp-innovicerp/30277fb2-021d-4e86-a944-eccf9a952b2d/scratchpad';

// T23 + T20/22 — create a PR with a BLANK number (→ IN-PR-#####), then create a
// PO from it with a BLANK number (→ IN-PO-#####, no "request validation failed").
test('T23+T20/22 blank numbers auto-generate', async ({ page }: { page: Page }) => {
  test.setTimeout(180_000);
  await page.goto('/purchase-requests/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  // Item code (type-to-search)
  const item = page.getByPlaceholder(/ITM-|item code|item/i).first();
  await item.click();
  await item.fill('559918151000');
  await page.waitForTimeout(1600);
  await page.getByText(/559918151000/).first().click().catch(() => {});
  await page.waitForTimeout(600);
  // Vendor fallback text (so the "vendor required" refine passes)
  await page.getByPlaceholder(/no vendor|fallback|vendor code/i).first().fill('E2E-VEND').catch(() => {});
  // Qty — the field labelled QTY (a number input near the item)
  const nums = page.getByRole('spinbutton');
  const n = await nums.count();
  for (let i = 0; i < n; i++) {
    const ph = await nums.nth(i).getAttribute('placeholder');
    if (!ph || /qty/i.test(ph)) {
      await nums.nth(i).fill('5').catch(() => {});
      break;
    }
  }
  await page.screenshot({ path: `${SHOT}/verify-pr-filled.png`, fullPage: true });
  // PR No. left blank → save
  await page.getByRole('button', { name: /save|create|✓/i }).first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOT}/verify-pr-saved.png`, fullPage: true });
  const body = await page.locator('body').innerText();
  const pr = body.match(/IN-PR-\d+/);
  log(Boolean(pr), 'T23 PR auto-generated IN-PR- on blank', pr ? pr[0] : `url=${page.url()} :: ${body.slice(0, 160).replace(/\n/g, ' ')}`);
});

// T30a — JC Status due date (ref IN-JC-26-00061)
test('T30a JC due date', async ({ page }: { page: Page }) => {
  test.setTimeout(90_000);
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByText('IN-JC-26-00061', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOT}/verify-jc-30.png`, fullPage: true });
  const dueTxt = await page.getByText(/Due:/i).first().innerText().catch(() => '');
  const rc = await page.getByText(/Route Card/i).first().innerText().catch(() => '');
  const hasDate = /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}/.test(dueTxt);
  log(hasDate, 'T30a JC Status shows a due date (COALESCE fallback)', `due="${dueTxt}" route="${rc}"`);
});

// T15 — Planning right-pane header shows the item (robust retry)
test('T15 planning header item', async ({ page }: { page: Page }) => {
  test.setTimeout(90_000);
  await page.goto('/planning', { waitUntil: 'commit' });
  await page.waitForTimeout(3500);
  await page.getByPlaceholder(/Search SO/i).fill('IN-SO-00551');
  await page.waitForTimeout(1800);
  await page.getByText('IN-SO-00551', { exact: true }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT}/verify-t15.png`, fullPage: true }).catch(() => {});
  const hdr = await page.locator('.section-hdr').first().innerText().catch(() => '');
  log(/SPACER|559918151000/i.test(hdr), 'T15 planning header shows item', `hdr="${hdr.replace(/\n/g, ' ')}"`);
});
