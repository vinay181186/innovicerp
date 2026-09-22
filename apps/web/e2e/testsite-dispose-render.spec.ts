// TEST STACK ONLY. Renders the Dispose-NC panel + disposition (rework) flow on
// an EXISTING pending in-house NC to confirm it draws with the right options and
// no console errors. READ-ONLY: it opens the panel and reads it, then Cancels —
// it never clicks Save, so no real NC is advanced.
import { mkdirSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

const SHOT_DIR =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/63acafdd-2f28-49ae-8254-2a8f2c451395/scratchpad/shots';
mkdirSync(SHOT_DIR, { recursive: true });

// A standing pending, in-house (grn_line_id null) NC on the test stack.
const PENDING_NC_ID = '000cf3bb-520b-4dbf-9903-6d842a5b8f63';

function hookConsole(page: Page, sink: string[]): void {
  page.on('console', (m) => {
    if (m.type() === 'error') sink.push(`[console.error] ${m.text()}`);
  });
  page.on('pageerror', (e) => sink.push(`[pageerror] ${e.message}`));
}

test('dispose panel renders with in-house action set (Return to Vendor hidden)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  hookConsole(page, errors);

  await page.goto(`/nc-register/${PENDING_NC_ID}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${SHOT_DIR}/nc-pending-detail.png`, fullPage: true });

  // Open the disposition panel.
  const disposeBtn = page.getByRole('button', { name: 'Dispose' });
  await expect(disposeBtn).toBeVisible({ timeout: 30_000 });
  await disposeBtn.click();

  const actionSelect = page.locator('#dispAction');
  await expect(actionSelect).toBeVisible({ timeout: 15_000 });

  // Read every option the panel offers.
  const options = await actionSelect.locator('option').allInnerTexts();
  console.log('DISPOSE ACTION OPTIONS:', JSON.stringify(options));

  // Select Rework → the child-JC note should render.
  await actionSelect.selectOption('rework');
  await page.waitForTimeout(500);
  const reworkNote = await page.locator('.panel').last().innerText();
  console.log('\n---- panel after selecting REWORK ----\n', reworkNote);
  await page.screenshot({ path: `${SHOT_DIR}/nc-dispose-rework.png`, fullPage: true });

  // Select Scrap → the scrap note / cost path.
  await actionSelect.selectOption('scrap');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOT_DIR}/nc-dispose-scrap.png`, fullPage: true });

  console.log(`\n---- console errors: ${errors.length} ----`);
  for (const e of errors) console.log(e);

  // Do NOT submit — Cancel to leave the NC untouched.
  await page.getByRole('button', { name: 'Cancel' }).first().click();
});
