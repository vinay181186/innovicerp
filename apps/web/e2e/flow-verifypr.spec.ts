import { test, type Page } from '@playwright/test';

function log(pass: boolean, name: string, detail = ''): void {
  // eslint-disable-next-line no-console
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
}
const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp-innovicerp/30277fb2-021d-4e86-a944-eccf9a952b2d/scratchpad';

// T23 write behavior — PR with a blank number auto-generates IN-PR-#####.
// Defensive: small waits between fields; itemName omitted (optional).
test('T23 create PR blank → IN-PR', async ({ page }: { page: Page }) => {
  test.setTimeout(150_000);
  await page.goto('/purchase-requests/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.locator('#itemCodeText').fill('559918151000');
  await page.waitForTimeout(800);
  await page.getByPlaceholder('Required if no vendor picked').fill('E2E-VEND');
  await page.waitForTimeout(800);
  await page.locator('input[type="number"]').first().fill('5');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOT}/vpr-filled.png`, fullPage: true });
  await page.getByRole('button', { name: /Create PR/i }).click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${SHOT}/vpr-saved.png`, fullPage: true });
  const body = await page.locator('body').innerText();
  const pr = body.match(/IN-PR-\d+/);
  const err = /validation failed/i.test(body);
  log(Boolean(pr) && !err, 'T23 PR auto-generated IN-PR- on blank', pr ? pr[0] : `err=${err} url=${page.url()} :: ${body.slice(0, 180).replace(/\n/g, ' ')}`);
});
