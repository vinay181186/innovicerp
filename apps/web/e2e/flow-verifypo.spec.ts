import { test, type Page } from '@playwright/test';

function log(pass: boolean, name: string, detail = ''): void {
  // eslint-disable-next-line no-console
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
}
const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp-innovicerp/30277fb2-021d-4e86-a944-eccf9a952b2d/scratchpad';

// T20/22 — create a PO from PR IN-PR-00001 with a BLANK number → IN-PO-#####,
// with no "request validation failed".
test('T20/22 create PO from PR blank → IN-PO', async ({ page }: { page: Page }) => {
  test.setTimeout(150_000);
  await page.goto('/purchase-requests?search=IN-PR-00001', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByText('📝 PO', { exact: false }).first().click();
  await page.waitForTimeout(3000);
  // Clear the auto-filled PO number → exercise the blank→auto path (T20/22).
  const poNo = page.locator('input[value^="IN-PO-"], input[value^="IN-JWPO-"]').first();
  await poNo.fill('');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOT}/vpo-blank.png`, fullPage: true });
  await page.getByRole('button', { name: /Create PO/i }).click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${SHOT}/vpo-saved.png`, fullPage: true });
  const body = await page.locator('body').innerText();
  const po = body.match(/IN-(?:JW)?PO-\d+/);
  const err = /validation failed/i.test(body);
  log(Boolean(po) && !err, 'T20/22 PO auto-generated on blank (no validation error)', po ? po[0] : `err=${err} url=${page.url()} :: ${body.slice(0, 160).replace(/\n/g, ' ')}`);
});
