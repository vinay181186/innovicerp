// TEST STACK ONLY (https://innovic-erp.pages.dev). Read-only rendering check of
// the rework/recovery + NC screens against the standing E2E_ RWCLIMB chain.
// Captures innerText, console errors and a screenshot per page so a human /
// agent can judge what actually rendered vs the DB truth. Writes nothing.
import { mkdirSync } from 'node:fs';
import { type Page, test } from '@playwright/test';

const SHOT_DIR =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/63acafdd-2f28-49ae-8254-2a8f2c451395/scratchpad/shots';
mkdirSync(SHOT_DIR, { recursive: true });

const JC = {
  parent: { code: 'IN-JC-26-00028', id: '90efd63a-0d4a-4e20-a8d3-0bffaad74f36' },
  rw1: { code: 'IN-JC-26-00028-RW1', id: '49aadfac-df56-4890-9db5-a4cdd06488ca' },
  rw1rw1: { code: 'IN-JC-26-00028-RW1-RW1', id: '66708a12-9017-420f-b763-e7251f99b9af' },
};
const NC = {
  parentOp2: { code: 'parent-Op2', id: '73c38151-7299-4802-9073-57a621a67381' },
  rw1Op2: { code: 'rw1-Op2', id: '7efd66d8-a424-4d3d-9dd4-8ee884576d69' },
  rw1rw1Op2: { code: 'rw1rw1-Op2-scrap', id: '5de133b3-6e11-4c06-92dd-960f46a0a3c0' },
};

function hookConsole(page: Page, sink: string[]): void {
  page.on('console', (m) => {
    if (m.type() === 'error') sink.push(`[console.error] ${m.text()}`);
  });
  page.on('pageerror', (e) => sink.push(`[pageerror] ${e.message}`));
}

async function dump(page: Page, label: string, path: string): Promise<void> {
  const errors: string[] = [];
  hookConsole(page, errors);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  // Give TanStack Query time to fetch + render.
  await page.waitForTimeout(6000);
  const text = await page.locator('body').innerText().catch(() => '(no body)');
  await page.screenshot({ path: `${SHOT_DIR}/${label}.png`, fullPage: true });
  console.log(`\n\n========== ${label}  (${path}) ==========`);
  console.log(text);
  console.log(`---- console errors for ${label}: ${errors.length} ----`);
  for (const e of errors) console.log(e);
}

test('render JC status pages', async ({ page }) => {
  test.setTimeout(300_000);
  await dump(page, 'jc-parent-status', `/job-cards/${JC.parent.id}`);
  await dump(page, 'jc-rw1-status', `/job-cards/${JC.rw1.id}`);
  await dump(page, 'jc-rw1rw1-status', `/job-cards/${JC.rw1rw1.id}`);
});

test('render JC edit (pre-filled route + banner in edit mode)', async ({ page }) => {
  test.setTimeout(300_000);
  await dump(page, 'jc-rw1-edit', `/job-cards/${JC.rw1.id}/edit`);
});

test('render NC detail pages', async ({ page }) => {
  test.setTimeout(300_000);
  await dump(page, 'nc-parent-op2', `/nc-register/${NC.parentOp2.id}`);
  await dump(page, 'nc-rw1-op2', `/nc-register/${NC.rw1Op2.id}`);
  await dump(page, 'nc-rw1rw1-op2-scrap', `/nc-register/${NC.rw1rw1Op2.id}`);
});
